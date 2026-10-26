import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function connectDatabase(config) {
  if (config.dbMode === 'pglite') {
    if (config.pglitePath !== ':memory:') await mkdir(dirname(resolve(config.pglitePath)), { recursive: true });
    const engine = new PGlite(config.pglitePath === ':memory:' ? undefined : config.pglitePath);
    await engine.waitReady;
    const wrap = connection => ({
      query: (sql, params = []) => connection.query(sql, params),
      exec: sql => connection.exec(sql),
    });
    return { ...wrap(engine), transaction: fn => engine.transaction(tx => fn(wrap(tx))), close: () => engine.close() };
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', err => console.error('Database pool error:', err.code || err.name));
  await pool.query('SELECT 1');
  return {
    query: (sql, params = []) => pool.query(sql, params), exec: sql => pool.query(sql), close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn({ query: (sql, params = []) => client.query(sql, params), exec: sql => client.query(sql) }); await client.query('COMMIT'); return result; }
      catch (err) { await client.query('ROLLBACK'); throw err; }
      finally { client.release(); }
    },
  };
}

export const camelRow = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value instanceof Date ? value.toISOString() : value]));
export const all = async (db, sql, params = []) => (await db.query(sql, params)).rows.map(camelRow);
export const one = async (db, sql, params = []) => (await all(db, sql, params))[0] || null;

export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(x => x.endsWith('.sql')).sort()) {
    await db.transaction(async tx => {
      await tx.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      if (await one(tx, 'SELECT name FROM schema_migrations WHERE name=$1', [name])) return;
      await tx.exec(await readFile(new URL(name, dir), 'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    });
  }
}
