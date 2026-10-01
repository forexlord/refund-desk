import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountsRepository } from '../auth/accounts.repository';
import { Customer } from './domain';
import { SessionClaims } from './session';

/**
 * Requires a customer session whose password version is still current. The customer is re-read on every
 * request (one query), so a deleted account or a password change takes effect immediately.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly accounts: AccountsRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const claims: SessionClaims | null = req.session ?? null;
    if (!claims) throw new UnauthorizedException('Not signed in.');
    if (claims.role !== 'customer') throw new ForbiddenException('Customer sign-in required.');
    const p = await this.accounts.customerPrincipal(claims.sub);
    if (!p || p.passwordChangedAt.getTime() !== claims.pv) throw new UnauthorizedException('Session expired. Please sign in again.');
    req.customer = p.customer;
    return true;
  }
}

export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): Customer => {
  return ctx.switchToHttp().getRequest().customer;
});
