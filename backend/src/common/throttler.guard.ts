import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SessionClaims } from './session';

/**
 * Rate-limit keys:
 *  - sign-in endpoints: per target email / OTP challenge, because all browser traffic reaches the API from the
 *    proxy's single IP, and credential guessing is aimed at an account;
 *  - otherwise the signed-in user (signature-verified token), then the socket IP.
 * X-Forwarded-For is deliberately ignored: Next.js keeps a client-supplied value and the API port is
 * also reachable directly, so it is attacker-controlled.
 */
@Injectable()
export class PerClientThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path: string = req.path ?? req.url ?? '';
    if (path.startsWith('/api/auth/')) {
      if (typeof req.body?.email === 'string') return `email:${req.body.email.trim().toLowerCase()}`;
      if (typeof req.body?.challengeId === 'string') return `otp:${req.body.challengeId}`;
    }
    const claims: SessionClaims | null = req.session ?? null;
    if (claims) return `${claims.role}:${claims.sub}`;
    return `ip:${req.ip}`;
  }
}
