export type AttentionBand = 'Low' | 'Medium' | 'High';
export type MarketState = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'UNKNOWN';
export type DataSource = 'yahoo' | 'sim';

export interface AttentionPacket {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  seq: number;
  ts: number;
  sessionDeltaPct: number | null;
  sinceCheckpointHigh: number | null;
  sinceCheckpointLow: number | null;
  volumeRatio: number;
  attentionScore: number;
  attentionBand: AttentionBand;
  reason: string;
  stale: boolean;
  sparkline: { ts: number; price: number }[];
  checkpointTs: number | null;
  checkpointPrice: number | null;
  marketState: MarketState;
  dataSource: DataSource;
  error?: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface WatchlistItem {
  id: number;
  watchlistId: number;
  symbol: string;
  name: string;
  addedAt: number;
}

export interface Watchlist {
  id: number;
  userId: string;
  name: string;
  position: number;
  createdAt: number;
  items: WatchlistItem[];
}
