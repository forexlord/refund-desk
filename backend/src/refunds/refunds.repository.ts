import { Injectable } from '@nestjs/common';
import { DatabaseError, PoolClient } from 'pg';
import { Decision, RequestStatus } from '../common/domain';
import { Cursor, encodeCursor } from '../common/cursor';
import { Database } from '../database/database.module';

export interface NewRefundRequest {
  customerId: string;
  orderId: string;
  customerMessage: string;
  decision: Decision;
  status: RequestStatus;
  /** Engine's amount in dollars; verified against the database total (to the cent) before commit. */
  refundAmount: number;
  /** Items the request is about: approved items for APPROVED, candidates for ESCALATED, none for DENIED. */
  itemIds: string[];
  reasonCategory: string;
  customerReply: string;
  aiAssessment: unknown;
  ruleResults: unknown;
  securityFlags: unknown;
  aiMode: 'llm' | 'fallback';
  aiModel: string | null;
  policyVersion: string;
  latencyMs: number;
}

export interface AuditEventInput {
  eventType: string;
  actor: string;
  detail: Record<string, unknown>;
}

/** Items a request covers: the approved ones once approved, otherwise every linked item. */
const COVERED_ITEM_IDS = `ARRAY(
  SELECT ri.order_item_id FROM refund_request_items ri
   WHERE ri.refund_request_id = r.id
     AND (ri.approved OR (r.decision <> 'APPROVED' AND r.status <> 'resolved_approved'))
   ORDER BY ri.order_item_id)`;

const isOneApprovalViolation = (err: unknown) =>
  err instanceof DatabaseError && err.code === '23505' && err.constraint === 'ux_refund_request_items_one_approval';

export interface RequestFilters {
  decision?: Decision;
  status?: RequestStatus;
  limit: number;
  cursor?: Cursor;
}

export interface Page<T> {
  items: T[];
  /** Pass back to get the next page; null when there are no more rows. */
  nextCursor: string | null;
}

export interface RequestRow {
  id: string;
  customerId: string;
  customerName: string;
  orderId: string;
  decision: Decision;
  status: RequestStatus;
  refundAmount: number;
  reasonCategory: string | null;
  aiMode: 'llm' | 'fallback';
  securityFlagCount: number;
  messagePreview: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CustomerRequestRow {
  id: string;
  orderId: string;
  decision: Decision;
  status: RequestStatus;
  refundAmount: number;
  itemIds: string[];
  customerMessage: string;
  customerReply: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

@Injectable()
export class RefundsRepository {
  constructor(private readonly db: Database) {}

  async hasOpenRequest(orderId: string): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT 1 FROM refund_requests WHERE order_id = $1 AND status = 'pending_review' LIMIT 1`, [orderId]);
    return rows.length > 0;
  }

  /**
   * Persist the request, its item links, and its audit trail in one transaction. Locking the order row
   * serialises requests for the same order; the one-approval index is the database-level backstop, so an
   * item can never be refunded twice even if two approvals race.
   */
  async create(input: NewRefundRequest, events: AuditEventInput[]): Promise<string> {
    try {
      return await this.db.tx(async (client) => {
        await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [input.orderId]);
        // Re-check under the lock: the service's pre-check ran outside this transaction, so a concurrent
        // submit may have opened a review since. Only a denial may be recorded alongside an open review.
        if (input.decision !== 'DENIED') {
          const open = await client.query(`SELECT 1 FROM refund_requests WHERE order_id = $1 AND status = 'pending_review' LIMIT 1`, [input.orderId]);
          if (open.rows.length > 0) throw new ConcurrentRefundError();
        }

        const { rows } = await client.query(
          `INSERT INTO refund_requests
            (customer_id, order_id, customer_message, decision, status, reason_category,
             customer_reply, ai_assessment, rule_results, security_flags, ai_mode, ai_model, policy_version, latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            input.customerId,
            input.orderId,
            input.customerMessage,
            input.decision,
            input.status,
            input.reasonCategory,
            input.customerReply,
            JSON.stringify(input.aiAssessment),
            JSON.stringify(input.ruleResults),
            JSON.stringify(input.securityFlags),
            input.aiMode,
            input.aiModel,
            input.policyVersion,
            input.latencyMs,
          ],
        );
        const id: string = rows[0].id;

        if (input.itemIds.length > 0) {
          const linked = await client.query(
            `INSERT INTO refund_request_items (refund_request_id, order_id, order_item_id, amount, approved)
             SELECT $1, oi.order_id, oi.id, oi.unit_price * oi.quantity, $4
               FROM order_items oi WHERE oi.order_id = $2 AND oi.id = ANY($3)`,
            [id, input.orderId, input.itemIds, input.decision === 'APPROVED'],
          );
          if (linked.rowCount !== new Set(input.itemIds).size) throw new Error(`Items ${input.itemIds.join(',')} are not all in order ${input.orderId}.`);
        }
        // The amount the customer is told must be the amount recorded. Stop rather than persist a mismatch.
        const total = await client.query(
          `UPDATE refund_requests
              SET refund_amount = (SELECT COALESCE(SUM(amount), 0) FROM refund_request_items WHERE refund_request_id = $1)
            WHERE id = $1 RETURNING refund_amount`,
          [id],
        );
        const recordedCents = Math.round(Number(total.rows[0].refund_amount) * 100);
        const expectedCents = input.decision === 'DENIED' ? 0 : Math.round(input.refundAmount * 100);
        if (recordedCents !== expectedCents) {
          throw new Error(`Refund total mismatch for order ${input.orderId}: engine ${expectedCents}c, database ${recordedCents}c.`);
        }

        await this.insertEvents(client, id, events);
        return id;
      });
    } catch (err) {
      if (isOneApprovalViolation(err)) throw new ConcurrentRefundError();
      throw err;
    }
  }

  /**
   * Agent queue, keyset-paginated over (created_at, id). The review queue (pending_review) runs oldest first so
   * the longest-waiting request is on top; every other view is newest first.
   */
  async list(filters: RequestFilters): Promise<Page<RequestRow>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.decision) {
      params.push(filters.decision);
      where.push(`r.decision = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`r.status = $${params.length}`);
    }
    const asc = filters.status === 'pending_review';
    if (filters.cursor) {
      params.push(filters.cursor.createdAt, filters.cursor.id);
      where.push(`(r.created_at, r.id) ${asc ? '>' : '<'} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(filters.limit + 1); // one extra row tells us whether another page exists
    const dir = asc ? 'ASC' : 'DESC';
    const { rows } = await this.db.query(
      `SELECT r.id, r.customer_id, c.name AS customer_name, r.order_id, r.decision, r.status, r.refund_amount,
              r.reason_category, r.ai_mode, r.created_at, r.created_at::text AS created_at_key, r.resolved_at,
              (SELECT COUNT(*) FROM jsonb_array_elements(r.security_flags) f WHERE f->>'source' <> 'output_guard') AS security_flag_count,
              LEFT(r.customer_message, 160) AS message_preview
         FROM refund_requests r JOIN customers c ON c.id = r.customer_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY r.created_at ${dir}, r.id ${dir}
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, filters.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        orderId: r.order_id,
        decision: r.decision,
        status: r.status,
        refundAmount: Number(r.refund_amount),
        reasonCategory: r.reason_category,
        aiMode: r.ai_mode,
        securityFlagCount: Number(r.security_flag_count),
        messagePreview: r.message_preview,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      })),
      nextCursor: rows.length > filters.limit ? encodeCursor(last.created_at_key, last.id) : null,
    };
  }

  /**
   * A customer's conversation (optionally one order), newest page first. Returned oldest-to-newest for display;
   * `nextCursor` pages back to older requests.
   */
  async listForCustomer(customerId: string, opts: { orderId?: string; before?: Cursor; limit: number }): Promise<Page<CustomerRequestRow>> {
    const params: unknown[] = [customerId];
    const where = ['r.customer_id = $1'];
    if (opts.orderId) {
      params.push(opts.orderId);
      where.push(`r.order_id = $${params.length}`);
    }
    if (opts.before) {
      params.push(opts.before.createdAt, opts.before.id);
      where.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(opts.limit + 1);
    const { rows } = await this.db.query(
      `SELECT r.id, r.order_id, r.decision, r.status, r.refund_amount, ${COVERED_ITEM_IDS} AS item_ids,
              r.customer_message, r.customer_reply, r.created_at, r.created_at::text AS created_at_key, r.resolution_note, r.resolved_at
         FROM refund_requests r WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, opts.limit);
    const oldest = page[page.length - 1];
    return {
      items: page.reverse().map((r) => ({
        id: r.id,
        orderId: r.order_id,
        decision: r.decision,
        status: r.status,
        refundAmount: Number(r.refund_amount),
        itemIds: r.item_ids as string[],
        customerMessage: r.customer_message,
        customerReply: r.customer_reply,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        resolutionNote: r.resolution_note,
      })),
      nextCursor: rows.length > opts.limit ? encodeCursor(oldest.created_at_key, oldest.id) : null,
    };
  }

  async getById(id: string) {
    const { rows } = await this.db.query(
      `SELECT r.*, ${COVERED_ITEM_IDS} AS item_ids,
              c.name AS customer_name, c.email AS customer_email, c.tier AS customer_tier, c.risk_flag AS customer_risk_flag,
              g.name AS resolved_by_name
         FROM refund_requests r
         JOIN customers c ON c.id = r.customer_id
         LEFT JOIN agents g ON g.id = r.resolved_by_agent_id
        WHERE r.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    const events = await this.db.query(`SELECT event_type, actor, detail, created_at FROM audit_events WHERE request_id = $1 ORDER BY id`, [id]);
    return {
      id: r.id,
      customer: { id: r.customer_id, name: r.customer_name, email: r.customer_email, tier: r.customer_tier, riskFlag: r.customer_risk_flag },
      orderId: r.order_id,
      customerMessage: r.customer_message,
      decision: r.decision,
      status: r.status,
      refundAmount: Number(r.refund_amount),
      itemIds: r.item_ids,
      reasonCategory: r.reason_category,
      customerReply: r.customer_reply,
      aiAssessment: r.ai_assessment,
      ruleResults: r.rule_results,
      securityFlags: r.security_flags,
      aiMode: r.ai_mode,
      aiModel: r.ai_model,
      policyVersion: r.policy_version,
      latencyMs: r.latency_ms,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by_name,
      resolvedByAgentId: r.resolved_by_agent_id,
      resolutionNote: r.resolution_note,
      auditTrail: events.rows.map((e) => ({ eventType: e.event_type, actor: e.actor, detail: e.detail, createdAt: e.created_at })),
    };
  }

  /**
   * Resolve an escalated request. Approving refunds exactly the selected whole items (default: the request's
   * candidate items); the amount is their line total, computed in SQL. All checks run inside the transaction
   * with the order row locked, and the one-approval index rejects an item another request already refunded.
   */
  async resolve(id: string, r: Resolution): Promise<void> {
    try {
      await this.db.tx(async (client) => {
        const { rows } = await client.query(`SELECT order_id, status FROM refund_requests WHERE id = $1 FOR UPDATE`, [id]);
        const req = rows[0];
        if (!req) throw new ResolveError('not_found', 'Request not found.');
        if (req.status !== 'pending_review') throw new ResolveError('conflict', 'Request was already resolved.');
        await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [req.order_id]);

        let itemIds: string[] = [];
        if (r.approve) {
          if (r.itemIds) itemIds = [...new Set(r.itemIds)];
          else {
            const linked = await client.query(`SELECT order_item_id FROM refund_request_items WHERE refund_request_id = $1`, [id]);
            itemIds = linked.rows.map((x) => x.order_item_id);
          }
          if (itemIds.length === 0) throw new ResolveError('invalid', 'Select at least one item to refund.');
          const check = await client.query(
            `SELECT COUNT(*)::int AS n, COALESCE(BOOL_OR(legacy_refunded), FALSE) AS legacy
               FROM order_items WHERE order_id = $1 AND id = ANY($2)`,
            [req.order_id, itemIds],
          );
          if (check.rows[0].n !== itemIds.length) throw new ResolveError('invalid', 'One or more items are not in this order.');
          if (check.rows[0].legacy) throw new ResolveError('conflict', 'One or more selected items have already been refunded.');
          // Link any selected item that wasn't a candidate (e.g. a final-sale exception) and mark all selected approved.
          await client.query(
            `INSERT INTO refund_request_items (refund_request_id, order_id, order_item_id, amount, approved)
             SELECT $1, oi.order_id, oi.id, oi.unit_price * oi.quantity, TRUE
               FROM order_items oi WHERE oi.order_id = $2 AND oi.id = ANY($3)
             ON CONFLICT (refund_request_id, order_item_id) DO UPDATE SET approved = TRUE`,
            [id, req.order_id, itemIds],
          );
        }

        const { rows: updated } = await client.query(
          `UPDATE refund_requests
              SET status = $2, resolved_at = NOW(), resolved_by_agent_id = $3, resolution_note = $4,
                  refund_amount = (SELECT COALESCE(SUM(amount), 0) FROM refund_request_items WHERE refund_request_id = $1 AND approved)
            WHERE id = $1 RETURNING refund_amount`,
          [id, r.approve ? 'resolved_approved' : 'resolved_denied', r.agentId, r.note],
        );
        await this.insertEvents(client, id, [
          {
            eventType: r.approve ? 'agent_approved' : 'agent_denied',
            actor: `agent:${r.agentId}`,
            detail: { note: r.note, refundAmount: Number(updated[0].refund_amount), ...(r.approve ? { itemIds } : {}) },
          },
        ]);
      });
    } catch (err) {
      if (isOneApprovalViolation(err)) throw new ResolveError('conflict', 'One or more selected items have already been refunded.');
      throw err;
    }
  }

  async stats() {
    const { rows } = await this.db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE decision = 'APPROVED')::int AS approved,
         COUNT(*) FILTER (WHERE decision = 'DENIED')::int AS denied,
         COUNT(*) FILTER (WHERE decision = 'ESCALATED')::int AS escalated,
         COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_review,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(security_flags) f WHERE f->>'source' <> 'output_guard'))::int AS security_flagged,
         COALESCE(SUM(refund_amount) FILTER (WHERE decision = 'APPROVED' OR status = 'resolved_approved'), 0)::float AS refunded_total,
         COUNT(*) FILTER (WHERE ai_mode = 'fallback')::int AS fallback_count
       FROM refund_requests`,
    );
    return rows[0];
  }

  /** One statement for all events; WITH ORDINALITY keeps their order, so ids (and the audit timeline) follow it. */
  private async insertEvents(client: PoolClient, requestId: string, events: AuditEventInput[]) {
    if (events.length === 0) return;
    await client.query(
      `INSERT INTO audit_events (request_id, event_type, actor, detail)
       SELECT $1, e.event_type, e.actor, e.detail::jsonb
         FROM unnest($2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS e(event_type, actor, detail, ord)
        ORDER BY e.ord`,
      [requestId, events.map((e) => e.eventType), events.map((e) => e.actor), events.map((e) => JSON.stringify(e.detail))],
    );
  }
}

export interface Resolution {
  approve: boolean;
  /** agents.id of the signed-in agent */
  agentId: string;
  note: string;
  /** Whole items to refund when approving; defaults to the request's candidate items. */
  itemIds?: string[];
}

export class ResolveError extends Error {
  constructor(
    readonly kind: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export class ConcurrentRefundError extends Error {
  constructor() {
    super('One or more items were refunded by a concurrent request.');
  }
}
