import { Injectable } from '@nestjs/common';
import { Order, OrderItem } from '../common/domain';
import { Database } from '../database/database.module';

/** Read access to the mock CRM. The refund workflow never trusts client-supplied order data; it always re-reads from here. */
@Injectable()
export class CrmRepository {
  constructor(private readonly db: Database) {}

  async getOrdersForCustomer(customerId: string): Promise<Order[]> {
    const { rows } = await this.db.query(`SELECT * FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC`, [customerId]);
    return this.attachItems(rows.map(mapOrder));
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const { rows } = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    if (!rows[0]) return null;
    const [order] = await this.attachItems([mapOrder(rows[0])]);
    return order;
  }

  /** Refunds in the lookback window, counting both legacy refunds and refunds approved by this system. */
  async countRecentRefunds(customerId: string, days: number): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT
         (SELECT COUNT(*) FROM past_refunds WHERE customer_id = $1 AND refunded_at > NOW() - make_interval(days => $2))
       + (SELECT COUNT(*) FROM refund_requests WHERE customer_id = $1
            AND ((decision = 'APPROVED' AND created_at > NOW() - make_interval(days => $2))
              OR (status = 'resolved_approved' AND resolved_at > NOW() - make_interval(days => $2)))) AS n`,
      [customerId, days],
    );
    return Number(rows[0].n);
  }

  private async attachItems(orders: Order[]): Promise<Order[]> {
    if (orders.length === 0) return orders;
    // Refunded = imported CRM history or an approved Refund Desk refund (one indexed EXISTS per item, same query).
    const { rows } = await this.db.query(
      `SELECT oi.*,
              (oi.legacy_refunded OR EXISTS (
                 SELECT 1 FROM refund_request_items ri WHERE ri.order_item_id = oi.id AND ri.approved)) AS refunded
         FROM order_items oi WHERE oi.order_id = ANY($1) ORDER BY oi.id`,
      [orders.map((o) => o.id)],
    );
    const byOrder = new Map<string, OrderItem[]>();
    for (const r of rows) {
      const list = byOrder.get(r.order_id) ?? [];
      list.push(mapItem(r));
      byOrder.set(r.order_id, list);
    }
    return orders.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
  }
}

function mapOrder(r: any): Order {
  return {
    id: r.id,
    customerId: r.customer_id,
    placedAt: new Date(r.placed_at),
    status: r.status,
    expectedDelivery: r.expected_delivery ? new Date(r.expected_delivery) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    signatureOnDelivery: r.signature_on_delivery,
    total: Number(r.total),
    items: [],
  };
}

function mapItem(r: any): OrderItem {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unitPrice: Number(r.unit_price),
    quantity: r.quantity,
    finalSale: r.final_sale,
    refunded: r.refunded,
  };
}
