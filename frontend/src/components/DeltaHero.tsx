import { useMemo } from 'react';
import { useStore } from '../store';
import { fmtPrice, fmtPct } from '../utils';
import type { AttentionPacket } from '../types';

// The most important section — "what changed since I was last here"
// Displayed as bold scannable cards at the top, sorted by magnitude of move.
// Only shows stocks that have actually moved since checkpoint.

function MovedCard({ p }: { p: AttentionPacket }) {
  const pos = (p.sessionDeltaPct ?? 0) >= 0;
  const color = pos ? '#22c55e' : '#f43f5e';
  const bg = pos ? 'rgba(34,197,94,0.07)' : 'rgba(244,63,94,0.07)';
  const border = pos ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)';

  return (
    <div
      style={{ background: bg, border: `1px solid ${border}` }}
      className="rounded-xl p-4 flex flex-col gap-1 min-w-[140px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-sm tracking-tight" style={{ color: 'var(--text)' }}>
            {p.symbol}
          </div>
          <div className="text-[11px] mt-0.5 leading-tight" style={{ color: 'var(--text-dim)' }}>
            {p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name}
          </div>
        </div>
        <span
          style={{ color, fontSize: 11, fontWeight: 700, background: `${color}18`, borderRadius: 6, padding: '2px 6px' }}
          className="num whitespace-nowrap"
        >
          {fmtPct(p.sessionDeltaPct)}
        </span>
      </div>
      <div className="num font-semibold text-base mt-1" style={{ color: 'var(--text)' }}>
        {fmtPrice(p.price, p.currency)}
      </div>
      {p.reason && p.reason !== 'Trading within its normal range' && (
        <div className="text-[10px] mt-1 leading-snug" style={{ color: 'var(--text-dim)' }}>
          {p.reason}
        </div>
      )}
    </div>
  );
}

export function DeltaHero() {
  const packets = useStore((s) => s.packets);
  const watchlists = useStore((s) => s.watchlists);
  const activeWatchlistId = useStore((s) => s.activeWatchlistId);
  const resetCheckpoint = useStore((s) => s.resetCheckpoint);

  const active = watchlists.find((w) => w.id === activeWatchlistId);
  const allPackets = (active?.items ?? [])
    .map((i) => packets[i.symbol])
    .filter((p): p is AttentionPacket => !!p && p.price > 0);

  const hasCheckpoint = allPackets.some((p) => p.checkpointTs !== null);

  const moved = useMemo(() => {
    return allPackets
      .filter((p) => p.sessionDeltaPct !== null && Math.abs(p.sessionDeltaPct) >= 0.5)
      .sort((a, b) => Math.abs(b.sessionDeltaPct!) - Math.abs(a.sessionDeltaPct!));
  }, [allPackets]);

  const quiet = hasCheckpoint && moved.length === 0 && allPackets.length > 0;

  // No checkpoint yet — show a CTA
  if (!hasCheckpoint) {
    return (
      <div
        style={{ border: '1px solid var(--border)', borderRadius: 16 }}
        className="p-6 flex items-center justify-between"
      >
        <div>
          <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text)' }}>
            Set your baseline
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)', maxWidth: 360 }}>
            Mark your watchlist now. When you return, DeltaWatch will show exactly what moved and by how much — not just current prices, but <em>your delta</em>.
          </p>
        </div>
        <button
          onClick={resetCheckpoint}
          className="ml-6 flex-none px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#818cf8', color: '#fff' }}
          onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#6366f1'; }}
          onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = '#818cf8'; }}
        >
          Mark as reviewed
        </button>
      </div>
    );
  }

  if (quiet) {
    return (
      <div
        style={{ border: '1px solid var(--border)', borderRadius: 16 }}
        className="px-6 py-4 flex items-center gap-3"
      >
        <span className="text-lg">✓</span>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Nothing meaningful changed</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>All stocks are trading within their normal ranges since your last checkpoint.</p>
        </div>
      </div>
    );
  }

  if (moved.length === 0) return null;

  const gainers = moved.filter((p) => (p.sessionDeltaPct ?? 0) > 0);
  const losers  = moved.filter((p) => (p.sessionDeltaPct ?? 0) < 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Since your last checkpoint
            <span className="ml-2 font-normal text-xs" style={{ color: 'var(--text-dim)' }}>
              · {moved.length} stock{moved.length !== 1 ? 's' : ''} moved
            </span>
          </h2>
        </div>
        <button
          onClick={resetCheckpoint}
          className="text-xs px-3 py-1 rounded-lg transition-all"
          style={{ color: '#818cf8', background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)' }}
          onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.2)'; }}
          onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)'; }}
        >
          Reset checkpoint
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {moved.map((p) => <MovedCard key={p.symbol} p={p} />)}
      </div>
      {(gainers.length > 0 && losers.length > 0) && (
        <div className="flex gap-6 mt-3 text-xs" style={{ color: 'var(--text-dim)' }}>
          <span>
            <span style={{ color: '#22c55e' }}>▲</span>{' '}
            {gainers.length} up · avg {fmtPct(gainers.reduce((s,p)=>s+(p.sessionDeltaPct??0),0)/gainers.length)}
          </span>
          <span>
            <span style={{ color: '#f43f5e' }}>▼</span>{' '}
            {losers.length} down · avg {fmtPct(losers.reduce((s,p)=>s+(p.sessionDeltaPct??0),0)/losers.length)}
          </span>
        </div>
      )}
    </div>
  );
}
