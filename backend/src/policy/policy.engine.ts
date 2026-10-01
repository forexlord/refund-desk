import {
  Customer,
  Decision,
  Order,
  OrderItem,
  PolicyDecision,
  ReasonCategory,
  RefundAssessment,
  RuleResult,
  SecurityFlag,
} from '../common/domain';

/**
 * Deterministic refund policy engine.
 *
 * This is the ONLY component that decides APPROVED / DENIED / ESCALATED.
 * The AI layer supplies an interpretation of the customer's message (RefundAssessment);
 * every monetary figure, date, and eligibility fact comes from the order record.
 *
 * Design rule: AI output can only make the outcome MORE cautious (e.g. flag an inconsistency
 * to force escalation). Nothing the AI returns can turn a deny/escalate into an approval.
 */

export const POLICY_VERSION = '2026.1';

export const POLICY_LIMITS = {
  defectWindowDays: 30,
  changeOfMindWindowDays: 14,
  autoApproveMaxAmount: 500,
  riskRefundCount: 3,
  riskLookbackDays: 90,
  minConfidence: 0.6,
} as const;

const DEFECT_REASONS: ReasonCategory[] = ['damaged_defective', 'wrong_item', 'not_as_described'];

export interface PolicyInput {
  customer: Customer;
  order: Order;
  assessment: RefundAssessment;
  securityFlags: SecurityFlag[];
  /** Refunds issued to this customer within the risk lookback window. */
  recentRefundCount: number;
  /** An earlier request for the same order that is still waiting on an agent. */
  hasOpenRequestForOrder: boolean;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Money is summed in integer cents: prices are 2-decimal NUMERIC values, so cents are exact and sums never
 * pick up floating-point error. Dollars appear only at the edges (output and messages).
 */
export function lineCents(item: OrderItem): number {
  return Math.round(item.unitPrice * 100) * item.quantity;
}

const sumCents = (items: OrderItem[]) => items.reduce((sum, i) => sum + lineCents(i), 0);

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Work out which items the request is about. The AI's item IDs are intersected with the real order,
 * so a hallucinated or injected ID can never add an item to the refund.
 */
export function resolveClaimedItems(order: Order, assessment: RefundAssessment): { items: OrderItem[]; inferred: boolean } {
  const valid = order.items.filter((i) => assessment.claimedItemIds.includes(i.id));
  if (valid.length > 0) return { items: valid, inferred: false };
  // Customer didn't name specific items: treat the request as covering the whole order.
  return { items: order.items, inferred: true };
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { customer, order, assessment, securityFlags, now } = input;
  const rules: RuleResult[] = [];
  const reason = assessment.reasonCategory;

  // Terminal outcomes that don't depend on item-level evaluation.
  let terminalDeny = false;

  // ---- P-11 Manipulation attempts -------------------------------------------------------------
  const manipulation = securityFlags.filter((f) => f.source !== 'output_guard');
  if (manipulation.length > 0) {
    rules.push({
      ruleId: 'P-11',
      outcome: 'escalate',
      detail: `Possible manipulation attempt: ${manipulation.map((f) => `${f.code} (${f.source})`).join('; ')}`,
    });
  } else {
    rules.push({ ruleId: 'P-11', outcome: 'pass', detail: 'No manipulation indicators.' });
  }

  // ---- P-03 Duplicate open request --------------------------------------------------------------
  if (input.hasOpenRequestForOrder) {
    rules.push({
      ruleId: 'P-03',
      outcome: 'deny',
      detail: 'A request for this order is already pending agent review.',
      customerReason: 'A refund request for this order is already being reviewed by our team. We will contact you once it has been decided.',
    });
    terminalDeny = true;
  }

  // ---- P-02 Order status ------------------------------------------------------------------------
  if (order.status === 'processing') {
    rules.push({
      ruleId: 'P-02',
      outcome: 'deny',
      detail: 'Order has not shipped yet.',
      customerReason: 'This order has not shipped yet, so it cannot be refunded. You can cancel the order instead, and you will not be charged.',
    });
    terminalDeny = true;
  } else if (order.status === 'cancelled') {
    rules.push({
      ruleId: 'P-02',
      outcome: 'deny',
      detail: 'Order is cancelled; payment already voided.',
      customerReason: 'This order was cancelled, and its payment has already been voided.',
    });
    terminalDeny = true;
  } else if (order.status === 'shipped') {
    const overdue = order.expectedDelivery !== null && now > order.expectedDelivery;
    if (overdue && reason === 'not_received') {
      rules.push({
        ruleId: 'P-02',
        outcome: 'escalate',
        detail: `Shipped order is overdue (expected ${order.expectedDelivery!.toISOString().slice(0, 10)}); needs carrier investigation.`,
        customerReason: 'Your parcel is past its expected delivery date, so we will investigate with the carrier.',
      });
    } else {
      rules.push({
        ruleId: 'P-02',
        outcome: 'deny',
        detail: overdue ? 'Shipped and overdue, but the request is not about non-delivery.' : 'Order still in transit and not overdue.',
        customerReason: overdue
          ? 'This order has not been delivered yet, so it is not eligible for a return refund. If it has not arrived, tell us that it is missing, and we will investigate.'
          : `This order is still in transit${order.expectedDelivery ? ` and is expected by ${order.expectedDelivery.toISOString().slice(0, 10)}` : ''}. Refunds are available after delivery.`,
      });
      terminalDeny = true;
    }
  } else {
    rules.push({ ruleId: 'P-02', outcome: 'pass', detail: 'Order delivered.' });
  }

  // ---- Item-level evaluation (only meaningful for delivered orders) ----------------------------
  const { items: claimed, inferred } = resolveClaimedItems(order, assessment);
  if (inferred && order.items.length > 1) {
    rules.push({
      ruleId: 'P-13',
      outcome: 'info',
      detail: 'Customer did not name specific items; request evaluated against every item in the order.',
    });
  }

  const eligible: OrderItem[] = [];
  const excluded: OrderItem[] = [];
  const isDefect = DEFECT_REASONS.includes(reason);

  if (order.status === 'delivered' && order.deliveredAt) {
    const age = daysBetween(order.deliveredAt, now);

    // P-10: "not received" on a delivered order is a conflict when there is a delivery signature,
    // and a carrier dispute otherwise. Both need a human.
    if (reason === 'not_received') {
      rules.push({
        ruleId: 'P-10',
        outcome: 'escalate',
        detail: order.signatureOnDelivery
          ? 'Customer says the parcel never arrived, but the carrier recorded a signature on delivery.'
          : 'Customer reports non-delivery of an order marked delivered; needs a carrier investigation.',
        customerReason: 'Our records show this order as delivered, so we will check the delivery details with the carrier.',
      });
    }

    for (const item of claimed) {
      if (item.refunded) {
        excluded.push(item);
        rules.push({
          ruleId: 'P-03',
          outcome: 'deny',
          itemIds: [item.id],
          detail: `${item.name} was already refunded.`,
          customerReason: `${item.name} has already been refunded.`,
        });
        continue;
      }

      if (item.finalSale) {
        if (isDefect) {
          rules.push({
            ruleId: 'P-06',
            outcome: 'escalate',
            itemIds: [item.id],
            detail: `${item.name} is final sale but reported as ${reason}; exception requires agent review.`,
            customerReason: `${item.name} was sold as final sale, so problems with it are handled case by case.`,
          });
          excluded.push(item);
        } else {
          excluded.push(item);
          rules.push({
            ruleId: 'P-06',
            outcome: 'deny',
            itemIds: [item.id],
            detail: `${item.name} is final sale.`,
            customerReason: `${item.name} was sold as final sale, so it is not eligible for a refund.`,
          });
        }
        continue;
      }

      if (isDefect) {
        if (age > POLICY_LIMITS.defectWindowDays) {
          excluded.push(item);
          rules.push({
            ruleId: 'P-04',
            outcome: 'deny',
            itemIds: [item.id],
            detail: `Delivered ${age} days ago; defect window is ${POLICY_LIMITS.defectWindowDays} days.`,
            customerReason: `Damaged or incorrect items must be reported within ${POLICY_LIMITS.defectWindowDays} days of delivery. This order was delivered ${age} days ago.`,
          });
        } else {
          eligible.push(item);
          rules.push({
            ruleId: 'P-04',
            outcome: 'pass',
            itemIds: [item.id],
            detail: `${item.name}: ${reason} reported ${age} days after delivery (limit ${POLICY_LIMITS.defectWindowDays}).`,
          });
        }
      } else if (reason === 'change_of_mind') {
        if (age > POLICY_LIMITS.changeOfMindWindowDays) {
          excluded.push(item);
          rules.push({
            ruleId: 'P-05',
            outcome: 'deny',
            itemIds: [item.id],
            detail: `Change of mind ${age} days after delivery; limit is ${POLICY_LIMITS.changeOfMindWindowDays}.`,
            customerReason: `Change-of-mind refunds are accepted within ${POLICY_LIMITS.changeOfMindWindowDays} days of delivery. This order was delivered ${age} days ago.`,
          });
        } else {
          eligible.push(item);
          rules.push({
            ruleId: 'P-05',
            outcome: 'pass',
            itemIds: [item.id],
            detail: `${item.name}: change of mind ${age} days after delivery (limit ${POLICY_LIMITS.changeOfMindWindowDays}).`,
          });
        }
      } else if (reason === 'not_received') {
        // Already escalated above; amount is still computed so the agent sees what's at stake.
        eligible.push(item);
      }
      // 'other' / 'unclear' are handled by P-12 below; items are neither eligible nor excluded.
    }
  }

  // ---- P-12 Unclear request ---------------------------------------------------------------------
  if (reason === 'unclear' || reason === 'other' || assessment.confidence < POLICY_LIMITS.minConfidence) {
    rules.push({
      ruleId: 'P-12',
      outcome: 'escalate',
      detail: `Reason "${reason}" at confidence ${assessment.confidence.toFixed(2)} (min ${POLICY_LIMITS.minConfidence}).`,
      customerReason: 'We could not work out the reason for your request from your message.',
    });
  }

  const refundCents = sumCents(eligible);
  const refundAmount = refundCents / 100;

  // ---- P-10 Conflicting claims ------------------------------------------------------------------
  const conflicts: string[] = [];
  if (assessment.mentionsItemsNotInOrder) {
    conflicts.push('Customer refers to items that are not in this order.');
  }
  const claimedCents = sumCents(claimed);
  const claimedValue = claimedCents / 100;
  if (assessment.customerRequestedAmount !== null && Math.round(assessment.customerRequestedAmount * 100) > claimedCents) {
    conflicts.push(`Customer asked for ${money(assessment.customerRequestedAmount)} but the items were ${money(claimedValue)}.`);
  }
  conflicts.push(...assessment.inconsistencies);
  if (conflicts.length > 0) {
    rules.push({
      ruleId: 'P-10',
      outcome: 'escalate',
      detail: conflicts.join(' '),
      customerReason: 'Some details in your request do not match our order records.',
    });
  }

  // ---- P-09 Account risk -------------------------------------------------------------------------
  if (customer.riskFlag || input.recentRefundCount >= POLICY_LIMITS.riskRefundCount) {
    rules.push({
      ruleId: 'P-09',
      outcome: 'escalate',
      // No customerReason on purpose: we don't tell a customer that their account is under risk review.
      detail: `Account risk: riskFlag=${customer.riskFlag}, refunds in last ${POLICY_LIMITS.riskLookbackDays}d=${input.recentRefundCount}.`,
    });
  }

  // ---- P-08 High value ---------------------------------------------------------------------------
  if (refundCents > POLICY_LIMITS.autoApproveMaxAmount * 100) {
    rules.push({
      ruleId: 'P-08',
      outcome: 'escalate',
      detail: `Refund amount ${money(refundAmount)} exceeds auto-approval limit ${money(POLICY_LIMITS.autoApproveMaxAmount)}.`,
      customerReason: `Refunds over ${money(POLICY_LIMITS.autoApproveMaxAmount)} are always reviewed by a person.`,
    });
  }

  // ---- Combine ----------------------------------------------------------------------------------
  const decision = combine(rules, terminalDeny, eligible.length);
  if (decision === 'APPROVED' && excluded.length > 0) {
    rules.push({
      ruleId: 'P-13',
      outcome: 'info',
      itemIds: excluded.map((i) => i.id),
      detail: `Partial refund: ${excluded.map((i) => i.name).join(', ')} excluded.`,
    });
  }

  return {
    decision,
    refundAmount: decision === 'DENIED' ? 0 : refundAmount,
    eligibleItemIds: decision === 'DENIED' ? [] : eligible.map((i) => i.id),
    excludedItemIds: excluded.map((i) => i.id),
    rules,
  };
}

/**
 * Precedence:
 *  1. Manipulation attempts always go to a human (security visibility).
 *  2. Hard data-driven denials (status, duplicate) stand: no money can move, so there is nothing to review.
 *  3. Any other escalation trigger means a human decides.
 *  4. Otherwise approve if something is eligible, else deny.
 */
function combine(rules: RuleResult[], terminalDeny: boolean, eligibleCount: number): Decision {
  if (rules.some((r) => r.ruleId === 'P-11' && r.outcome === 'escalate')) return 'ESCALATED';
  if (terminalDeny) return 'DENIED';
  if (rules.some((r) => r.outcome === 'escalate')) {
    // A risk/conflict flag on a request that is already ineligible on the facts is still a denial.
    const onlySoftEscalations = rules
      .filter((r) => r.outcome === 'escalate')
      .every((r) => r.ruleId === 'P-09' || r.ruleId === 'P-10' || r.ruleId === 'P-12');
    const hasHardDeny = rules.some((r) => r.outcome === 'deny');
    if (onlySoftEscalations && eligibleCount === 0 && hasHardDeny) return 'DENIED';
    return 'ESCALATED';
  }
  if (eligibleCount > 0) return 'APPROVED';
  return 'DENIED';
}
