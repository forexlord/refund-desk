import { Injectable } from '@nestjs/common';
import { Customer } from '../common/domain';
import { Database } from '../database/database.module';

export type AccountKind = 'customer' | 'agent';

export interface Credentials {
  kind: AccountKind;
  id: string;
  passwordHash: string;
  passwordChangedAt: Date;
}

export interface DemoAccount {
  name: string;
  email: string;
  /** customer tier, or "Support agent" */
  detail: string;
  password: string;
}

export interface Agent {
  id: string;
  email: string;
  name: string;
}

/** Credential and principal lookups. Password hashes never leave this class except for verification. */
@Injectable()
export class AccountsRepository {
  constructor(private readonly db: Database) {}

  /** One query across both account types; emails are matched case-insensitively via the LOWER(email) indexes. */
  async credentialsByEmail(email: string): Promise<Credentials | null> {
    const { rows } = await this.db.query(
      `SELECT 'customer' AS kind, c.id, a.password_hash, a.password_changed_at
         FROM customers c JOIN customer_accounts a ON a.customer_id = c.id
        WHERE LOWER(c.email) = LOWER($1)
       UNION ALL
       SELECT 'agent', g.id, a.password_hash, a.password_changed_at
         FROM agents g JOIN agent_accounts a ON a.agent_id = g.id
        WHERE LOWER(g.email) = LOWER($1)
       LIMIT 1`,
      [email],
    );
    const r = rows[0];
    return r ? { kind: r.kind, id: r.id, passwordHash: r.password_hash, passwordChangedAt: r.password_changed_at } : null;
  }

  async credentialsById(kind: AccountKind, id: string): Promise<Credentials | null> {
    const { rows } =
      kind === 'customer'
        ? await this.db.query(`SELECT password_hash, password_changed_at FROM customer_accounts WHERE customer_id = $1`, [id])
        : await this.db.query(`SELECT password_hash, password_changed_at FROM agent_accounts WHERE agent_id = $1`, [id]);
    const r = rows[0];
    return r ? { kind, id, passwordHash: r.password_hash, passwordChangedAt: r.password_changed_at } : null;
  }

  /** The signed-in customer plus their current password version, in one query (used by the guard on every request). */
  async customerPrincipal(id: string): Promise<{ customer: Customer; passwordChangedAt: Date } | null> {
    const { rows } = await this.db.query(
      `SELECT c.id, c.name, c.email, c.tier, c.risk_flag, c.notes, a.password_changed_at
         FROM customers c JOIN customer_accounts a ON a.customer_id = c.id WHERE c.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      customer: { id: r.id, name: r.name, email: r.email, tier: r.tier, riskFlag: r.risk_flag, notes: r.notes },
      passwordChangedAt: r.password_changed_at,
    };
  }

  async agentPrincipal(id: string): Promise<{ agent: Agent; passwordChangedAt: Date } | null> {
    const { rows } = await this.db.query(
      `SELECT g.id, g.email, g.name, a.password_changed_at FROM agents g JOIN agent_accounts a ON a.agent_id = g.id WHERE g.id = $1`,
      [id],
    );
    const r = rows[0];
    return r ? { agent: { id: r.id, email: r.email, name: r.name }, passwordChangedAt: r.password_changed_at } : null;
  }

  /**
   * Sets a new password and bumps password_changed_at, which revokes all earlier sessions. Returns the new
   * version, or null if the stored hash is no longer `expectedHash` (e.g. a reset landed after the caller
   * verified the old password), so a stale password can't overwrite a newer one.
   */
  async setPassword(kind: AccountKind, id: string, expectedHash: string, passwordHash: string): Promise<Date | null> {
    const table = kind === 'customer' ? 'customer_accounts' : 'agent_accounts';
    const key = kind === 'customer' ? 'customer_id' : 'agent_id';
    // The demo picker's copy is removed in the same statement: it no longer matches the account.
    const { rows } = await this.db.query(
      `WITH upd AS (
         UPDATE ${table} SET password_hash = $3, password_changed_at = clock_timestamp()
          WHERE ${key} = $1 AND password_hash = $2 RETURNING ${key}, password_changed_at
       ), _demo AS (
         DELETE FROM demo_credentials WHERE ${key} IN (SELECT ${key} FROM upd)
       )
       SELECT password_changed_at FROM upd`,
      [id, expectedHash, passwordHash],
    );
    return rows[0]?.password_changed_at ?? null;
  }

  /** Demo pickers: the synthetic accounts whose provisioned password is still current. One query. */
  async demoAccounts(): Promise<{ customers: DemoAccount[]; agents: DemoAccount[] }> {
    const { rows } = await this.db.query(
      `SELECT 'customer' AS kind, c.name, c.email, c.tier AS detail, d.password
         FROM demo_credentials d JOIN customers c ON c.id = d.customer_id
       UNION ALL
       SELECT 'agent', g.name, g.email, 'Support agent', d.password
         FROM demo_credentials d JOIN agents g ON g.id = d.agent_id
       ORDER BY 1, 2`,
    );
    const pick = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ name: r.name, email: r.email, detail: r.detail, password: r.password }));
    return { customers: pick('customer'), agents: pick('agent') };
  }

  async createReset(kind: AccountKind, id: string, tokenHash: Buffer, expiresAt: Date): Promise<void> {
    // Housekeeping: rows expired over a day ago are no longer useful for auditing a recent reset.
    await this.db.query(`DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL '1 day'`);
    await this.db.query(`INSERT INTO password_resets (token_hash, customer_id, agent_id, expires_at) VALUES ($1, $2, $3, $4)`, [
      tokenHash,
      kind === 'customer' ? id : null,
      kind === 'agent' ? id : null,
      expiresAt,
    ]);
  }

  /**
   * Consumes a reset token and sets the new password in one transaction. The conditional UPDATE marks the
   * token used atomically, so two concurrent submissions of the same token can't both succeed.
   */
  async consumeResetAndSetPassword(tokenHash: Buffer, passwordHash: string): Promise<boolean> {
    return this.db.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE password_resets SET used_at = NOW()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
          RETURNING customer_id, agent_id`,
        [tokenHash],
      );
      const r = rows[0];
      if (!r) return false;
      // Any other outstanding links for this account die with this reset, and the demo picker's copy goes stale.
      await client.query(
        `UPDATE password_resets SET used_at = NOW() WHERE used_at IS NULL AND (customer_id = $1 OR agent_id = $2)`,
        [r.customer_id, r.agent_id],
      );
      await client.query(`DELETE FROM demo_credentials WHERE customer_id = $1 OR agent_id = $2`, [r.customer_id, r.agent_id]);
      if (r.customer_id) {
        await client.query(`UPDATE customer_accounts SET password_hash = $2, password_changed_at = clock_timestamp() WHERE customer_id = $1`, [
          r.customer_id,
          passwordHash,
        ]);
      } else {
        await client.query(`UPDATE agent_accounts SET password_hash = $2, password_changed_at = clock_timestamp() WHERE agent_id = $1`, [
          r.agent_id,
          passwordHash,
        ]);
      }
      return true;
    });
  }
}
