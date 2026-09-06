/**
 * db.ts — Database abstraction layer
 *
 * SCALING DESIGN:
 * One interface (DbApi), two implementations:
 *   - SqliteDb  : zero-config local dev, single file, no external services
 *   - PostgresDb: production, handles concurrent users, horizontal scaling
 *
 * Switch with DATABASE_URL env var:
 *   not set / "sqlite" → SqliteDb (default, works out of the box)
 *   postgres://...     → PostgresDb (set this in production)
 *
 * The rest of the codebase (server.ts, attentionEngine.ts) only sees DbApi.
 * Swapping the database is a single env var change, not a code change.
 */

import type { Watchlist, WatchlistItem, Checkpoint } from './types.js';

// ─── Interface ────────────────────────────────────────────────────────────────
export interface DbApi {
  getWatchlists(userId: string): Promise<Watchlist[]>;
  createWatchlist(userId: string, name: string): Promise<Watchlist>;
  getItems(watchlistId: number): Promise<WatchlistItem[]>;
  addItem(watchlistId: number, symbol: string, name: string): Promise<WatchlistItem>;
  removeItem(watchlistId: number, symbol: string): Promise<void>;
  allWatchedSymbols(): Promise<string[]>;
  getCheckpoint(userId: string, symbol: string): Promise<Checkpoint | undefined>;
  getAllCheckpoints(userId: string): Promise<Record<string, Checkpoint>>;
  setCheckpoints(userId: string, snapshots: { symbol: string; price: number; seq: number; ts: number }[]): Promise<void>;
  close?(): Promise<void>;
}

// ─── SQLite implementation ────────────────────────────────────────────────────
async function createSqliteDb(): Promise<DbApi> {
  const { default: Database } = await import('better-sqlite3');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const db = new Database(path.join(__dirname, '..', 'deltawatch.sqlite'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      UNIQUE(watchlist_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_seen_price REAL NOT NULL,
      last_seen_seq INTEGER NOT NULL,
      PRIMARY KEY (user_id, symbol)
    );
  `);

  // Seed default watchlist for demo-user
  const row = db.prepare('SELECT COUNT(*) as c FROM watchlists WHERE user_id = ?').get('demo-user') as { c: number };
  if (row.c === 0) {
    const now = Date.now();
    const info = db.prepare('INSERT INTO watchlists (user_id, name, position, created_at) VALUES (?, ?, ?, ?)').run('demo-user', 'My Watchlist', 0, now);
    const wid = info.lastInsertRowid as number;
    const defaults: [string, string][] = [
      ['NVDA', 'NVIDIA Corp'], ['TSLA', 'Tesla Inc'], ['AAPL', 'Apple Inc'],
      ['AMD', 'Advanced Micro Devices'], ['COIN', 'Coinbase Global'], ['PLTR', 'Palantir Technologies'],
    ];
    const stmt = db.prepare('INSERT INTO watchlist_items (watchlist_id, symbol, name, added_at) VALUES (?, ?, ?, ?)');
    for (const [s, n] of defaults) stmt.run(wid, s, n, now);
  }

  return {
    async getWatchlists(userId) {
      return db.prepare('SELECT id, user_id as userId, name, position, created_at as createdAt FROM watchlists WHERE user_id = ? ORDER BY position').all(userId) as Watchlist[];
    },
    async createWatchlist(userId, name) {
      const { p } = db.prepare('SELECT COALESCE(MAX(position),-1) as p FROM watchlists WHERE user_id = ?').get(userId) as { p: number };
      const now = Date.now();
      const info = db.prepare('INSERT INTO watchlists (user_id, name, position, created_at) VALUES (?, ?, ?, ?)').run(userId, name, p + 1, now);
      return { id: info.lastInsertRowid as number, userId, name, position: p + 1, createdAt: now };
    },
    async getItems(watchlistId) {
      return db.prepare('SELECT id, watchlist_id as watchlistId, symbol, name, added_at as addedAt FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at').all(watchlistId) as WatchlistItem[];
    },
    async addItem(watchlistId, symbol, name) {
      const now = Date.now();
      const info = db.prepare('INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol, name, added_at) VALUES (?, ?, ?, ?)').run(watchlistId, symbol.toUpperCase(), name, now);
      const id = (info.lastInsertRowid as number) || (db.prepare('SELECT id FROM watchlist_items WHERE watchlist_id=? AND symbol=?').get(watchlistId, symbol.toUpperCase()) as { id: number }).id;
      return { id, watchlistId, symbol: symbol.toUpperCase(), name, addedAt: now };
    },
    async removeItem(watchlistId, symbol) {
      db.prepare('DELETE FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?').run(watchlistId, symbol.toUpperCase());
    },
    async allWatchedSymbols() {
      return (db.prepare('SELECT DISTINCT symbol FROM watchlist_items').all() as { symbol: string }[]).map(r => r.symbol);
    },
    async getCheckpoint(userId, symbol) {
      return db.prepare('SELECT user_id as userId, symbol, last_seen_at as lastSeenAt, last_seen_price as lastSeenPrice, last_seen_seq as lastSeenSeq FROM checkpoints WHERE user_id = ? AND symbol = ?').get(userId, symbol) as Checkpoint | undefined;
    },
    async getAllCheckpoints(userId) {
      const rows = db.prepare('SELECT user_id as userId, symbol, last_seen_at as lastSeenAt, last_seen_price as lastSeenPrice, last_seen_seq as lastSeenSeq FROM checkpoints WHERE user_id = ?').all(userId) as Checkpoint[];
      const out: Record<string, Checkpoint> = {};
      for (const r of rows) out[r.symbol] = r;
      return out;
    },
    async setCheckpoints(userId, snapshots) {
      const stmt = db.prepare(`INSERT INTO checkpoints (user_id, symbol, last_seen_at, last_seen_price, last_seen_seq) VALUES (@userId, @symbol, @lastSeenAt, @lastSeenPrice, @lastSeenSeq) ON CONFLICT(user_id, symbol) DO UPDATE SET last_seen_at=excluded.last_seen_at, last_seen_price=excluded.last_seen_price, last_seen_seq=excluded.last_seen_seq`);
      const tx = db.transaction((rows: typeof snapshots) => {
        for (const r of rows) stmt.run({ userId, symbol: r.symbol, lastSeenAt: r.ts, lastSeenPrice: r.price, lastSeenSeq: r.seq });
      });
      tx(snapshots);
    },
  };
}

// ─── Postgres implementation ──────────────────────────────────────────────────
async function createPostgresDb(connectionString: string): Promise<DbApi> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 });

  // Schema — idempotent, safe to run on every startup
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id SERIAL PRIMARY KEY,
      watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      added_at BIGINT NOT NULL,
      UNIQUE(watchlist_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      last_seen_price DOUBLE PRECISION NOT NULL,
      last_seen_seq INTEGER NOT NULL,
      PRIMARY KEY (user_id, symbol)
    );
    -- Price tick history: survives backend restarts, powers sparklines
    -- In production: add TimescaleDB and run CREATE EXTENSION IF NOT EXISTS timescaledb
    -- then: SELECT create_hypertable('price_ticks','ts',if_not_exists=>true);
    CREATE TABLE IF NOT EXISTS price_ticks (
      symbol TEXT NOT NULL,
      ts BIGINT NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      volume BIGINT,
      PRIMARY KEY (symbol, ts)
    );
    CREATE INDEX IF NOT EXISTS price_ticks_symbol_ts ON price_ticks (symbol, ts DESC);
  `);

  // Seed default watchlist for demo-user
  const { rows: existing } = await pool.query('SELECT COUNT(*)::int as c FROM watchlists WHERE user_id=$1', ['demo-user']);
  if (existing[0].c === 0) {
    const now = Date.now();
    const { rows: [w] } = await pool.query('INSERT INTO watchlists (user_id,name,position,created_at) VALUES ($1,$2,$3,$4) RETURNING id', ['demo-user','My Watchlist',0,now]);
    const defaults: [string,string][] = [['NVDA','NVIDIA Corp'],['TSLA','Tesla Inc'],['AAPL','Apple Inc'],['AMD','Advanced Micro Devices'],['COIN','Coinbase Global'],['PLTR','Palantir Technologies']];
    for (const [s,n] of defaults) await pool.query('INSERT INTO watchlist_items (watchlist_id,symbol,name,added_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[w.id,s,n,now]);
  }

  return {
    async getWatchlists(userId) {
      const { rows } = await pool.query('SELECT id, user_id as "userId", name, position, created_at as "createdAt" FROM watchlists WHERE user_id=$1 ORDER BY position',[userId]);
      return rows as Watchlist[];
    },
    async createWatchlist(userId, name) {
      const { rows:[{p}] } = await pool.query('SELECT COALESCE(MAX(position),-1) as p FROM watchlists WHERE user_id=$1',[userId]);
      const now = Date.now();
      const { rows:[w] } = await pool.query('INSERT INTO watchlists (user_id,name,position,created_at) VALUES ($1,$2,$3,$4) RETURNING id',[userId,name,Number(p)+1,now]);
      return { id: w.id, userId, name, position: Number(p)+1, createdAt: now };
    },
    async getItems(watchlistId) {
      const { rows } = await pool.query('SELECT id, watchlist_id as "watchlistId", symbol, name, added_at as "addedAt" FROM watchlist_items WHERE watchlist_id=$1 ORDER BY added_at',[watchlistId]);
      return rows as WatchlistItem[];
    },
    async addItem(watchlistId, symbol, name) {
      const now = Date.now();
      await pool.query('INSERT INTO watchlist_items (watchlist_id,symbol,name,added_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[watchlistId,symbol.toUpperCase(),name,now]);
      const { rows:[r] } = await pool.query('SELECT id, watchlist_id as "watchlistId", symbol, name, added_at as "addedAt" FROM watchlist_items WHERE watchlist_id=$1 AND symbol=$2',[watchlistId,symbol.toUpperCase()]);
      return r as WatchlistItem;
    },
    async removeItem(watchlistId, symbol) {
      await pool.query('DELETE FROM watchlist_items WHERE watchlist_id=$1 AND symbol=$2',[watchlistId,symbol.toUpperCase()]);
    },
    async allWatchedSymbols() {
      const { rows } = await pool.query('SELECT DISTINCT symbol FROM watchlist_items');
      return rows.map((r: { symbol: string }) => r.symbol);
    },
    async getCheckpoint(userId, symbol) {
      const { rows } = await pool.query('SELECT user_id as "userId", symbol, last_seen_at as "lastSeenAt", last_seen_price as "lastSeenPrice", last_seen_seq as "lastSeenSeq" FROM checkpoints WHERE user_id=$1 AND symbol=$2',[userId,symbol]);
      return rows[0] as Checkpoint | undefined;
    },
    async getAllCheckpoints(userId) {
      const { rows } = await pool.query('SELECT user_id as "userId", symbol, last_seen_at as "lastSeenAt", last_seen_price as "lastSeenPrice", last_seen_seq as "lastSeenSeq" FROM checkpoints WHERE user_id=$1',[userId]);
      const out: Record<string,Checkpoint> = {};
      for (const r of rows as Checkpoint[]) out[r.symbol] = r;
      return out;
    },
    async setCheckpoints(userId, snapshots) {
      if (!snapshots.length) return;
      const values = snapshots.map((r,i) => `($1,$${i*4+2},$${i*4+3},$${i*4+4},$${i*4+5})`).join(',');
      const params: (string | number)[] = [userId];
      for (const r of snapshots) params.push(r.symbol, r.ts, r.price, r.seq);
      await pool.query(`INSERT INTO checkpoints (user_id,symbol,last_seen_at,last_seen_price,last_seen_seq) VALUES ${values} ON CONFLICT(user_id,symbol) DO UPDATE SET last_seen_at=excluded.last_seen_at, last_seen_price=excluded.last_seen_price, last_seen_seq=excluded.last_seen_seq`, params);
    },
    async close() { await pool.end(); },
  };
}

// ─── Factory — picks implementation from env ──────────────────────────────────
let _db: DbApi | null = null;

export async function getDb(): Promise<DbApi> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('postgres')) {
    console.log('[db] Using PostgreSQL');
    _db = await createPostgresDb(url);
  } else {
    console.log('[db] Using SQLite (set DATABASE_URL=postgres://... for production)');
    _db = await createSqliteDb();
  }
  return _db;
}
