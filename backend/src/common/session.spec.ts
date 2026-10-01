import { readCookie, SESSION_TTL_SECONDS, sessionCookie, signSession, verifySession } from './session';

const SECRET = 'test-secret';
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const CUSTOMER = { role: 'customer' as const, sub: 'C001', pv: 1000 };

describe('session tokens', () => {
  it('round-trips claims and reports the expiry', () => {
    const { token, expiresAt } = signSession(CUSTOMER, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW)).toEqual(CUSTOMER);
    expect(expiresAt.getTime()).toBe(NOW + SESSION_TTL_SECONDS * 1000);
  });

  it('rejects a payload edited to another subject or role', () => {
    const [, sig] = signSession(CUSTOMER, SECRET, NOW).token.split('.');
    for (const claims of [{ ...CUSTOMER, sub: 'C002' }, { ...CUSTOMER, role: 'agent', sub: 'A001' }]) {
      const forged = Buffer.from(JSON.stringify({ ...claims, exp: NOW / 1000 + 60 })).toString('base64url');
      expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    }
  });

  it('rejects a token signed with another secret', () => {
    expect(verifySession(signSession(CUSTOMER, 'other', NOW).token, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = signSession(CUSTOMER, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'not-base64.!!!'])('rejects malformed token %p', (token) => {
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });
});

describe('cookies', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('a=1; rd_session=tok.sig; b=2', 'rd_session')).toBe('tok.sig');
    expect(readCookie('rd_sessionx=1', 'rd_session')).toBeNull();
    expect(readCookie(undefined, 'rd_session')).toBeNull();
  });

  it('adds Secure only when asked', () => {
    expect(sessionCookie('t', 60, false)).not.toContain('Secure');
    expect(sessionCookie('t', 60, true)).toContain('; Secure');
    expect(sessionCookie('t', 60, false)).toContain('HttpOnly; SameSite=Lax');
  });
});
