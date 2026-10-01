import type { Decision, Status } from '@/lib/api';

/** Agent view: one badge that combines the automated decision and the review status. */
export function requestStatus(decision: Decision, status: Status): { label: string; tone: Decision } {
  switch (status) {
    case 'pending_review':
      return { label: 'Needs review', tone: 'ESCALATED' };
    case 'resolved_approved':
      return { label: 'Agent approved', tone: 'APPROVED' };
    case 'resolved_denied':
      return { label: 'Agent denied', tone: 'DENIED' };
    case 'closed':
      return decision === 'APPROVED' ? { label: 'Auto-approved', tone: 'APPROVED' } : { label: 'Auto-denied', tone: 'DENIED' };
  }
}

export function RequestStatusBadge({ decision, status }: { decision: Decision; status: Status }) {
  const s = requestStatus(decision, status);
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

/** Customer-facing wording: plain language instead of internal decision codes. */
const CUSTOMER_LABEL: Record<Decision, string> = {
  APPROVED: 'Refund approved',
  DENIED: 'Not eligible',
  ESCALATED: 'Under review',
};

export function CustomerDecisionBadge({ decision, label }: { decision: Decision; label?: string }) {
  return <span className={`badge badge-${decision}`}>{label ?? CUSTOMER_LABEL[decision]}</span>;
}
