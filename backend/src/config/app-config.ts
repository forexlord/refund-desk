// Centralised, validated configuration. Read once at startup; everything else depends on this object.
import { randomBytes } from 'crypto';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  aiTimeoutMs: number;
  /** HMAC key for session tokens. */
  sessionSecret: string;
  secureCookie: boolean;
  /** Demo only: return the agent's one-time code in the login response (no email provider is configured). */
  exposeOtp: boolean;
  /** DEMO ONLY: serve the synthetic accounts' passwords to the sign-in pickers. */
  demoAccounts: boolean;
  /** Public URL of the web app, used in emailed links. */
  appUrl: string;
  corsOrigin: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl,
    // An empty or placeholder key means "run in fallback mode" rather than crash.
    anthropicApiKey: apiKey && !apiKey.startsWith('your-') ? apiKey : null,
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS ?? 20000),
    // Unset: a random per-process key, so sessions simply reset when the backend restarts.
    sessionSecret: env.SESSION_SECRET?.trim() || randomBytes(32).toString('hex'),
    secureCookie: env.COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : env.COOKIE_SECURE.toLowerCase() === 'true',
    exposeOtp: (env.EXPOSE_OTP ?? 'true').toLowerCase() === 'true',
    demoAccounts: (env.DEMO_ACCOUNTS ?? 'false').toLowerCase() === 'true',
    appUrl: (env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3000',
  };
}
