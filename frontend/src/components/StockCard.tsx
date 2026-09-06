import { fmtPrice, fmtPct, fmtRelativeTime } from '../utils';
import { Sparkline } from './Sparkline';
import { AttentionBadge } from './AttentionBadge';
import type { AttentionPacket } from '../types';

interface Props {
  p: AttentionPacket;
  onRemove: (symbol: string) => void;
}

function MarketStatePill({ state }: { state: AttentionPacket['marketState'] }) {
  if (!state || state === 'REGULAR' || state === 'UNKNOWN') return null;
  const labels: Record<string, { text: string; color: string }> = {
    PRE:    { text: 'Pre-market',  color: '#f59e0b' },
    POST:   { text: 'After-hours', color: '#f59e0b' },
    CLOSED: { text: 'Closed',      color: '#64748b' },
  };
  const l = labels[state];
  if (!l) return null;
  return (
    <span
      style={{ color: l.color, background: `${l.color}18`, border: `1px solid ${l.color}30` }}
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
    >
      {l.text}
    </span>
  );
}

export function StockCard({ p, onRemove }: Props) {
  const hasDelta = p.sessionDeltaPct !== null;
  const pos = (p.sessionDeltaPct ?? 0) >= 0;
  const deltaColor = !hasDelta ? 'var(--text-dim)' : pos ? '#22c55e' : '#f43f5e';

  const loading = p.price === 0;

  return (
    <div
      className="stock-card rounded-2xl p-4 group relative"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Remove button — appears on hover */}
      <button
        onClick={() => onRemove(p.symbol)}
        aria-label={`Remove ${p.symbol}`}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1"
        style={{ color: 'var(--text-dim)' }}
        onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.color = '#f43f5e'; }}
        onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>

      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Symbol + name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base tracking-tight" style={{ color: 'var(--text)' }}>
              {p.symbol}
            </span>
            <MarketStatePill state={p.marketState} />
          </div>
          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-dim)' }}>
            {p.name}
          </div>
        </div>

        {/* Attention badge */}
        {!loading && <AttentionBadge band={p.attentionBand} score={p.attentionScore} />}
      </div>

      {/* Price row */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          {loading ? (
            <div className="skeleton w-24 h-6 mt-1" />
          ) : (
            <div className="num font-semibold text-xl" style={{ color: 'var(--text)' }}>
              {fmtPrice(p.price, p.currency)}
            </div>
          )}
          {/* Delta since checkpoint */}
          <div className="flex items-center gap-2 mt-1">
            {loading ? (
              <div className="skeleton w-16 h-4" />
            ) : hasDelta ? (
              <>
                <span
                  className="num text-sm font-semibold"
                  style={{ color: deltaColor }}
                >
                  {fmtPct(p.sessionDeltaPct)}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  since checkpoint
                </span>
              </>
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                No checkpoint yet
              </span>
            )}
          </div>
        </div>

        {/* Sparkline */}
        <div className="flex-none">
          {loading ? (
            <div className="skeleton" style={{ width: 100, height: 36, borderRadius: 4 }} />
          ) : (
            <Sparkline
              points={p.sparkline}
              checkpointTs={p.checkpointTs}
              positive={pos}
              width={100}
              height={36}
            />
          )}
        </div>
      </div>

      {/* Why / reason row */}
      {!loading && (
        <div
          className="mt-3 pt-3 text-[11px] leading-relaxed"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-dim)' }}
        >
          {p.error ? (
            <span style={{ color: '#f87171' }}>{p.error}</span>
          ) : (
            <>
              <span style={{ color: 'var(--text-dim)' }}>Why: </span>
              <span style={{ color: p.attentionBand === 'Low' ? 'var(--text-dim)' : 'var(--text)' }}>
                {p.reason}
              </span>
            </>
          )}
          <span className="ml-2" style={{ color: '#334155' }}>
            · {fmtRelativeTime(p.ts)}
          </span>
        </div>
      )}
    </div>
  );
}

// Skeleton placeholder while backend data loads
export function StockCardSkeleton({ symbol, name }: { symbol: string; name: string }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="font-bold text-base" style={{ color: 'var(--text)' }}>{symbol}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>{name}</div>
        </div>
        <div className="skeleton w-20 h-5" />
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="skeleton w-28 h-7" />
          <div className="skeleton w-16 h-4 mt-2" />
        </div>
        <div className="skeleton" style={{ width: 100, height: 36, borderRadius: 4 }} />
      </div>
      <div className="mt-3 pt-3 skeleton h-4" style={{ borderTop: '1px solid var(--border)' }} />
    </div>
  );
}
