import { DUMMY_PASSWORD_HASH, generatePassword, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it.each(['', 'bcrypt$x', 'scrypt$0$8$1$AA==$AA==', 'scrypt$131072$8$1$$', 'scrypt$abc$8$1$AA==$AA=='])('returns false for malformed hash %p', async (stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });

  it('never matches the dummy hash used for unknown emails', async () => {
    expect(await verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it('generates distinct readable passwords', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(generatePassword()).not.toBe(a);
  });
});
