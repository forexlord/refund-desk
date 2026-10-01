import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CrmRepository } from '../crm/crm.repository';
import { POLICY_LIMITS } from '../policy/policy.engine';
import { ResolveRequestDto } from '../refunds/dto';
import { RefundsRepository, ResolveError } from '../refunds/refunds.repository';

@Injectable()
export class AdminService {
  constructor(
    private readonly refunds: RefundsRepository,
    private readonly crm: CrmRepository,
  ) {}

  async getDetail(id: string) {
    const request = await this.refunds.getById(id);
    if (!request) throw new NotFoundException('Request not found.');
    const order = await this.crm.getOrder(request.orderId);
    const recentRefunds = await this.crm.countRecentRefunds(request.customer.id, POLICY_LIMITS.riskLookbackDays);
    return { ...request, order, recentRefunds };
  }

  /**
   * An agent resolves an escalated request. Approving refunds the selected items (by default, the
   * policy-eligible ones). The agent may set a lower amount, but never more than those items' value.
   * Validation happens inside the repository transaction so it can't race another refund.
   */
  async resolve(id: string, dto: ResolveRequestDto, agentId: string) {
    try {
      await this.refunds.resolve(id, {
        approve: dto.action === 'approve',
        agentId,
        note: dto.note,
        itemIds: dto.itemIds,
      });
    } catch (err) {
      if (err instanceof ResolveError) {
        if (err.kind === 'not_found') throw new NotFoundException(err.message);
        if (err.kind === 'conflict') throw new ConflictException(err.message);
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    return this.getDetail(id);
  }
}
