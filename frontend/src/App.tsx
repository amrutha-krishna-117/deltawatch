import { useEffect } from 'react';
import { useStore } from './store';
import { useMarketSocket } from './useMarketSocket';
import { OverviewBar } from './components/OverviewBar';
import { DeltaHero } from './components/DeltaHero';
import { WatchlistGrid } from './components/WatchlistGrid';
import { AddSymbol } from './components/AddSymbol';

export default function App() {
  const loadWatchlists = useStore((s) => s.loadWatchlists);
  const loadStatus = useStore((s) => s.loadStatus);
  const fetchLiveOnce = useStore((s) => s.fetchLiveOnce);
  const activeWatchlistId = useStore((s) => s.activeWatchlistId);

  useEffect(() => {
    loadStatus();
    loadWatchlists();
  }, [loadStatus, loadWatchlists]);

  useEffect(() => {
    if (activeWatchlistId) fetchLiveOnce();
  }, [activeWatchlistId, fetchLiveOnce]);

  useMarketSocket();

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      {/* ── Top nav ── */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-none"
            style={{ background: 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8">
              <path d="M2 12 L5 7 L8 9 L11 4 L14 6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="14" cy="6" r="1.2" fill="white" stroke="none" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight leading-none" style={{ color: 'var(--text)' }}>
              DeltaWatch
            </h1>
            <p className="text-[10px] mt-0.5 leading-none" style={{ color: 'var(--text-dim)' }}>
              What changed since you last looked
            </p>
          </div>
        </div>
        <AddSymbol />
      </header>

      {/* ── Status bar ── */}
      <OverviewBar />

      {/* ── Main content ── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">

        {/* Delta hero — the most important section */}
        <DeltaHero />

        {/* Full watchlist */}
        <WatchlistGrid />

      </main>

      {/* ── Footer ── */}
      <footer className="px-6 py-6 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-[11px] leading-relaxed" style={{ color: '#1e2d4a' }}>
          Attention score = volatility-adjusted delta (z-score vs symbol's own recent moves) + volume confirmation.
          Checkpoint state is server-side — persists across browser sessions and restarts.
          {' '}Set <code>MARKET_DATA_PROVIDER=yahoo</code> in <code>backend/.env</code> for real Yahoo Finance data.
        </p>
      </footer>
    </div>
  );
}
