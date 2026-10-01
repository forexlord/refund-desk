import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Agent } from '../auth/accounts.repository';
import { AgentAuthGuard, CurrentAgent } from '../common/agent-auth.guard';
import { decodeCursor } from '../common/cursor';
import { ListRequestsQuery, ResolveRequestDto } from '../refunds/dto';
import { RefundsRepository } from '../refunds/refunds.repository';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AgentAuthGuard)
export class AdminController {
  constructor(
    private readonly refunds: RefundsRepository,
    private readonly admin: AdminService,
  ) {}

  @Get('stats')
  stats() {
    return this.refunds.stats();
  }

  @Get('refund-requests')
  list(@Query() q: ListRequestsQuery) {
    return this.refunds.list({ decision: q.decision, status: q.status, limit: q.limit ?? 50, cursor: q.cursor ? decodeCursor(q.cursor) : undefined });
  }

  @Get('refund-requests/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getDetail(id);
  }

  @Post('refund-requests/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveRequestDto, @CurrentAgent() agent: Agent) {
    return this.admin.resolve(id, dto, agent.id);
  }
}
