import type { AttentionBand } from '../types';

const cfg: Record<AttentionBand, { bg: string; text: string; dot: string; label: string }> = {
  High:   { bg: 'rgba(244,63,94,0.12)',  text: '#f87171', dot: '#f43f5e', label: 'HIGH'   },
  Medium: { bg: 'rgba(251,191,36,0.12)', text: '#fbbf24', dot: '#f59e0b', label: 'MEDIUM' },
  Low:    { bg: 'rgba(129,140,248,0.10)',text: '#818cf8', dot: '#6366f1', label: 'LOW'    },
};

export function AttentionBadge({ band, score }: { band: AttentionBand; score: number }) {
  const c = cfg[band];
  return (
    <span
      style={{ background: c.bg, color: c.text }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide"
    >
      <span
        style={{ background: c.dot }}
        className={`w-1.5 h-1.5 rounded-full flex-none ${band === 'High' ? 'animate-pulse' : ''}`}
      />
      {c.label} · {score}
    </span>
  );
}
