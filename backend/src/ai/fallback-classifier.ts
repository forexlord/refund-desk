import { Order, ReasonCategory, RefundAssessment } from '../common/domain';

/**
 * Keyword classifier used when no API key is configured or the LLM call fails.
 * It is intentionally simple and conservative: low confidence leads to escalation (P-12),
 * so a weak classification can never produce an automatic approval by itself.
 */

const RULES: Array<{ category: ReasonCategory; re: RegExp }> = [
  { category: 'not_received', re: /\b(never (arrived|came|received|got)|(has|have|hasn'?t|haven'?t|did not|didn'?t|not) (yet )?(arrive|arrived|receive|received|get|got|come)|missing (package|parcel|order)|lost (in|package|parcel)|where is my (order|package|parcel))\b/i },
  { category: 'wrong_item', re: /\b(wrong (item|size|colou?r|product|model|one)|incorrect (item|size|product)|not what i ordered|different (item|product|colou?r|size) than|sent me (the )?(a )?(wrong|different))\b/i },
  { category: 'damaged_defective', re: /\b(damaged|broken|cracked|shattered|defective|faulty|torn|dented|leaking|scratched|not working|doesn'?t work|stopped working|won'?t (turn on|charge|work)|dead on arrival|malfunction\w*)\b/i },
  { category: 'not_as_described', re: /\b(not as described|doesn'?t match (the )?(description|photos?|pictures?)|looks nothing like|misleading)\b/i },
  { category: 'change_of_mind', re: /\b(changed my mind|change of mind|don'?t (want|need|like) it|no longer (want|need)|doesn'?t fit|too (small|big|large|tight|loose)|not for me|ordered by mistake|found (it )?cheaper|return it)\b/i },
];

export function fallbackClassify(order: Order, message: string): RefundAssessment {
  const text = message.toLowerCase();
  const hit = RULES.find((r) => r.re.test(message));

  const claimedItemIds = order.items
    .filter((item) => {
      const words = item.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => text.includes(w));
    })
    .map((i) => i.id);

  const amountMatch = message.match(/\$\s?(\d{1,6}(?:\.\d{1,2})?)/);

  return {
    reasonCategory: hit ? hit.category : 'unclear',
    claimedItemIds,
    mentionsItemsNotInOrder: false,
    customerRequestedAmount: amountMatch ? Number(amountMatch[1]) : null,
    summary: hit
      ? `Keyword classifier matched "${hit.category}".`
      : 'Keyword classifier could not determine a reason.',
    confidence: hit ? 0.7 : 0.2,
    manipulationAttempt: false, // input guard covers this deterministically
    manipulationEvidence: null,
    inconsistencies: [],
  };
}
