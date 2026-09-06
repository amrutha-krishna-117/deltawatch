export interface Tick {
  symbol: string;
  seq: number;
  ts: number;
  price: number;
  volume: number;
  catalyst?: string;
  marketState?: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'UNKNOWN';
}

export interface SymbolStats {
  symbol: string;
  lastPrice: number;
  lastSeq: number;
  lastTs: number;
  sessionOpen: number;
  sessionHigh: number;
  sessionLow: number;
  priceHistory: { ts: number; price: number }[];
  volumeHistory: number[];
  returns: number[];
  catalyst?: string;
  catalystAt?: number;
  marketState?: Tick['marketState'];
}

export type AttentionBand = 'Low' | 'Medium' | 'High';

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
  marketState: Tick['marketState'];
  dataSource: 'yahoo' | 'sim';
  error?: string; // set when the symbol has a known resolution error
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
}

export interface Checkpoint {
  userId: string;
  symbol: string;
  lastSeenAt: number;
  lastSeenPrice: number;
  lastSeenSeq: number;
}
