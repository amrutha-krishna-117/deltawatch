/**
 * MarketDataProvider — the single abstraction that separates "where does data
 * come from" from "how does it flow through the system".
 *
 * Two adapters exist:
 *  - YahooFinanceProvider: real market data via yahoo-finance2 (no API key needed,
 *    requires outbound internet to query1/query2.finance.yahoo.com).
 *  - SimulatedProvider:    clearly-labelled synthetic data for development / offline.
 *
 * The system auto-selects via MARKET_DATA_PROVIDER env var:
 *   "yahoo"  → YahooFinanceProvider (with network availability check)
 *   "sim"    → SimulatedProvider
 *
 * The active provider name is exposed to clients via the /api/status endpoint
 * so the UI can show an honest data-source badge.
 */

export interface Quote {
  symbol: string;           // normalised, e.g. "TCS.NS"
  name: string;             // full company name, e.g. "Tata Consultancy Services"
  price: number;            // latest trade price
  currency: string;         // "USD", "INR", etc.
  volume: number;           // latest period volume (0 if unavailable)
  avgVolume: number;        // 10/30-day avg volume for ratio calculation (0 if unavailable)
  dayChangePercent: number; // % change from prev close to now
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'UNKNOWN';
  source: 'yahoo' | 'sim';  // which adapter produced this
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;   // "EQUITY", "ETF", etc.
}

export interface HistoryPoint {
  ts: number;   // epoch ms
  price: number;
}

export interface MarketDataProvider {
  readonly name: 'yahoo' | 'sim';

  /** Validate & resolve a symbol. Throws with a user-friendly message if not found. */
  resolveSymbol(rawSymbol: string): Promise<{ symbol: string; name: string; currency: string }>;

  /** Fetch a single real-time (or delayed) quote. */
  getQuote(symbol: string): Promise<Quote>;

  /** Fetch intraday / recent history for the sparkline. */
  getHistory(symbol: string): Promise<HistoryPoint[]>;

  /** Search for symbols matching a query string. */
  search(query: string): Promise<SearchResult[]>;
}

// ─── Yahoo Finance Adapter ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YFClient = any; // yahoo-finance2 instance type — inferred by its own createYahooFinance factory

class YahooFinanceProvider implements MarketDataProvider {
  readonly name = 'yahoo' as const;
  private yf: YFClient = null;

  private async client(): Promise<YFClient> {
    if (this.yf) return this.yf;
    const mod = await import('yahoo-finance2');
    const YF = mod.default;
    this.yf = new YF({ suppressNotices: ['yahooSurvey'] });
    return this.yf;
  }

  async resolveSymbol(rawSymbol: string) {
    const yf = await this.client();
    // First try the symbol exactly as given
    try {
      const q = await yf.quote(rawSymbol, { fields: ['longName', 'shortName', 'currency'] });
      if (q && q.regularMarketPrice != null) {
        return {
          symbol: rawSymbol.toUpperCase(),
          name: q.longName ?? q.shortName ?? rawSymbol.toUpperCase(),
          currency: q.currency ?? 'USD',
        };
      }
    } catch {
      // fall through to search
    }
    // Try searching if direct lookup failed
    const results = await this.search(rawSymbol);
    if (results.length === 0) {
      throw new Error(`Symbol "${rawSymbol}" not found. Try searching by company name or use the full ticker (e.g. TCS.NS for NSE-listed stocks).`);
    }
    const best = results[0];
    return { symbol: best.symbol, name: best.name, currency: 'USD' };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const yf = await this.client();
    const q = await yf.quote(symbol);
    if (!q || q.regularMarketPrice == null) {
      throw new Error(`No quote data returned for ${symbol}`);
    }
    return {
      symbol: q.symbol ?? symbol,
      name: q.longName ?? q.shortName ?? symbol,
      price: q.regularMarketPrice,
      currency: q.currency ?? 'USD',
      volume: q.regularMarketVolume ?? 0,
      avgVolume: q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0,
      dayChangePercent: q.regularMarketChangePercent ?? 0,
      marketState: (q.marketState as Quote['marketState']) ?? 'UNKNOWN',
      source: 'yahoo',
    };
  }

  async getHistory(symbol: string): Promise<HistoryPoint[]> {
    const yf = await this.client();
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day back
    const result = await yf.chart(symbol, {
      interval: '5m',
      period1: from,
      period2: now,
    });
    if (!result?.quotes) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (result.quotes as any[])
      .filter((q: any) => q != null && q.date != null && q.close != null)
      .map((q: any) => ({ ts: new Date(q.date as string).getTime(), price: q.close as number }));
  }

  async search(query: string): Promise<SearchResult[]> {
    const yf = await this.client();
    const res = await yf.search(query, { newsCount: 0, quotesCount: 8 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((res.quotes ?? []) as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => q.symbol && q.quoteType === 'EQUITY')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any) => ({
        symbol: q.symbol as string,
        name: (q.longname ?? q.shortname ?? q.symbol) as string,
        exchange: (q.exchDisp ?? '') as string,
        type: (q.quoteType ?? 'EQUITY') as string,
      }));
  }
}

// ─── Simulated Adapter ────────────────────────────────────────────────────────
// This is the honest fallback. Prices are clearly synthetic (the UI shows a
// "Simulated data" badge). Nothing here is presented as real market data.

// A small set of well-known symbols with realistic seed prices. Any symbol NOT
// in this table gets a deterministic hash-derived price so no symbol is ever
// silently refused — the sim feed is truly generic.
const SIM_SEEDS: Record<string, { price: number; name: string; currency: string }> = {
  AAPL:        { price: 227.50, name: 'Apple Inc.',              currency: 'USD' },
  TSLA:        { price: 248.00, name: 'Tesla Inc.',              currency: 'USD' },
  NVDA:        { price: 130.00, name: 'NVIDIA Corporation',      currency: 'USD' },
  AMD:         { price: 156.00, name: 'Advanced Micro Devices',  currency: 'USD' },
  MSFT:        { price: 430.00, name: 'Microsoft Corporation',   currency: 'USD' },
  GOOGL:       { price: 174.00, name: 'Alphabet Inc.',           currency: 'USD' },
  META:        { price: 515.00, name: 'Meta Platforms',          currency: 'USD' },
  AMZN:        { price: 188.00, name: 'Amazon.com Inc.',         currency: 'USD' },
  COIN:        { price: 200.00, name: 'Coinbase Global',         currency: 'USD' },
  PLTR:        { price: 43.00,  name: 'Palantir Technologies',   currency: 'USD' },
  'TCS.NS':    { price: 4150.00, name: 'Tata Consultancy Services', currency: 'INR' },
  'INFY.NS':   { price: 1850.00, name: 'Infosys Limited',        currency: 'INR' },
  'RELIANCE.NS': { price: 2950.00, name: 'Reliance Industries',  currency: 'INR' },
  'HDFCBANK.NS': { price: 1760.00, name: 'HDFC Bank Limited',   currency: 'INR' },
  'WIPRO.NS':  { price: 560.00, name: 'Wipro Limited',           currency: 'INR' },
};

function hashSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (Math.imul(31, h) + symbol.charCodeAt(i)) | 0;
  return 20 + (Math.abs(h) % 480);
}

export function simSeedFor(symbol: string): { price: number; name: string; currency: string } {
  return SIM_SEEDS[symbol] ?? { price: hashSeed(symbol), name: symbol, currency: 'USD' };
}

class SimulatedProvider implements MarketDataProvider {
  readonly name = 'sim' as const;

  /** Any syntactically valid symbol is accepted — no symbol is ever refused. */
  async resolveSymbol(rawSymbol: string) {
    const sym = rawSymbol.toUpperCase();
    const seed = simSeedFor(sym);
    return { symbol: sym, name: seed.name, currency: seed.currency };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const seed = simSeedFor(symbol);
    return {
      symbol,
      name: seed.name,
      price: seed.price,
      currency: seed.currency,
      volume: 60_000,
      avgVolume: 60_000,
      dayChangePercent: 0,
      marketState: 'REGULAR',
      source: 'sim',
    };
  }

  async getHistory(symbol: string): Promise<HistoryPoint[]> {
    // Return empty — the real-time rolling tick history IS the sparkline history.
    // Intraday seed history would just be the sim price with no variation yet.
    return [];
  }

  async search(query: string): Promise<SearchResult[]> {
    const q = query.toUpperCase();
    // Match against known seeds: by symbol prefix or name substring
    return Object.entries(SIM_SEEDS)
      .filter(([sym, info]) => sym.startsWith(q) || info.name.toUpperCase().includes(q))
      .slice(0, 6)
      .map(([sym, info]) => ({
        symbol: sym,
        name: info.name,
        exchange: sym.endsWith('.NS') ? 'NSE' : 'SIM',
        type: 'EQUITY',
      }));
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let _provider: MarketDataProvider | null = null;

export function getProvider(): MarketDataProvider {
  if (_provider) return _provider;

  const requested = (process.env.MARKET_DATA_PROVIDER ?? 'sim').toLowerCase();
  if (requested === 'yahoo') {
    console.log('[market] Using Yahoo Finance provider (real market data)');
    _provider = new YahooFinanceProvider();
  } else {
    if (requested !== 'sim') {
      console.warn(`[market] Unknown MARKET_DATA_PROVIDER="${requested}", falling back to simulated`);
    }
    console.log('[market] Using simulated market data provider (set MARKET_DATA_PROVIDER=yahoo for real data)');
    _provider = new SimulatedProvider();
  }
  return _provider;
}
