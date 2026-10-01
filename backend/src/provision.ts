import { Pool } from 'pg';
import { generatePassword, hashPassword } from './auth/password';

/**
 * Local provisioning for the synthetic demo accounts (run by the one-off `provision` compose service).
 *
 *   node dist/provision.js                 issue a unique password to every account that has none, print them once
 *   node dist/provision.js --reset <email> issue a new password for one account (revokes its sessions)
 *
 * Existing credentials are never changed by a normal run, so re-running `docker compose up` is safe.
 * Passwords are printed once and stored only as scrypt hashes.
 */

interface Issued {
  kind: 'customer' | 'agent';
  email: string;
  name: string;
  password: string;
}

async function provisionMissing(pool: Pool): Promise<Issued[]> {
  const { rows } = await pool.query(
    `SELECT 'agent' AS kind, g.id, g.email, g.name FROM agents g
       LEFT JOIN agent_accounts a ON a.agent_id = g.id WHERE a.agent_id IS NULL
     UNION ALL
     SELECT 'customer', c.id, c.email, c.name FROM customers c
       LEFT JOIN customer_accounts a ON a.customer_id = c.id WHERE a.customer_id IS NULL
     ORDER BY 1, 2`,
  );
  const issued: Issued[] = [];
  // Sequential on purpose: each scrypt hash uses 128 MiB.
  for (const r of rows) {
    const password = generatePassword();
    const hash = await hashPassword(password);
    const table = r.kind === 'agent' ? 'agent' : 'customer';
    // One statement: the account and its demo-picker copy are created together or not at all. ON CONFLICT: if a
    // concurrent run already provisioned this account, keep its password and don't print ours.
    const res = await pool.query(
      `WITH acct AS (
         INSERT INTO ${table}_accounts (${table}_id, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING ${table}_id
       )
       INSERT INTO demo_credentials (${table}_id, password) SELECT ${table}_id, $3 FROM acct`,
      [r.id, hash, password],
    );
    if (res.rowCount === 1) issued.push({ kind: r.kind, email: r.email, name: r.name, password });
  }
  return issued;
}

async function resetOne(pool: Pool, email: string): Promise<Issued[]> {
  const password = generatePassword();
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    `WITH c AS (
       UPDATE customer_accounts a SET password_hash = $2, password_changed_at = clock_timestamp()
         FROM customers c WHERE c.id = a.customer_id AND LOWER(c.email) = LOWER($1)
       RETURNING 'customer' AS kind, c.email, c.name
     ), g AS (
       UPDATE agent_accounts a SET password_hash = $2, password_changed_at = clock_timestamp()
         FROM agents g WHERE g.id = a.agent_id AND LOWER(g.email) = LOWER($1)
       RETURNING 'agent' AS kind, g.email, g.name
     )
     SELECT * FROM c UNION ALL SELECT * FROM g`,
    [email, hash],
  );
  // The reissued password is known again, so the account (re)appears in the demo pickers.
  await pool.query(
    `INSERT INTO demo_credentials (customer_id, password)
       SELECT id, $2 FROM customers WHERE LOWER(email) = LOWER($1)
     ON CONFLICT (customer_id) DO UPDATE SET password = EXCLUDED.password`,
    [email, password],
  );
  await pool.query(
    `INSERT INTO demo_credentials (agent_id, password)
       SELECT id, $2 FROM agents WHERE LOWER(email) = LOWER($1)
     ON CONFLICT (agent_id) DO UPDATE SET password = EXCLUDED.password`,
    [email, password],
  );
  if (rows.length === 0) throw new Error(`No provisioned account with email ${email}. Run provisioning without --reset first.`);
  return rows.map((r) => ({ kind: r.kind, email: r.email, name: r.name, password }));
}

function print(issued: Issued[]) {
  if (issued.length === 0) {
    console.log('All demo accounts already have credentials (passwords were printed on first run).');
    console.log('Reissue one with: docker compose run --rm provision node dist/provision.js --reset <email>');
    return;
  }
  const w = Math.max(...issued.map((i) => i.email.length));
  console.log('Refund Desk demo credentials: shown once, stored only as scrypt hashes.\n');
  console.log(`${'ROLE'.padEnd(9)}${'EMAIL'.padEnd(w + 2)}${'PASSWORD'.padEnd(21)}NAME`);
  for (const i of issued) console.log(`${i.kind.padEnd(9)}${i.email.padEnd(w + 2)}${i.password.padEnd(21)}${i.name}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const i = process.argv.indexOf('--reset');
    if (i !== -1 && !process.argv[i + 1]) throw new Error('--reset needs an email');
    print(i === -1 ? await provisionMissing(pool) : await resetOne(pool, process.argv[i + 1]));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
