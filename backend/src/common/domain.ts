// Shared domain types. These are kept free of framework imports so the policy engine and guards
// remain pure, easy-to-test functions.

export type Decision = 'APPROVED' | 'DENIED' | 'ESCALATED';

export type RequestStatus = 'closed' | 'pending_review' | 'resolved_approved' | 'resolved_denied';

export const REASON_CATEGORIES = [
  'damaged_defective',
  'wrong_item',
  'not_as_described',
  'not_received',
  'change_of_mind',
  'other',
  'unclear',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: string;
  riskFlag: boolean;
  notes: string | null;
}

export interface OrderItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  quantity: number;
  finalSale: boolean;
  refunded: boolean;
}

export interface Order {
  id: string;
  customerId: string;
  placedAt: Date;
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
  expectedDelivery: Date | null;
  deliveredAt: Date | null;
  signatureOnDelivery: boolean;
  total: number;
  items: OrderItem[];
}

/**
 * What the AI layer (or the keyword fallback) extracted from the customer's free-text message.
 * This is an *interpretation* of untrusted input, never a decision.
 */
export interface RefundAssessment {
  reasonCategory: ReasonCategory;
  claimedItemIds: string[];
  mentionsItemsNotInOrder: boolean;
  customerRequestedAmount: number | null;
  summary: string;
  confidence: number;
  manipulationAttempt: boolean;
  manipulationEvidence: string | null;
  inconsistencies: string[];
}

export type SecurityFlagSource = 'input_guard' | 'ai_classifier' | 'output_guard';

export interface SecurityFlag {
  source: SecurityFlagSource;
  code: string;
  detail: string;
}

export type RuleOutcome = 'pass' | 'deny' | 'escalate' | 'info';

export interface RuleResult {
  ruleId: string;
  outcome: RuleOutcome;
  /** Internal explanation for support agents. */
  detail: string;
  /** Safe, plain-language explanation that may be shown to the customer. */
  customerReason?: string;
  itemIds?: string[];
}

export interface PolicyDecision {
  decision: Decision;
  refundAmount: number;
  eligibleItemIds: string[];
  excludedItemIds: string[];
  rules: RuleResult[];
}
