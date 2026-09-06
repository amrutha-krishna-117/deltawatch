import { useMemo } from 'react';
import { useStore } from '../store';
import { fmtRelativeTime } from '../utils';

export function OverviewBar() {
  const packets = useStore((s) => s.packets);
  const watchlists = useStore((s) => s.watchlists);
  const activeWatchlistId = useStore((s) => s.activeWatchlistId);
  const resetCheckpoint = useStore((s) => s.resetCheckpoint);
  const connStatus = useStore((s) => s.connStatus);
  const dataSource = useStore((s) => s.dataSource);

  const active = watchlists.find((w) => w.id === activeWatchlistId);
  const allPackets = Object.values(packets);
  const total = active?.items.length ?? 0;
  const loaded = allPackets.filter((p) => p.price > 0).length;

  const needAttention = useMemo(
    () => allPackets.filter((p) => p.attentionBand === 'High' || p.attentionBand === 'Medium').length,
    [allPackets]
  );

  const lastCheckpointTs = useMemo(() => {
    const cps = allPackets.map((p) => p.checkpointTs).filter((t): t is number => t !== null);
    return cps.length ? Math.max(...cps) : null;
  }, [allPackets]);

  const connDot = connStatus === 'live'
    ? 'bg-emerald-400 animate-pulse'
    : connStatus === 'connecting'
    ? 'bg-amber-400'
    : 'bg-rose-400';

  return (
    <div
      style={{ borderBottom: '1px solid var(--border)' }}
      className="flex items-center justify-between px-6 py-2.5 text-xs"
    >
      {/* Left: connection + data source */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${connDot}`} />
          <span style={{ color: 'var(--text-dim)' }}>
            {connStatus === 'live' ? 'Live' : connStatus === 'connecting' ? 'Connecting…' : 'Reconnecting'}
          </span>
        </div>
        <span
          style={{
            background: dataSource === 'yahoo' ? 'rgba(99,102,241,0.15)' : 'rgba(71,85,105,0.3)',
            color: dataSource === 'yahoo' ? '#818cf8' : '#64748b',
            border: `1px solid ${dataSource === 'yahoo' ? 'rgba(99,102,241,0.3)' : 'rgba(71,85,105,0.4)'}`,
          }}
          className="px-2 py-0.5 rounded-full font-medium"
        >
          {dataSource === 'yahoo' ? 'Yahoo Finance' : 'Simulated feed'}
        </span>
      </div>

      {/* Centre: stats */}
      <div className="flex items-center gap-6">
        <Stat label="Stocks" value={`${loaded}/${total}`} />
        {needAttention > 0 && (
          <Stat label="Need attention" value={String(needAttention)} accent="#f43f5e" />
        )}
        {lastCheckpointTs && (
          <Stat label="Last checked" value={fmtRelativeTime(lastCheckpointTs)} />
        )}
      </div>

      {/* Right: checkpoint button */}
      <button
        onClick={resetCheckpoint}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
        style={{
          background: 'rgba(129,140,248,0.1)',
          color: '#818cf8',
          border: '1px solid rgba(129,140,248,0.2)',
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.2)';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)';
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 2" />
        </svg>
        Mark as reviewed
      </button>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: accent ?? 'var(--text)', fontWeight: 600 }} className="num">
        {value}
      </span>
    </div>
  );
}
