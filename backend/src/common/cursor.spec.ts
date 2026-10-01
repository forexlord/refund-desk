import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor';

const ID = '3f2b1c9e-8d7a-4e6f-9b0c-1a2b3c4d5e6f';

describe('keyset cursor', () => {
  it('round-trips Postgres timestamps with microseconds', () => {
    const createdAt = '2026-09-30 17:42:05.123456+00';
    expect(decodeCursor(encodeCursor(createdAt, ID))).toEqual({ createdAt, id: ID });
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    ['bad id', Buffer.from('2026-09-30 17:42:05+00|not-a-uuid').toString('base64url')],
    ['bad date', Buffer.from(`yesterday|${ID}`).toString('base64url')],
    ['extra field', Buffer.from(`2026-09-30 17:42:05+00|${ID}|x`).toString('base64url')],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});
