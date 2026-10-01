import { ReplyFacts } from './prompts';

/**
 * Output guard for customer-facing replies written by the LLM.
 * If a reply could mislead the customer about the decision or the amount, it is discarded
 * and replaced by the deterministic template.
 */

const APPROVAL_LANGUAGE = /\b(approved|we('| a)?ve (issued|processed)|will (be )?(issue|refund)(ed)?|refund (has been|is being|will be) (issued|processed|sent)|you will receive (a|your) refund)\b/i;
const DENIAL_LANGUAGE = /\b(denied|declined|rejected|not eligible|unable to (offer|provide|issue) a refund)\b/i;
const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;

export interface ReplyCheck {
  ok: boolean;
  problems: string[];
}

export function checkReply(reply: string, facts: ReplyFacts): ReplyCheck {
  const problems: string[] = [];
  const text = reply.trim();

  if (text.length < 20) problems.push('Reply too short.');
  if (text.length > 1200) problems.push('Reply too long.');
  if (/\bP-\d{2}\b/.test(text)) problems.push('Leaks internal rule IDs.');

  const amounts = (text.match(MONEY) ?? []).map((m) => Number(m.replace(/[$,\s]/g, '')));
  if (facts.decision === 'APPROVED') {
    const expected = facts.refundAmount.toFixed(2);
    if (!text.includes(expected)) problems.push(`Approved reply does not state the exact amount $${expected}.`);
    if (amounts.some((a) => Math.abs(a - facts.refundAmount) > 0.005 && a > facts.refundAmount)) {
      problems.push('Reply mentions an amount larger than the approved refund.');
    }
    if (DENIAL_LANGUAGE.test(text) && facts.excludedItems.length === 0) problems.push('Approved reply contains denial language.');
  } else {
    if (APPROVAL_LANGUAGE.test(text)) problems.push(`${facts.decision} reply contains approval language.`);
    // Money is only allowed when quoting a policy threshold (e.g. "over $500") in an escalation.
    if (facts.decision === 'DENIED' && amounts.length > 0) problems.push('Denied reply mentions a money amount.');
  }
  if (facts.decision === 'ESCALATED' && DENIAL_LANGUAGE.test(text)) problems.push('Escalated reply states a denial.');

  return { ok: problems.length === 0, problems };
}

export function templateReply(f: ReplyFacts): string {
  const name = f.customerFirstName;
  const reasons = f.reasons.length > 0 ? ' ' + f.reasons.join(' ') : '';
  switch (f.decision) {
    case 'APPROVED': {
      const items = f.refundedItems.join(', ');
      const excluded = f.excludedItems.length > 0 ? ` ${f.excludedItems.join(', ')} could not be included.${reasons}` : '';
      return `Hi ${name}, your refund of $${f.refundAmount.toFixed(2)} for ${items} (order ${f.orderId}) has been approved and will go back to your original payment method.${excluded}`;
    }
    case 'DENIED':
      return `Hi ${name}, we're sorry, but we can't offer a refund for order ${f.orderId}.${reasons}`;
    case 'ESCALATED':
      return `Hi ${name}, thanks for getting in touch about order ${f.orderId}. A member of our support team will review your request, and you'll see their decision here.${reasons}`;
  }
}
