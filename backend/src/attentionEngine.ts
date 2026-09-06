import type { SymbolStats, Checkpoint, AttentionPacket, AttentionBand } from './types.js';
import { getProvider } from './marketDataProvider.js';
import { getMeta } from './marketFeed.js';

const STALE_MS_YAHOO = 35_000;
const STALE_MS_SIM   =  5_000;
const CATALYST_WINDOW_MS = 5 * 60_000;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

/**
 * WHAT COUNTS AS MEANINGFUL CHANGE — the full algorithm:
 *
 * Score (0-100) = volatility component + volume component + catalyst component
 *
 * 1. Volatility-adjusted delta (55 pts max)
 *    z = |session_delta_pct / 100| / stdev(recent_returns)
 *    score = min(z / 4, 1) * 55
 *    → A 2% move on a calm stock scores higher than 2% on a volatile one
 *    → A z-score of 4 (4x typical daily move) maxes this component
 *
 * 2. Volume confirmation (30 pts max)
 *    ratio = current_volume / sma(volume, 20)
 *    score = min((ratio - 1) / 3, 1) * 30
 *    → 4x average volume maxes this component
 *    → Volume below average scores 0 — price moves without volume are suspect
 *
 * 3. Catalyst (15 pts)
 *    Binary: recent news/block-deal tag within 5 minutes adds 15 pts
 *
 * Neither price alone nor volume alone reaches HIGH.
 * Both must confirm each other, optionally with a catalyst.
 */
export function computeAttention(
  symbolStats: SymbolStats | undefined,
  symbol: string,
  checkpoint: Checkpoint | undefined,
  now: number
): AttentionPacket {
  const provider = getProvider();
  const meta = getMeta(symbol);
  const staleMs = provider.name === 'yahoo' ? STALE_MS_YAHOO : STALE_MS_SIM;

  if (!symbolStats) {
    return {
      symbol, name: meta.name, currency: meta.currency,
      price: 0, seq: 0, ts: now,
      sessionDeltaPct: null, sinceCheckpointHigh: null, sinceCheckpointLow: null,
      volumeRatio: 0, attentionScore: 0, attentionBand: 'Low',
      reason: 'Fetching market data…', stale: true, sparkline: [],
      checkpointTs: checkpoint?.lastSeenAt ?? null,
      checkpointPrice: checkpoint?.lastSeenPrice ?? null,
      marketState: 'UNKNOWN', dataSource: provider.name,
    };
  }

  const stale = now - symbolStats.lastTs > staleMs;
  const sessionDeltaPct = checkpoint
    ? ((symbolStats.lastPrice - checkpoint.lastSeenPrice) / checkpoint.lastSeenPrice) * 100
    : null;

  const cpPrices = checkpoint
    ? symbolStats.priceHistory.filter(p => p.ts >= checkpoint.lastSeenAt).map(p => p.price)
    : [];
  const sinceCheckpointHigh = cpPrices.length ? Math.max(...cpPrices, symbolStats.lastPrice) : null;
  const sinceCheckpointLow  = cpPrices.length ? Math.min(...cpPrices, symbolStats.lastPrice) : null;

  const vol = Math.max(stdev(symbolStats.returns), 0.0015);
  const deltaFraction = sessionDeltaPct !== null ? sessionDeltaPct / 100 : 0;
  const zScore = Math.abs(deltaFraction) / vol;

  const avgVolume = symbolStats.volumeHistory.length
    ? symbolStats.volumeHistory.reduce((a, b) => a + b, 0) / symbolStats.volumeHistory.length
    : 0;
  const currentVolume = symbolStats.volumeHistory.at(-1) ?? 0;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  const hasCatalyst = !!symbolStats.catalystAt && (now - symbolStats.catalystAt) < CATALYST_WINDOW_MS;

  const zComp        = Math.min(zScore / 4, 1) * 55;
  const volComp      = Math.min(Math.max(volumeRatio - 1, 0) / 3, 1) * 30;
  const catalystComp = hasCatalyst ? 15 : 0;
  let score = Math.round(zComp + volComp + catalystComp);
  if (!checkpoint) score = Math.round(score * 0.4); // temper confidence before first checkpoint
  score = Math.min(100, Math.max(0, score));

  const band: AttentionBand = score >= 66 ? 'High' : score >= 33 ? 'Medium' : 'Low';

  // Human-readable reasons — the "Why" column
  const reasons: string[] = [];
  if (zScore >= 1.5 && sessionDeltaPct !== null) {
    const dir = sessionDeltaPct >= 0 ? 'up' : 'down';
    reasons.push(`${symbolStats.symbol} is ${dir} ${Math.abs(sessionDeltaPct).toFixed(2)}% — unusual for this symbol`);
  }
  if (volumeRatio >= 1.8) reasons.push(`Volume ${volumeRatio.toFixed(1)}× above average`);
  if (hasCatalyst && symbolStats.catalyst) reasons.push(symbolStats.catalyst);
  if (reasons.length === 0) {
    reasons.push(
      stale && symbolStats.marketState === 'CLOSED' ? 'Market closed — last traded price'
      : stale ? 'Data updating…'
      : 'Trading within its normal range'
    );
  }

  return {
    symbol: symbolStats.symbol, name: meta.name, currency: meta.currency,
    price: symbolStats.lastPrice, seq: symbolStats.lastSeq, ts: symbolStats.lastTs,
    sessionDeltaPct, sinceCheckpointHigh, sinceCheckpointLow,
    volumeRatio, attentionScore: score, attentionBand: band,
    reason: reasons.join(' · '),
    stale, sparkline: symbolStats.priceHistory,
    checkpointTs: checkpoint?.lastSeenAt ?? null,
    checkpointPrice: checkpoint?.lastSeenPrice ?? null,
    marketState: symbolStats.marketState ?? 'UNKNOWN',
    dataSource: provider.name,
  };
}
