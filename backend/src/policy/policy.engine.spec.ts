import { Customer, Order, OrderItem, RefundAssessment, SecurityFlag } from '../common/domain';
import { evaluatePolicy, PolicyInput } from './policy.engine';

const NOW = new Date('2026-09-29T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'C001', name: 'Ada Okafor', email: 'a@x.com', tier: 'standard', riskFlag: false, notes: null, ...over,
});

const item = (over: Partial<OrderItem> = {}): OrderItem => ({
  id: 'IT-1', sku: 'SKU', name: 'Headphones', category: 'electronics', unitPrice: 89.99, quantity: 1, finalSale: false, refunded: false, ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: 'ORD-1', customerId: 'C001', placedAt: daysAgo(10), status: 'delivered', expectedDelivery: daysAgo(5),
  deliveredAt: daysAgo(5), signatureOnDelivery: false, total: 89.99, items: [item()], ...over,
});

const assessment = (over: Partial<RefundAssessment> = {}): RefundAssessment => ({
  reasonCategory: 'damaged_defective', claimedItemIds: [], mentionsItemsNotInOrder: false, customerRequestedAmount: null,
  summary: '', confidence: 0.9, manipulationAttempt: false, manipulationEvidence: null, inconsistencies: [], ...over,
});

const run = (over: Partial<PolicyInput> = {}) =>
  evaluatePolicy({
    customer: customer(), order: order(), assessment: assessment(), securityFlags: [],
    recentRefundCount: 0, hasOpenRequestForOrder: false, now: NOW, ...over,
  });

const ruleIds = (r: ReturnType<typeof run>, outcome?: string) =>
  r.rules.filter((x) => !outcome || x.outcome === outcome).map((x) => x.ruleId);

describe('policy engine', () => {
  it('approves a damaged item inside 30 days, using the paid price', () => {
    const r = run();
    expect(r.decision).toBe('APPROVED');
    expect(r.refundAmount).toBe(89.99);
    expect(r.eligibleItemIds).toEqual(['IT-1']);
  });

  it('denies a damaged item reported after 30 days', () => {
    const r = run({ order: order({ deliveredAt: daysAgo(62) }) });
    expect(r.decision).toBe('DENIED');
    expect(r.refundAmount).toBe(0);
    expect(ruleIds(r, 'deny')).toContain('P-04');
  });

  it('approves change of mind within 14 days, denies after', () => {
    expect(run({ assessment: assessment({ reasonCategory: 'change_of_mind' }), order: order({ deliveredAt: daysAgo(7) }) }).decision).toBe('APPROVED');
    const late = run({ assessment: assessment({ reasonCategory: 'change_of_mind' }), order: order({ deliveredAt: daysAgo(20) }) });
    expect(late.decision).toBe('DENIED');
    expect(ruleIds(late, 'deny')).toContain('P-05');
  });

  it('denies final sale on change of mind', () => {
    const r = run({ order: order({ items: [item({ finalSale: true })] }), assessment: assessment({ reasonCategory: 'change_of_mind' }) });
    expect(r.decision).toBe('DENIED');
    expect(ruleIds(r, 'deny')).toContain('P-06');
  });

  it('escalates damaged final-sale items instead of approving', () => {
    const r = run({ order: order({ items: [item({ finalSale: true })] }) });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r, 'escalate')).toContain('P-06');
  });

  it('escalates refunds above $500', () => {
    const r = run({ order: order({ items: [item({ unitPrice: 1299 })], total: 1299 }) });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r, 'escalate')).toContain('P-08');
    expect(r.refundAmount).toBe(1299);
  });

  it('does not escalate at exactly $500', () => {
    expect(run({ order: order({ items: [item({ unitPrice: 500 })] }) }).decision).toBe('APPROVED');
  });

  it('partial refund: approves eligible items and excludes final sale', () => {
    const r = run({
      assessment: assessment({ reasonCategory: 'change_of_mind' }),
      order: order({ items: [item({ id: 'A', unitPrice: 60 }), item({ id: 'B', unitPrice: 25, finalSale: true })] }),
    });
    expect(r.decision).toBe('APPROVED');
    expect(r.refundAmount).toBe(60);
    expect(r.excludedItemIds).toEqual(['B']);
  });

  it('only refunds items the customer named', () => {
    const r = run({
      assessment: assessment({ claimedItemIds: ['B'] }),
      order: order({ items: [item({ id: 'A', unitPrice: 480 }), item({ id: 'B', unitPrice: 35 })] }),
    });
    expect(r.decision).toBe('APPROVED');
    expect(r.refundAmount).toBe(35);
  });

  it('ignores item IDs that are not in the order', () => {
    const r = run({ assessment: assessment({ claimedItemIds: ['FAKE-999'] }) });
    expect(r.eligibleItemIds).toEqual(['IT-1']);
    expect(r.refundAmount).toBe(89.99);
  });

  it('denies processing and cancelled orders', () => {
    expect(run({ order: order({ status: 'processing', deliveredAt: null }) }).decision).toBe('DENIED');
    expect(run({ order: order({ status: 'cancelled', deliveredAt: null }) }).decision).toBe('DENIED');
  });

  it('escalates overdue shipped orders reported as not received', () => {
    const r = run({
      order: order({ status: 'shipped', deliveredAt: null, expectedDelivery: daysAgo(8) }),
      assessment: assessment({ reasonCategory: 'not_received' }),
    });
    expect(r.decision).toBe('ESCALATED');
  });

  it('denies shipped orders that are not yet overdue', () => {
    const r = run({
      order: order({ status: 'shipped', deliveredAt: null, expectedDelivery: new Date(NOW.getTime() + 86_400_000) }),
      assessment: assessment({ reasonCategory: 'not_received' }),
    });
    expect(r.decision).toBe('DENIED');
  });

  it('escalates "not received" when the parcel was signed for', () => {
    const r = run({ order: order({ signatureOnDelivery: true }), assessment: assessment({ reasonCategory: 'not_received' }) });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r, 'escalate')).toContain('P-10');
  });

  it('denies already refunded items', () => {
    const r = run({ order: order({ items: [item({ refunded: true })] }) });
    expect(r.decision).toBe('DENIED');
    expect(ruleIds(r, 'deny')).toContain('P-03');
  });

  it('denies when a request is already pending review', () => {
    expect(run({ hasOpenRequestForOrder: true }).decision).toBe('DENIED');
  });

  it('escalates risk-flagged accounts and frequent refunders', () => {
    expect(run({ customer: customer({ riskFlag: true }) }).decision).toBe('ESCALATED');
    expect(run({ recentRefundCount: 3 }).decision).toBe('ESCALATED');
    expect(run({ recentRefundCount: 2 }).decision).toBe('APPROVED');
  });

  it('still denies a risk-flagged request that is ineligible on the facts', () => {
    const r = run({ customer: customer({ riskFlag: true }), order: order({ deliveredAt: daysAgo(90) }) });
    expect(r.decision).toBe('DENIED');
  });

  it('escalates when the customer asks for more than they paid', () => {
    const r = run({ assessment: assessment({ customerRequestedAmount: 500 }) });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r, 'escalate')).toContain('P-10');
  });

  it('escalates AI-reported inconsistencies (AI can only add caution)', () => {
    const r = run({ assessment: assessment({ inconsistencies: ['Describes a blue jacket; order contains headphones.'] }) });
    expect(r.decision).toBe('ESCALATED');
  });

  it('escalates unclear or low-confidence classifications', () => {
    expect(run({ assessment: assessment({ reasonCategory: 'unclear' }) }).decision).toBe('ESCALATED');
    expect(run({ assessment: assessment({ confidence: 0.4 }) }).decision).toBe('ESCALATED');
  });

  it('escalates any manipulation attempt, even on an otherwise approvable request', () => {
    const flags: SecurityFlag[] = [{ source: 'input_guard', code: 'instruction_override', detail: '' }];
    const r = run({ securityFlags: flags });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r, 'escalate')).toContain('P-11');
  });

  it('escalates manipulation attempts even when the facts would deny', () => {
    const flags: SecurityFlag[] = [{ source: 'ai_classifier', code: 'llm_detected_manipulation', detail: '' }];
    expect(run({ securityFlags: flags, order: order({ deliveredAt: daysAgo(90) }) }).decision).toBe('ESCALATED');
  });

  describe('exact money', () => {
    it('sums prices in cents, without floating-point drift', () => {
      // 0.1 + 0.2 !== 0.3 in floating point; three 0.10 items plus one 0.20 must still be exactly 0.50.
      const items = [item({ id: 'A', unitPrice: 0.1, quantity: 3 }), item({ id: 'B', unitPrice: 0.2 })];
      expect(run({ order: order({ items, total: 0.5 }) }).refundAmount).toBe(0.5);
    });

    it('escalates at one cent over the $500 limit, not at exactly $500', () => {
      expect(run({ order: order({ items: [item({ unitPrice: 500 })] }) }).decision).toBe('APPROVED');
      expect(run({ order: order({ items: [item({ unitPrice: 500.01 })] }) }).decision).toBe('ESCALATED');
    });
  });
});
