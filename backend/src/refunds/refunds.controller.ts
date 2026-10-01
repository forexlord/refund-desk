import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Customer } from '../common/domain';
import { CurrentCustomer, CustomerAuthGuard } from '../common/customer-auth.guard';
import { CreateRefundRequestDto } from './dto';
import { RefundsService } from './refunds.service';

@Controller('refund-requests')
@UseGuards(CustomerAuthGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** Customer submits a refund request in natural language for one of their orders. */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@CurrentCustomer() customer: Customer, @Body() dto: CreateRefundRequestDto) {
    return this.refunds.submit(customer, dto.orderId, dto.message);
  }
}
