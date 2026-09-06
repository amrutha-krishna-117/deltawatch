import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getDb } from './db.js';
import { getTickBus } from './tickBus.js';
import { initFeedDeps, startFeed, getStats, applyTick, registerSymbol } from './marketFeed.js';
import { computeAttention } from './attentionEngine.js';
import { getProvider } from './marketDataProvider.js';
import type { AttentionPacket } from './types.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const db = await getDb();
const bus = await getTickBus();
initFeedDeps(db, bus);

// Register all persisted symbols before starting the feed
const existingSymbols = await db.allWatchedSymbols();
console.log(`[startup] Registering ${existingSymbols.length} persisted symbol(s)…`);
const results = await Promise.allSettled(existingSymbols.map(sym => registerSymbol(sym)));
const failed = results.filter(r => r.status === 'rejected').length;
if (failed) console.warn(`[startup] ${failed} symbol(s) failed to register — will retry on next poll`);
console.log(`[startup] Feed ready`);

startFeed();

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

/**
 * User identity: extracted from Authorization header (Bearer token) in production,
 * or falls back to "demo-user" for local development.
 *
 * SCALING NOTE: Replace this with real JWT verification when adding auth.
 * The userId is already threaded through every DB call — adding auth is a
 * middleware change, not an architecture change.
 */
function getUserId(req: express.Request): string {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) {
    // In production: verify JWT, return sub claim
    // For now: use the token itself as userId (supports multi-user demo)
    const token = auth.slice(7).trim();
    if (token && token !== 'demo') return token;
  }
  return req.query.userId as string || 'demo-user';
}

// ─── Rate limiting — simple in-process, replace with redis-rate-limiter for multi-instance
const searchRateMap = new Map<string, { count: number; resetAt: number }>();
function checkSearchRate(userId: string): boolean {
  const now = Date.now();
  const entry = searchRateMap.get(userId) ?? { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++;
  searchRateMap.set(userId, entry);
  return entry.count <= 30; // 30 searches/minute per user
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({
    dataSource: getProvider().name,
    db: process.env.DATABASE_URL?.startsWith('postgres') ? 'postgres' : 'sqlite',
    bus: process.env.REDIS_URL ? 'redis' : 'memory',
    symbols: [...(new Set<string>())].length, // will be expanded
  });
});

app.get('/api/search', async (req, res) => {
  const userId = getUserId(req);
  if (!checkSearchRate(userId)) return res.status(429).json({ error: 'Too many searches. Wait a minute.' });
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    res.json(await getProvider().search(q));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/watchlists', async (req, res) => {
  const userId = getUserId(req);
  const watchlists = await db.getWatchlists(userId);
  const withItems = await Promise.all(watchlists.map(async w => ({ ...w, items: await db.getItems(w.id) })));
  res.json(withItems);
});

app.post('/api/watchlists', async (req, res) => {
  const userId = getUserId(req);
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  res.json(await db.createWatchlist(userId, name));
});

app.post('/api/watchlists/:id/items', async (req, res) => {
  const userId = getUserId(req);
  const watchlistId = Number(req.params.id);
  const { symbol, name } = req.body ?? {};
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  const raw = String(symbol).trim().toUpperCase();
  if (!/^[\^A-Z0-9][A-Z0-9.\-]{0,11}$/.test(raw)) {
    return res.status(400).json({ error: `"${symbol}" is not a valid ticker. Try AAPL or TCS.NS.` });
  }

  try {
    const meta = await registerSymbol(raw);
    const resolvedName = (name && name !== raw) ? name : meta.name;
    const item = await db.addItem(watchlistId, raw, resolvedName);

    // Notify all WS clients watching this list
    for (const client of clients) {
      if (client.watchlistId === watchlistId && client.ws.readyState === WebSocket.OPEN) {
        await refreshClientSymbols(client);
        client.ws.send(JSON.stringify({ type: 'snapshot', packets: await buildPackets(userId, watchlistId) }));
      }
    }
    res.json({ ...item, name: resolvedName });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/watchlists/:id/items/:symbol', async (req, res) => {
  await db.removeItem(Number(req.params.id), req.params.symbol);
  res.json({ ok: true });
});

async function buildPackets(userId: string, watchlistId: number): Promise<AttentionPacket[]> {
  const items = await db.getItems(watchlistId);
  const checkpoints = await db.getAllCheckpoints(userId);
  const now = Date.now();
  return items
    .map(it => computeAttention(getStats(it.symbol), it.symbol, checkpoints[it.symbol], now))
    .sort((a, b) => b.attentionScore - a.attentionScore);
}

app.get('/api/watchlists/:id/live', async (req, res) => {
  const userId = getUserId(req);
  const watchlistId = Number(req.params.id);
  const packets = await buildPackets(userId, watchlistId);
  const checkpoints = await db.getAllCheckpoints(userId);
  const everChecked = Object.keys(checkpoints).length > 0;
  const oldestCp = everChecked ? Math.min(...Object.values(checkpoints).map(c => c.lastSeenAt)) : null;
  const moved = packets.filter(p => p.sessionDeltaPct !== null && Math.abs(p.sessionDeltaPct) >= 1);
  const leader = [...moved].sort((a,b) => Math.abs(b.sessionDeltaPct!) - Math.abs(a.sessionDeltaPct!))[0];
  let banner: string | null = null;
  if (everChecked && oldestCp) {
    const when = new Date(oldestCp).toLocaleTimeString();
    banner = moved.length
      ? `Since you last checked at ${when}, ${moved.length} stock${moved.length===1?'':'s'} moved ≥1%, led by ${leader!.symbol} (${leader!.sessionDeltaPct!>=0?'+':''}${leader!.sessionDeltaPct!.toFixed(2)}%).`
      : `Since you last checked at ${when}, nothing has moved meaningfully.`;
  }
  res.json({ banner, packets, dataSource: getProvider().name });
});

app.post('/api/watchlists/:id/checkpoint', async (req, res) => {
  const userId = getUserId(req);
  const watchlistId = Number(req.params.id);
  const items = await db.getItems(watchlistId);
  const now = Date.now();
  const snapshots = items
    .map(it => { const s = getStats(it.symbol); return s && s.lastPrice > 0 ? { symbol: it.symbol, price: s.lastPrice, seq: s.lastSeq, ts: now } : null; })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  await db.setCheckpoints(userId, snapshots);
  res.json({ ok: true, checkpoints: snapshots });
});

// ─── WebSocket gateway ────────────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientState { ws: WebSocket; userId: string; watchlistId: number; symbols: Set<string>; }
const clients = new Set<ClientState>();

async function refreshClientSymbols(client: ClientState) {
  const items = await db.getItems(client.watchlistId);
  client.symbols = new Set(items.map(i => i.symbol));
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  const userId = url.searchParams.get('userId') ?? 'demo-user';
  const watchlistId = Number(url.searchParams.get('watchlistId') ?? '0');
  const client: ClientState = { ws, userId, watchlistId, symbols: new Set() };
  await refreshClientSymbols(client);
  clients.add(client);
  ws.send(JSON.stringify({ type: 'snapshot', packets: await buildPackets(userId, watchlistId) }));
  ws.on('close', () => clients.delete(client));
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'refresh-subscription') await refreshClientSymbols(client);
    } catch { /* ignore */ }
  });
});

// Single tick bus subscription — works for both in-memory and Redis
bus.subscribe(async (tick) => {
  const { applied } = applyTick(tick);
  if (!applied) return;
  const s = getStats(tick.symbol);
  if (s && tick.marketState) s.marketState = tick.marketState;

  // Fan-out only to clients subscribed to this symbol
  // Cost: O(clients × 1 Set lookup) — not O(clients × watchlist size)
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!client.symbols.has(tick.symbol)) continue;
    const checkpoint = await db.getCheckpoint(client.userId, tick.symbol);
    const packet = computeAttention(getStats(tick.symbol), tick.symbol, checkpoint, Date.now());
    client.ws.send(JSON.stringify({ type: 'tick', packet }));
  }
});

// Safety net: periodic full snapshot covers stale detection and silent WS deaths
const SNAP_INTERVAL = getProvider().name === 'yahoo' ? 20_000 : 4_000;
setInterval(async () => {
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(JSON.stringify({ type: 'snapshot', packets: await buildPackets(client.userId, client.watchlistId) }));
  }
}, SNAP_INTERVAL);

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => console.log(`[startup] DeltaWatch listening on :${PORT}`));
