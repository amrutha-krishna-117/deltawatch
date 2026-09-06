import { create } from 'zustand';
import type { AttentionPacket, DataSource, SearchResult, Watchlist } from './types';

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const USER_ID = 'demo-user';

export type ConnStatus = 'connecting' | 'live' | 'polling-fallback' | 'offline';

// Module-level ref so addSymbol can signal the open socket without React state churn
export const wsRef = { current: null as WebSocket | null };

interface StoreState {
  userId: string;
  watchlists: Watchlist[];
  activeWatchlistId: number | null;
  packets: Record<string, AttentionPacket>;
  banner: string | null;
  connStatus: ConnStatus;
  sortMode: 'attention' | 'alpha' | 'delta';
  dataSource: DataSource;

  loadWatchlists: () => Promise<void>;
  loadStatus: () => Promise<void>;
  selectWatchlist: (id: number) => void;
  addSymbol: (symbol: string, name?: string) => Promise<{ error?: string }>;
  removeSymbol: (symbol: string) => Promise<void>;
  resetCheckpoint: () => Promise<void>;
  applySnapshot: (packets: AttentionPacket[]) => void;
  applyTick: (packet: AttentionPacket) => void;
  setConnStatus: (s: ConnStatus) => void;
  setSortMode: (m: StoreState['sortMode']) => void;
  fetchLiveOnce: () => Promise<void>;
  searchSymbols: (q: string) => Promise<SearchResult[]>;
}

export const useStore = create<StoreState>((set, get) => ({
  userId: USER_ID,
  watchlists: [],
  activeWatchlistId: null,
  packets: {},
  banner: null,
  connStatus: 'connecting',
  sortMode: 'attention',
  dataSource: 'sim',

  loadStatus: async () => {
    try {
      const res = await fetch(`${API}/api/status`);
      const data = await res.json();
      set({ dataSource: data.dataSource as DataSource });
    } catch { /* non-fatal */ }
  },

  loadWatchlists: async () => {
    const res = await fetch(`${API}/api/watchlists?userId=${USER_ID}`);
    const watchlists: Watchlist[] = await res.json();
    set({ watchlists, activeWatchlistId: get().activeWatchlistId ?? watchlists[0]?.id ?? null });
  },

  selectWatchlist: (id) => set({ activeWatchlistId: id, packets: {} }),

  addSymbol: async (symbol, name) => {
    const id = get().activeWatchlistId;
    if (!id) return {};
    const res = await fetch(`${API}/api/watchlists/${id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: symbol.toUpperCase(), name: name ?? symbol.toUpperCase() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error ?? 'Failed to add symbol' };
    }
    await get().loadWatchlists();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'refresh-subscription' }));
    }
    return {};
  },

  removeSymbol: async (symbol) => {
    const id = get().activeWatchlistId;
    if (!id) return;
    await fetch(`${API}/api/watchlists/${id}/items/${symbol}`, { method: 'DELETE' });
    set((s) => { const next = { ...s.packets }; delete next[symbol]; return { packets: next }; });
    await get().loadWatchlists();
  },

  resetCheckpoint: async () => {
    const id = get().activeWatchlistId;
    if (!id) return;
    await fetch(`${API}/api/watchlists/${id}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID }),
    });
    await get().fetchLiveOnce();
  },

  applySnapshot: (packets) => {
    const map: Record<string, AttentionPacket> = {};
    for (const p of packets) map[p.symbol] = p;
    set({ packets: map });
  },

  applyTick: (packet) => {
    set((s) => {
      const existing = s.packets[packet.symbol];
      if (existing && packet.seq <= existing.seq) return s;
      return { packets: { ...s.packets, [packet.symbol]: packet } };
    });
  },

  setConnStatus: (connStatus) => set({ connStatus }),
  setSortMode: (sortMode) => set({ sortMode }),

  fetchLiveOnce: async () => {
    const id = get().activeWatchlistId;
    if (!id) return;
    const res = await fetch(`${API}/api/watchlists/${id}/live?userId=${USER_ID}`);
    const data = await res.json();
    get().applySnapshot(data.packets);
    set({ banner: data.banner, dataSource: data.dataSource as DataSource });
  },

  searchSymbols: async (q) => {
    if (!q.trim()) return [];
    try {
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  },
}));

export { API, USER_ID };
