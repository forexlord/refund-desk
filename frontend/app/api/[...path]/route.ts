import { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NestJS API.
 * The browser only talks to the frontend, so there's no CORS setup and the backend URL is a runtime
 * setting (BACKEND_URL) instead of being baked in at build time. Only known headers are forwarded.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const FORWARDED_HEADERS = ['content-type', 'cookie', 'authorization'];
// Longer than the slowest legitimate call: a refund submission can wait on two AI calls (AI_TIMEOUT_MS each).
const UPSTREAM_TIMEOUT_MS = 60_000;
const UNAVAILABLE = 'Refund Desk is temporarily unavailable. Please try again shortly.';

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${BACKEND_URL}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARDED_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const out = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
    // Relay the session cookie set by /auth/login and /auth/logout.
    for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
    return new Response(res.status === 204 ? null : await res.text(), { status: res.status, headers: out });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    console.error(`Proxy ${req.method} /api/${path.join('/')} failed: ${timedOut ? 'upstream timeout' : String(err)}`);
    return Response.json({ message: UNAVAILABLE }, { status: timedOut ? 504 : 502 });
  }
}

export { proxy as GET, proxy as POST };
