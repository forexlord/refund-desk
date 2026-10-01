import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/**
 * Stateless signed session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Sent as an httpOnly cookie by the browser, or as `Authorization: Bearer <token>` by API clients.
 * The payload carries `pv` (the account's password_changed_at in ms); guards reject tokens whose `pv` no
 * longer matches the account, so changing or resetting a password revokes every earlier session.
 */

export const SESSION_COOKIE = 'rd_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionClaims {
  role: 'customer' | 'agent';
  /** customers.id or agents.id */
  sub: string;
  /** password version: password_changed_at in epoch ms when the token was issued */
  pv: number;
}

function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signSession(claims: SessionClaims, secret: string, nowMs = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url');
  return { token: `${body}.${mac(secret, body).toString('base64url')}`, expiresAt: new Date(exp * 1000) };
}

/** Returns the claims, or null if the token is malformed, tampered with, or expired. */
export function verifySession(token: string, secret: string, nowMs = Date.now()): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(secret, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp * 1000 <= nowMs) return null;
    if ((p.role !== 'customer' && p.role !== 'agent') || typeof p.sub !== 'string' || typeof p.pv !== 'number') return null;
    return { role: p.role, sub: p.sub, pv: p.pv };
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

/**
 * Runs before guards: attaches the signature-verified claims (or null) as req.session.
 * Guards then check the claims against the database (account exists, password version current).
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: { headers: Record<string, string | undefined>; session?: SessionClaims | null }, _res: unknown, next: () => void) {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : readCookie(req.headers.cookie, SESSION_COOKIE);
    req.session = token ? verifySession(token, this.config.sessionSecret) : null;
    next();
  }
}
