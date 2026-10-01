import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
const MAX_OPEN_CHALLENGES = 1000;

interface Challenge {
  agentId: string;
  codeHash: Buffer;
  expiresAt: number;
  attempts: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/**
 * One-time codes for the agent's second sign-in step. In memory because this backend runs as a single
 * instance and codes live 5 minutes; a multi-instance deployment would move this to Redis or the database.
 * All operations are synchronous, so a check-and-delete can't interleave with another request.
 */
@Injectable()
export class OtpStore {
  private readonly challenges = new Map<string, Challenge>();

  issue(agentId: string, now = Date.now()): { challengeId: string; code: string; expiresAt: Date } {
    this.sweep(now);
    const challengeId = randomBytes(16).toString('hex');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.challenges.set(challengeId, { agentId, codeHash: sha256(code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
    return { challengeId, code, expiresAt: new Date(now + OTP_TTL_MS) };
  }

  /** Returns the agent ID on success. Codes are single-use; a challenge is discarded after OTP_MAX_ATTEMPTS wrong codes. */
  verify(challengeId: string, code: string, now = Date.now()): string | null {
    const c = this.challenges.get(challengeId);
    if (!c) return null;
    if (c.expiresAt <= now) {
      this.challenges.delete(challengeId);
      return null;
    }
    if (timingSafeEqual(sha256(code), c.codeHash)) {
      this.challenges.delete(challengeId);
      return c.agentId;
    }
    c.attempts += 1;
    if (c.attempts >= OTP_MAX_ATTEMPTS) this.challenges.delete(challengeId);
    return null;
  }

  private sweep(now: number) {
    for (const [id, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(id);
    // Bound memory even under a flood of sign-ins: drop the oldest open challenges (Map keeps insertion order).
    for (const id of this.challenges.keys()) {
      if (this.challenges.size < MAX_OPEN_CHALLENGES) break;
      this.challenges.delete(id);
    }
  }
}
