import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Agent, AccountsRepository } from '../auth/accounts.repository';
import { SessionClaims } from './session';

/** Requires an agent session (password + one-time code) whose password version is still current. */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly accounts: AccountsRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const claims: SessionClaims | null = req.session ?? null;
    if (!claims) throw new UnauthorizedException('Not signed in.');
    if (claims.role !== 'agent') throw new ForbiddenException('Agent sign-in required.');
    const p = await this.accounts.agentPrincipal(claims.sub);
    if (!p || p.passwordChangedAt.getTime() !== claims.pv) throw new UnauthorizedException('Session expired. Please sign in again.');
    req.agent = p.agent;
    return true;
  }
}

/** The signed-in agent; resolutions and audit events record agent.id. */
export const CurrentAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): Agent => {
  return ctx.switchToHttp().getRequest().agent;
});
