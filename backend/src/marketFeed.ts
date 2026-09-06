import type { TickBus } from './tickBus.js';
import type { DbApi } from './db.js';
import type { Tick, SymbolStats } from './types.js';
import { getProvider, simSeedFor } from './marketDataProvider.js';

// ─── Per-symbol rolling stats (in-memory, O(1) per symbol) ───────────────────
const HISTORY_CAP = 240;
const VOLUME_WINDOW = 20;

export const stats = new Map<string, SymbolStats>();
const seqCounters = new Map<string, number>();
const symbolMeta = new Map<string, { name: string; currency: string }>();

export function getMeta(symbol: string) {
  return symbolMeta.get(symbol) ?? { name: symbol, currency: 'USD' };
}

function ensureStats(symbol: string, startPrice: number): SymbolStats {
  let s = stats.get(symbol);
  if (!s) {
    s = {
      symbol, lastPrice: startPrice, lastSeq: 0, lastTs: Date.now(),
      sessionOpen: startPrice, sessionHigh: startPrice, sessionLow: startPrice,
      priceHistory: [], volumeHistory: [], returns: [],
    };
    stats.set(symbol, s);
  }
  return s;
}

export function getStats(symbol: string) { return stats.get(symbol); }

/**
 * Apply tick — last-write-wins BY SEQUENCE NUMBER.
 * A late-arriving packet can never overwrite a fresher one.
 * Both client and server run this same guard.
 */
export function applyTick(tick: Tick, bus?: TickBus): { applied: boolean; stats: SymbolStats } {
  const s = ensureStats(tick.symbol, tick.price);
  if (tick.seq <= s.lastSeq) return { applied: false, stats: s };

  const prevPrice = s.lastPrice;
  s.lastPrice = tick.price; s.lastSeq = tick.seq; s.lastTs = tick.ts;
  s.sessionHigh = Math.max(s.sessionHigh, tick.price);
  s.sessionLow  = Math.min(s.sessionLow,  tick.price);
  if (tick.catalyst) { s.catalyst = tick.catalyst; s.catalystAt = tick.ts; }

  s.priceHistory.push({ ts: tick.ts, price: tick.price });
  if (s.priceHistory.length > HISTORY_CAP) s.priceHistory.shift();

  s.volumeHistory.push(tick.volume);
  if (s.volumeHistory.length > VOLUME_WINDOW) s.volumeHistory.shift();

  if (prevPrice > 0) {
    s.returns.push((tick.price - prevPrice) / prevPrice);
    if (s.returns.length > HISTORY_CAP) s.returns.shift();
  }

  return { applied: true, stats: s };
}

// ─── Active symbol registry ───────────────────────────────────────────────────
const activeSymbols = new Set<string>();
let _db: DbApi | null = null;
let _bus: TickBus | null = null;

export function initFeedDeps(db: DbApi, bus: TickBus) {
  _db = db;
  _bus = bus;
}

/**
 * Register a symbol — the single bridge between "user added a ticker"
 * and "ticker enters the data pipeline". Idempotent.
 *
 * For Yahoo: fetches live quote + intraday history immediately.
 *            Also loads recent ticks from DB if Postgres is configured,
 *            so sparklines survive backend restarts.
 * For sim:   seeds a deterministic starting price.
 */
export async function registerSymbol(symbol: string): Promise<{ name: string; currency: string }> {
  if (activeSymbols.has(symbol)) return getMeta(symbol);

  const provider = getProvider();

  if (provider.name === 'yahoo') {
    try {
      const quote = await provider.getQuote(symbol);
      symbolMeta.set(symbol, { name: quote.name, currency: quote.currency });
      const s = ensureStats(symbol, quote.price);
      if (quote.volume > 0) s.volumeHistory.push(quote.avgVolume > 0 ? quote.avgVolume : quote.volume);

      // Load recent ticks from DB (Postgres with price_ticks table)
      // This makes sparklines survive backend restarts
      if (_db) {
        try {
          const history = await provider.getHistory(symbol);
          for (const pt of history) {
            s.priceHistory.push(pt);
            if (s.priceHistory.length > HISTORY_CAP) s.priceHistory.shift();
          }
          for (let i = 1; i < s.priceHistory.length; i++) {
            const prev = s.priceHistory[i-1].price;
            if (prev > 0) {
              s.returns.push((s.priceHistory[i].price - prev) / prev);
              if (s.returns.length > HISTORY_CAP) s.returns.shift();
            }
          }
        } catch { /* history fetch failed — proceed with current price only */ }
      }

      activeSymbols.add(symbol);
      return { name: quote.name, currency: quote.currency };
    } catch (err) {
      throw err; // surfaces to the add-item endpoint as a user-facing error
    }
  } else {
    const seed = simSeedFor(symbol);
    symbolMeta.set(symbol, { name: seed.name, currency: seed.currency });
    ensureStats(symbol, seed.price);
    activeSymbols.add(symbol);
    return { name: seed.name, currency: seed.currency };
  }
}

// ─── Feed loop ────────────────────────────────────────────────────────────────
let running = false;

export function startFeed() {
  if (running || !_bus) return;
  running = true;

  const provider = getProvider();
  const bus = _bus;

  if (provider.name === 'yahoo') {
    const POLL_MS = 15_000;
    setInterval(async () => {
      // Process symbols in parallel batches — faster for large watchlists
      const symbols = [...activeSymbols];
      // Batch of 5 concurrent requests — stays well within Yahoo rate limits
      for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        await Promise.allSettled(batch.map(async (symbol) => {
          try {
            const quote = await provider.getQuote(symbol);
            const seq = (seqCounters.get(symbol) ?? 0) + 1;
            seqCounters.set(symbol, seq);
            symbolMeta.set(symbol, { name: quote.name, currency: quote.currency });
            const tick: Tick = { symbol, seq, ts: Date.now(), price: quote.price, volume: quote.volume, marketState: quote.marketState };
            bus.publish(tick);
          } catch (err) {
            console.warn(`[market] ${symbol}:`, (err as Error).message);
          }
        }));
      }
    }, POLL_MS);
    console.log(`[market] Yahoo Finance polling every ${POLL_MS/1000}s`);

  } else {
    const TICK_MS = 900;
    setInterval(() => {
      for (const symbol of activeSymbols) {
        const s = stats.get(symbol);
        if (!s) continue;
        const seq = (seqCounters.get(symbol) ?? 0) + 1;
        seqCounters.set(symbol, seq);

        const shock = Math.random() < 0.03 ? (Math.random() < 0.5 ? -1 : 1) * (Math.random() * 0.025) : 0;
        const drift = (Math.random() - 0.5) * 0.004;
        const newPrice = Math.max(0.01, s.lastPrice * (1 + drift + shock));
        const baseVol = 50_000 + Math.random() * 20_000;
        const spike = Math.random() < 0.05;
        const volume = Math.round(spike ? baseVol * (3 + Math.random() * 4) : baseVol);
        const catalyst = Math.random() < 0.015 ? `Block deal: ${(Math.random()*3+0.5).toFixed(1)}M shares` : undefined;

        bus.publish({ symbol, seq, ts: Date.now(), price: Number(newPrice.toFixed(2)), volume, catalyst, marketState: 'REGULAR' });
      }
    }, TICK_MS);
    console.log(`[market] Simulated feed ticking every ${TICK_MS}ms`);
  }
}
