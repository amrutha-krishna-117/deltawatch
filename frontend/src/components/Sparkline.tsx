interface Props {
  points: { ts: number; price: number }[];
  checkpointTs?: number | null;
  width?: number;
  height?: number;
  positive: boolean;
  showArea?: boolean;
}

export function Sparkline({ points, checkpointTs, width = 140, height = 40, positive, showArea = true }: Props) {
  if (points.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center">
        <div className="skeleton w-full" style={{ height: 2 }} />
      </div>
    );
  }

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.1 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const range = hi - lo;

  const tMin = points[0].ts;
  const tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;

  const sx = (ts: number) => ((ts - tMin) / tRange) * width;
  const sy = (price: number) => height - ((price - lo) / range) * height;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.ts).toFixed(1)},${sy(p.price).toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const stroke = positive ? '#22c55e' : '#f43f5e';
  const fillId = `spark-fill-${positive ? 'up' : 'dn'}-${Math.random().toString(36).slice(2, 6)}`;

  const cpX = checkpointTs && checkpointTs > tMin && checkpointTs < tMax
    ? sx(checkpointTs)
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      {showArea && (
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {showArea && <path d={areaPath} fill={`url(#${fillId})`} />}
      {cpX !== null && (
        <line
          x1={cpX} x2={cpX} y1={0} y2={height}
          stroke="#475569" strokeDasharray="3,2" strokeWidth={1}
        />
      )}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
