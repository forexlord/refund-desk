import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { decodeCursor } from '../common/cursor';
import { Customer } from '../common/domain';
import { CustomerHistoryQuery } from '../refunds/dto';
import { CurrentCustomer, CustomerAuthGuard } from '../common/customer-auth.guard';
import { RefundsRepository } from '../refunds/refunds.repository';
import { CrmRepository } from './crm.repository';

@Controller()
export class CrmController {
  constructor(
    private readonly crm: CrmRepository,
    private readonly refunds: RefundsRepository,
  ) {}

  @Get('me/orders')
  @UseGuards(CustomerAuthGuard)
  async myOrders(@CurrentCustomer() customer: Customer) {
    const orders = await this.crm.getOrdersForCustomer(customer.id);
    return orders.map((o) => ({
      id: o.id,
      status: o.status,
      placedAt: o.placedAt,
      expectedDelivery: o.expectedDelivery,
      deliveredAt: o.deliveredAt,
      total: o.total,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        finalSale: i.finalSale,
        refunded: i.refunded,
      })),
    }));
  }

  @Get('me/refund-requests')
  @UseGuards(CustomerAuthGuard)
  myRequests(@CurrentCustomer() customer: Customer, @Query() q: CustomerHistoryQuery) {
    return this.refunds.listForCustomer(customer.id, {
      orderId: q.orderId,
      before: q.before ? decodeCursor(q.before) : undefined,
      limit: q.limit ?? 20,
    });
  }
}
