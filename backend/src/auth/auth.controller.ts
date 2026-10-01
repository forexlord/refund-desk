import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { SessionClaims, SESSION_TTL_SECONDS, sessionCookie } from '../common/session';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccountsRepository } from './accounts.repository';
import { AuthService, SignedIn } from './auth.service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class VerifyOtpDto {
  @Matches(/^[a-f0-9]{32}$/)
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, { message: `password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters` })
  newPassword: string;
}

export class ResetRequestDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetConfirmDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, { message: `password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters` })
  newPassword: string;
}

/**
 * Email + password sign-in for customers and agents (agents add a one-time code). Every successful step
 * returns the session token in the body (for API clients: `Authorization: Bearer`) and sets it as an
 * httpOnly cookie (for the browser, so page scripts never hold it).
 * Rate limits are keyed per email / per challenge (see throttler.guard.ts).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * DEMO ONLY (DEMO_ACCOUNTS=true): the synthetic accounts and their current passwords for the sign-in pickers.
   * Picking an account only fills the form; sign-in still runs the normal password (and one-time code) checks.
   */
  @Get('demo-accounts')
  demoAccounts() {
    if (!this.config.demoAccounts) throw new NotFoundException();
    return this.accounts.demoAccounts();
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email.trim(), dto.password);
    return result.status === 'signed_in' ? this.respond(result, res) : result;
  }

  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(await this.auth.verifyOtp(dto.challengeId, dto.code), res);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', sessionCookie('', 0, this.config.secureCookie));
  }

  @Get('me')
  async me(@Req() req: { session?: SessionClaims | null }) {
    const user = req.session ? await this.describe(req.session) : null;
    if (!user) throw new UnauthorizedException('Not signed in.');
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@Req() req: { session?: SessionClaims | null }, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    if (!req.session || !(await this.describe(req.session))) throw new UnauthorizedException('Not signed in.');
    return this.respond(await this.auth.changePassword(req.session, dto.currentPassword, dto.newPassword), res);
  }

  @Post('password-reset/request')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async requestReset(@Body() dto: ResetRequestDto) {
    await this.auth.requestReset(dto.email.trim());
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirmReset(@Body() dto: ResetConfirmDto) {
    await this.auth.confirmReset(dto.token, dto.newPassword);
  }

  private async respond(s: SignedIn, res: Response) {
    const user = await this.describe(s.claims);
    if (!user) throw new UnauthorizedException('Account not found.');
    res.setHeader('Set-Cookie', sessionCookie(s.token, SESSION_TTL_SECONDS, this.config.secureCookie));
    return { status: s.status, token: s.token, tokenType: s.tokenType, expiresAt: s.expiresAt, user };
  }

  /** The signed-in user, or null if the account is gone or the session predates a password change. */
  private async describe(claims: SessionClaims) {
    if (claims.role === 'customer') {
      const p = await this.accounts.customerPrincipal(claims.sub);
      if (!p || p.passwordChangedAt.getTime() !== claims.pv) return null;
      return { role: 'customer' as const, id: p.customer.id, name: p.customer.name, email: p.customer.email, tier: p.customer.tier };
    }
    const p = await this.accounts.agentPrincipal(claims.sub);
    if (!p || p.passwordChangedAt.getTime() !== claims.pv) return null;
    return { role: 'agent' as const, id: p.agent.id, name: p.agent.name, email: p.agent.email };
  }
}
