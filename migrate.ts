import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, Pool } from './db';

const LOCK_KEY = 727_274;   // arbitrary app-wide constant

/** Safe to call from several processes at once (API + worker starting together): they queue on an advisory lock. */
export async function migrate(pool: Pool) {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await applyPending(pool);
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    lock.release();
  }
}

async function applyPending(pool: Pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]);
      await c.query('COMMIT');
      console.log('applied', f);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  const pool = createPool();
  migrate(pool).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
