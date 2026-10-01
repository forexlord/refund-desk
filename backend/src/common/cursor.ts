import { BadRequestException } from '@nestjs/common';

/**
 * Keyset-pagination cursor over (created_at, id). created_at travels as Postgres' own text form, which keeps
 * microseconds, so a page boundary never skips or repeats rows created in the same millisecond.
 * Opaque to clients: base64url("<created_at text>|<uuid>").
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const [createdAt, id, extra] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id || extra !== undefined || !UUID.test(id) || Number.isNaN(Date.parse(createdAt))) {
    throw new BadRequestException('Invalid cursor.');
  }
  return { createdAt, id };
}
