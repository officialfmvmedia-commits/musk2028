// Storage adapter. Postgres when DATABASE_URL is set (production), SQLite otherwise (local).
// Exposes async get/all/run with '?' placeholders; translated to $1..$n for Postgres.
'use strict';
const path = require('path');
const fs = require('fs');

const SCHEMA = (pg) => `
  CREATE TABLE IF NOT EXISTS signatures (
    id ${pg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
    full_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_initial TEXT NOT NULL DEFAULT '',
    zip TEXT,
    state TEXT,
    email TEXT,
    opt_in INTEGER NOT NULL DEFAULT 0,
    consent INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_token TEXT,
    x_id TEXT,
    x_handle TEXT,
    x_verified INTEGER NOT NULL DEFAULT 0,
    manage_token TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sig_email_unique ON signatures(email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS sig_x_unique ON signatures(x_id) WHERE x_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS sig_ip_time ON signatures(ip_hash, created_at);
  CREATE INDEX IF NOT EXISTS sig_email_token ON signatures(email_token);
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    verifier TEXT NOT NULL,
    signature_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );`;

async function open({ databaseUrl, sqlitePath }) {
  if (databaseUrl) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, ssl: local || /sslmode=disable/.test(databaseUrl) ? false : { rejectUnauthorized: false }, max: 10 });
    await pool.query(SCHEMA(true));
    const tr = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
    return {
      kind: 'postgres',
      async get(sql, p = []) { return (await pool.query(tr(sql), p)).rows[0]; },
      async all(sql, p = []) { return (await pool.query(tr(sql), p)).rows; },
      async run(sql, p = []) {
        const ins = /^\s*INSERT INTO signatures/i.test(sql);
        const r = await pool.query(tr(sql) + (ins ? ' RETURNING id' : ''), p);
        return { changes: r.rowCount, lastId: ins ? Number(r.rows[0].id) : undefined };
      },
    };
  }
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  let db;
  try { const { DatabaseSync } = require('node:sqlite'); db = new DatabaseSync(sqlitePath); }
  catch (e) { const Better = require('better-sqlite3'); db = new Better(sqlitePath); }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;' + SCHEMA(false));
  return {
    kind: 'sqlite',
    async get(sql, p = []) { return db.prepare(sql).get(...p); },
    async all(sql, p = []) { return db.prepare(sql).all(...p); },
    async run(sql, p = []) { const r = db.prepare(sql).run(...p); return { changes: r.changes, lastId: Number(r.lastInsertRowid) }; },
  };
}
module.exports = { open };
