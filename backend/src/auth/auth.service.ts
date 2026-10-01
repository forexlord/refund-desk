import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { SessionClaims, signSession } from '../common/session';
import { AccountKind, AccountsRepository } from './accounts.repository';
import { Mailer } from './mailer';
import { OtpStore } from './otp.store';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

const BAD_CREDENTIALS = 'Email or password is incorrect.';
const RESET_TTL_MS = 30 * 60_000;

export type SignedIn = { status: 'signed_in'; token: string; tokenType: 'Bearer'; expiresAt: Date; claims: SessionClaims };
export type OtpRequired = { status: 'otp_required'; challengeId: string; expiresAt: Date; demoOtp?: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accounts: AccountsRepository,
    private readonly otp: OtpStore,
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Customers get a session straight away; agents must also pass a one-time code. */
  async login(email: string, password: string): Promise<SignedIn | OtpRequired> {
    const creds = await this.accounts.credentialsByEmail(email);
    // Always run one scrypt verification so unknown emails take as long as wrong passwords.
    const ok = await verifyPassword(password, creds?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!creds || !ok) throw new UnauthorizedException(BAD_CREDENTIALS);

    if (creds.kind === 'customer') return this.issue({ role: 'customer', sub: creds.id, pv: creds.passwordChangedAt.getTime() });

    const challenge = this.otp.issue(creds.id);
    await this.mailer.send(email, 'Your Refund Desk sign-in code', `Code: ${challenge.code} (expires in 5 minutes)`);
    return {
      status: 'otp_required',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      // Demo only (EXPOSE_OTP): no email provider is configured, so the code is returned for the sign-in page to show.
      ...(this.config.exposeOtp ? { demoOtp: challenge.code } : {}),
    };
  }

  async verifyOtp(challengeId: string, code: string): Promise<SignedIn> {
    const agentId = this.otp.verify(challengeId, code);
    const creds = agentId ? await this.accounts.credentialsById('agent', agentId) : null;
    if (!creds) throw new UnauthorizedException('The code is wrong or has expired. Sign in again to get a new one.');
    return this.issue({ role: 'agent', sub: creds.id, pv: creds.passwordChangedAt.getTime() });
  }

  /** Changes the password, which revokes every other session; returns a fresh session for the caller. */
  async changePassword(claims: SessionClaims, currentPassword: string, newPassword: string): Promise<SignedIn> {
    const creds = await this.accounts.credentialsById(claims.role, claims.sub);
    if (!creds || !(await verifyPassword(currentPassword, creds.passwordHash))) throw new UnauthorizedException('Current password is incorrect.');
    const pv = await this.accounts.setPassword(claims.role, claims.sub, creds.passwordHash, await hashPassword(newPassword));
    if (!pv) throw new UnauthorizedException('Your password was changed elsewhere. Sign in again.');
    return this.issue({ role: claims.role, sub: claims.sub, pv: pv.getTime() });
  }

  /** Always resolves the same way, whether or not the email has an account (no account enumeration). */
  async requestReset(email: string): Promise<void> {
    const creds = await this.accounts.credentialsByEmail(email);
    if (!creds) return;
    const token = randomBytes(32).toString('base64url');
    await this.accounts.createReset(creds.kind as AccountKind, creds.id, sha256(token), new Date(Date.now() + RESET_TTL_MS));
    const link = `${this.config.appUrl}/reset-password?token=${token}`;
    try {
      await this.mailer.send(email, 'Reset your Refund Desk password', `Use this link within 30 minutes: ${link}`);
    } catch (err) {
      // Swallowed on purpose: an error here would only happen for real accounts and reveal which emails exist.
      this.logger.error(`Reset email to account ${creds.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async confirmReset(token: string, newPassword: string): Promise<void> {
    const ok = await this.accounts.consumeResetAndSetPassword(sha256(token), await hashPassword(newPassword));
    if (!ok) throw new UnauthorizedException('This reset link is invalid, expired, or already used.');
  }

  private issue(claims: SessionClaims): SignedIn {
    const { token, expiresAt } = signSession(claims, this.config.sessionSecret);
    return { status: 'signed_in', token, tokenType: 'Bearer', expiresAt, claims };
  }
}
