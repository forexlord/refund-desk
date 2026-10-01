import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, OtpStore } from './otp.store';

const NOW = 1_000_000;

describe('OtpStore', () => {
  it('accepts the right code once', () => {
    const store = new OtpStore();
    const { challengeId, code } = store.issue('A001', NOW);
    expect(code).toMatch(/^\d{6}$/);
    expect(store.verify(challengeId, code, NOW)).toBe('A001');
    expect(store.verify(challengeId, code, NOW)).toBeNull();
  });

  it('rejects an expired code', () => {
    const store = new OtpStore();
    const { challengeId, code } = store.issue('A001', NOW);
    expect(store.verify(challengeId, code, NOW + OTP_TTL_MS)).toBeNull();
  });

  it('discards the challenge after too many wrong codes', () => {
    const store = new OtpStore();
    const { challengeId, code } = store.issue('A001', NOW);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(store.verify(challengeId, wrong, NOW)).toBeNull();
    expect(store.verify(challengeId, code, NOW)).toBeNull();
  });

  it('rejects unknown challenges', () => {
    expect(new OtpStore().verify('0'.repeat(32), '123456', NOW)).toBeNull();
  });
});
