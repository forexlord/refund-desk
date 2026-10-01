import Link from 'next/link';
import { CustomerDecisionBadge } from '@/components/Badges';
import { Decision, money } from '@/lib/api';

interface Props {
  decision: Decision;
  /** Overrides the default badge text, e.g. "Approved after review". */
  label?: string;
  amount: number;
  itemNames: string[];
  requestId: string;
}

/** Structured result shown under an assistant reply: what was decided, for how much, and what happens next. */
export function OutcomeCard({ decision, label, amount, itemNames, requestId }: Props) {
  return (
    <div className={`outcome outcome-${decision}`}>
      <div className="outcome-top">
        <CustomerDecisionBadge decision={decision} label={label} />
        {decision === 'APPROVED' && <strong className="outcome-amount">{money(amount)}</strong>}
      </div>
      {decision !== 'DENIED' && itemNames.length > 0 && <div className="outcome-items">{itemNames.join(' · ')}</div>}
      <div className="outcome-next">
        {decision === 'APPROVED' && 'Refunded to your original payment method.'}
        {decision === 'ESCALATED' && "A member of our support team will review this. You'll see their decision here."}
        {decision === 'DENIED' && (
          <>
            See the <Link href="/policy">refund policy</Link> for what qualifies.
          </>
        )}
      </div>
      <div className="outcome-ref">Reference #{requestId.slice(0, 8).toUpperCase()}</div>
    </div>
  );
}
