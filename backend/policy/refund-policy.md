# Refund Policy

**Version:** 2026.1
**Applies to:** All orders placed through the online store.

Every rule has an ID. The refund engine enforces these rules in code (`backend/src/policy/policy.engine.ts`), and each decision records which rules applied. The AI assistant reads this document for context only. It cannot approve, deny, or change any rule.

## 1. Eligibility

- **P-01 Ownership.** A refund can only be requested by the customer who placed the order.
- **P-02 Order status.** Only delivered orders are eligible for refunds.
  - Orders still *processing* are not refunded. The customer should cancel the order instead.
  - Cancelled orders have already been voided and are not eligible.
  - *Shipped* orders that have not arrived by the expected delivery date are escalated to a support agent for a carrier investigation.
- **P-03 No duplicates.** An item that has already been refunded cannot be refunded again. If a refund request is already under review for the same order, a new request is not opened.

## 2. Time limits

- **P-04 Damaged, defective, or incorrect items** must be reported within **30 days** of delivery.
- **P-05 Change of mind** (unwanted, doesn't fit, no longer needed) refunds are accepted within **14 days** of delivery.
- Requests made after these windows are denied.

## 3. Final sale

- **P-06 Final sale items** are not eligible for a refund.
  - Exception: if a final sale item arrived damaged, defective, or was the wrong item, the request is escalated to a support agent. It is not approved automatically.

## 4. Automatic approval

- **P-07** A request that passes every rule above is approved automatically if it is either:
  - a damaged, defective, or incorrect item within 30 days, or
  - a change of mind within 14 days on an item that is not final sale.
- The refund amount is always calculated from the price the customer paid for the eligible items. The customer does not set the amount.

## 5. Human review

A request is **escalated** to a support agent instead of being decided automatically when any of the following apply:

- **P-08 High value.** The refund amount is above **$500.00**.
- **P-09 Account risk.** The account has been flagged by the risk team, or the customer has received **3 or more refunds in the last 90 days**.
- **P-10 Conflicting claims.** What the customer says conflicts with the order record. Examples: they claim an item that isn't in the order, they ask for more money than they paid, or they say a parcel never arrived when it was signed for on delivery.
- **P-11 Manipulation attempts.** The request tries to instruct the system, bypass this policy, or impersonate staff.
- **P-12 Unclear request.** The reason for the refund cannot be determined with reasonable confidence.

## 6. Partial refunds

- **P-13** When an order contains both eligible and ineligible items, only the eligible items are refunded. The customer is told which items were excluded and why.
