import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { StockCard, StockCardSkeleton } from './StockCard';
import type { AttentionPacket } from '../types';

type SortMode = 'attention' | 'delta' | 'alpha';

const SORT_LABELS: Record<SortMode, string> = {
  attention: 'Attention',
  delta:     'Biggest move',
  alpha:     'A – Z',
};

function EmptyState() {
  const addSymbol = useStore((s) => s.addSymbol);
  const SUGGESTIONS = ['AAPL', 'NVDA', 'TSLA', 'TCS.NS'];

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)' }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5">
          <path d="M3 3h18v18H3zM9 9l6 6M15 9l-6 6" />
          <circle cx="12" cy="5" r="1" fill="#818cf8" />
        </svg>
      </div>
      <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>
        Build your watchlist
      </h3>
      <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
        Add the stocks that matter to you. DeltaWatch will tell you what meaningfully changed each time you return.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {SUGGESTIONS.map((sym) => (
          <button
            key={sym}
            onClick={() => addSymbol(sym)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: 'rgba(129,140,248,0.1)',
              color: '#818cf8',
              border: '1px solid rgba(129,140,248,0.2)',
            }}
            onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.2)'; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)'; }}
          >
            + {sym}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WatchlistGrid() {
  const watchlists = useStore((s) => s.watchlists);
  const activeWatchlistId = useStore((s) => s.activeWatchlistId);
  const packets = useStore((s) => s.packets);
  const removeSymbol = useStore((s) => s.removeSymbol);
  const [sortMode, setSortMode] = useState<SortMode>('attention');

  const active = watchlists.find((w) => w.id === activeWatchlistId);
  const items = active?.items ?? [];

  // Packets that have loaded
  const loadedPackets = useMemo(() => {
    const rows = items
      .map((i) => packets[i.symbol])
      .filter((p): p is AttentionPacket => !!p);

    const copy = [...rows];
    if (sortMode === 'attention')
      copy.sort((a, b) => b.attentionScore - a.attentionScore);
    else if (sortMode === 'delta')
      copy.sort((a, b) => Math.abs(b.sessionDeltaPct ?? 0) - Math.abs(a.sessionDeltaPct ?? 0));
    else
      copy.sort((a, b) => a.symbol.localeCompare(b.symbol));

    return copy;
  }, [items, packets, sortMode]);

  // Items still waiting for their first packet
  const loadingItems = items.filter((i) => !packets[i.symbol]);

  if (items.length === 0) return <EmptyState />;

  return (
    <div>
      {/* Sort toolbar */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Your watchlist
          <span className="ml-2 font-normal" style={{ color: 'var(--text-dim)' }}>
            · {items.length} stock{items.length !== 1 ? 's' : ''}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              className="px-2.5 py-1 rounded-lg text-xs transition-all"
              style={{
                background: sortMode === m ? 'rgba(129,140,248,0.15)' : 'transparent',
                color: sortMode === m ? '#818cf8' : 'var(--text-dim)',
                border: sortMode === m ? '1px solid rgba(129,140,248,0.25)' : '1px solid transparent',
              }}
            >
              {SORT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid — responsive: 1 col mobile, 2 col tablet, 3 col desktop */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {loadedPackets.map((p) => (
          <StockCard key={p.symbol} p={p} onRemove={removeSymbol} />
        ))}
        {loadingItems.map((i) => (
          <StockCardSkeleton key={i.symbol} symbol={i.symbol} name={i.name} />
        ))}
      </div>
    </div>
  );
}
