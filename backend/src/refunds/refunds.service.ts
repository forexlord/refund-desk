import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Customer, PolicyDecision, RuleResult } from '../common/domain';
import { AiService } from '../ai/ai.service';
import { ReplyFacts } from '../ai/prompts';
import { CrmRepository } from '../crm/crm.repository';
import { evaluatePolicy, POLICY_LIMITS, POLICY_VERSION } from '../policy/policy.engine';
import { inspectMessage } from '../security/injection-guard';
import { AuditEventInput, ConcurrentRefundError, RefundsRepository } from './refunds.repository';

export interface RefundResponse {
  requestId: string;
  orderId: string;
  decision: PolicyDecision['decision'];
  status: string;
  refundAmount: number;
  /** Items the refund covers (approved or under review); empty when denied. */
  itemIds: string[];
  reply: string;
  createdAt: string;
}

/**
 * Orchestrates one refund request end to end:
 *
 *   input guard -> load CRM facts -> AI classification -> policy engine -> AI reply (+ output guard) -> persist + audit
 *
 * Each stage writes an audit event, so an agent can see exactly why a decision was made.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly crm: CrmRepository,
    private readonly refunds: RefundsRepository,
    private readonly ai: AiService,
  ) {}

  async submit(customer: Customer, orderId: string, rawMessage: string): Promise<RefundResponse> {
    const started = Date.now();
    const now = new Date();
    const audit: AuditEventInput[] = [];

    // 1. Ownership: the order must belong to the signed-in customer. We return 404 rather than 403
    //    so the endpoint doesn't reveal which order IDs exist.
    const order = await this.crm.getOrder(orderId);
    if (!order || order.customerId !== customer.id) {
      throw new NotFoundException('Order not found for this customer.');
    }

    // 2. Deterministic input guard.
    const guard = inspectMessage(rawMessage);
    audit.push({
      eventType: 'request_received',
      actor: `customer:${customer.id}`,
      detail: { orderId, messageLength: guard.sanitized.length, inputGuardFlags: guard.flags },
    });

    // 3. AI classification + CRM lookups in parallel.
    const [ai, recentRefundCount, hasOpenRequestForOrder] = await Promise.all([
      this.ai.classify(order, guard.sanitized, now),
      this.crm.countRecentRefunds(customer.id, POLICY_LIMITS.riskLookbackDays),
      this.refunds.hasOpenRequest(order.id),
    ]);
    audit.push({
      eventType: 'ai_assessment',
      actor: ai.mode === 'llm' ? `ai:${ai.model}` : 'system:fallback-classifier',
      detail: { mode: ai.mode, assessment: ai.assessment, flags: ai.flags, ...(ai.error ? { error: ai.error } : {}) },
    });

    // 4. Policy engine: the only place a decision is made.
    const securityFlags = [...guard.flags, ...ai.flags];
    const policy = evaluatePolicy({
      customer,
      order,
      assessment: ai.assessment,
      securityFlags,
      recentRefundCount,
      hasOpenRequestForOrder,
      now,
    });
    audit.push({
      eventType: 'policy_evaluated',
      actor: `policy-engine:${POLICY_VERSION}`,
      detail: {
        decision: policy.decision,
        refundAmount: policy.refundAmount,
        eligibleItemIds: policy.eligibleItemIds,
        excludedItemIds: policy.excludedItemIds,
        recentRefundCount,
        hasOpenRequestForOrder,
        triggeredRules: policy.rules.filter((r) => r.outcome !== 'pass').map((r) => r.ruleId),
      },
    });

    // 5. Customer reply (the LLM never sees the raw customer message at this stage).
    const itemName = (id: string) => order.items.find((i) => i.id === id)?.name ?? id;
    const facts: ReplyFacts = {
      customerFirstName: customer.name.split(' ')[0],
      orderId: order.id,
      decision: policy.decision,
      refundAmount: policy.refundAmount,
      refundedItems: policy.eligibleItemIds.map(itemName),
      excludedItems: policy.decision === 'APPROVED' ? policy.excludedItemIds.map(itemName) : [],
      reasons: customerReasons(policy),
    };
    const reply = await this.ai.writeReply(facts);
    audit.push({
      eventType: 'reply_generated',
      actor: reply.source === 'llm' ? `ai:${this.ai.model}` : 'system:template',
      detail: { source: reply.source, outputGuardProblems: reply.problems, ...(reply.error ? { error: reply.error } : {}) },
    });

    const status = policy.decision === 'ESCALATED' ? 'pending_review' : 'closed';
    audit.push({
      eventType: 'decision_recorded',
      actor: 'system',
      detail: { decision: policy.decision, status, refundAmount: policy.refundAmount },
    });

    const outputFlags = reply.problems.map((p) => ({ source: 'output_guard' as const, code: 'reply_rejected', detail: p }));

    try {
      const requestId = await this.refunds.create(
        {
          customerId: customer.id,
          orderId: order.id,
          customerMessage: guard.sanitized,
          decision: policy.decision,
          status,
          refundAmount: policy.refundAmount,
          itemIds: policy.eligibleItemIds,
          reasonCategory: ai.assessment.reasonCategory,
          customerReply: reply.reply,
          aiAssessment: ai.assessment,
          ruleResults: policy.rules,
          securityFlags: [...securityFlags, ...outputFlags],
          aiMode: ai.mode,
          aiModel: ai.model,
          policyVersion: POLICY_VERSION,
          latencyMs: Date.now() - started,
        },
        audit,
      );
      this.logger.log(`Request ${requestId} order=${order.id} decision=${policy.decision} amount=${policy.refundAmount} ai=${ai.mode}`);
      return {
        requestId,
        orderId: order.id,
        decision: policy.decision,
        status,
        refundAmount: policy.refundAmount,
        itemIds: policy.eligibleItemIds,
        reply: reply.reply,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof ConcurrentRefundError) {
        throw new ConflictException('This order was just updated by another request. Please refresh and try again.');
      }
      throw err;
    }
  }
}

/**
 * Pick the customer-safe explanations that match the final decision.
 * For manipulation escalations, don't tell the customer what was detected.
 */
export function customerReasons(policy: PolicyDecision): string[] {
  const pick = (outcome: RuleResult['outcome']) => policy.rules.filter((r) => r.outcome === outcome && r.customerReason);
  let selected: RuleResult[];
  switch (policy.decision) {
    case 'DENIED':
      selected = pick('deny');
      break;
    case 'ESCALATED':
      selected = policy.rules.some((r) => r.ruleId === 'P-11' && r.outcome === 'escalate')
        ? [] // generic escalation message only
        : pick('escalate');
      break;
    case 'APPROVED':
      selected = pick('deny'); // explains excluded items in a partial refund
      break;
  }
  return [...new Set(selected.map((r) => r.customerReason!))];
}
