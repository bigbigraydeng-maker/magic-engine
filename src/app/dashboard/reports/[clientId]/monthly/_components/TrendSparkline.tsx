'use client';

import type { TrendPoint } from '@/lib/reports/monthly-aggregator';

interface Props {
  data: TrendPoint[];
  /** Width of the SVG canvas (default 320) */
  width?: number;
  /** Height of the SVG canvas (default 100) */
  height?: number;
}

/**
 * Pure SVG sparkline showing avg_rank trend over 4 weeks.
 * Note: lower rank = better, so we invert the Y axis so improvements
 * appear as an upward line (more intuitive for the client).
 */
export function TrendSparkline({ data, width = 320, height = 100 }: Props) {
  const padX = 28;
  const padY = 12;
  const chartW = width  - padX * 2;
  const chartH = height - padY * 2;

  // Filter points with actual rank data
  const validPoints = data.filter(d => d.avg_rank != null);

  if (validPoints.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs text-me-charcoal/45"
        style={{ width, height }}
      >
        Not enough data
      </div>
    );
  }

  const ranks = validPoints.map(d => d.avg_rank as number);
  const maxR = Math.max(...ranks);
  const minR = Math.min(...ranks);
  const rangeR = maxR - minR || 1;

  // Map rank to Y: lower rank → higher on chart (inverted)
  const toX = (i: number) =>
    padX + (i / (validPoints.length - 1)) * chartW;

  const toY = (rank: number) =>
    padY + ((rank - minR) / rangeR) * chartH;  // lower rank → lower Y value (top of chart)

  // Build SVG path
  const pathD = validPoints
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.avg_rank as number).toFixed(1)}`)
    .join(' ');

  // Area fill path (close at bottom)
  const areaD =
    pathD +
    ` L ${toX(validPoints.length - 1).toFixed(1)} ${(padY + chartH).toFixed(1)}` +
    ` L ${toX(0).toFixed(1)} ${(padY + chartH).toFixed(1)} Z`;

  // Trend direction
  const first = validPoints[0].avg_rank as number;
  const last  = validPoints[validPoints.length - 1].avg_rank as number;
  const improved = last < first;
  const lineColor = improved ? '#5C8A4A' : last > first ? '#C4912E' : '#C4912E';

  return (
    <svg width={width} height={height} role="img" aria-label="4-week rank trend">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Y-axis labels (min/max rank) */}
      <text x={padX - 4} y={padY + 4}         fontSize={9} fill="rgba(26,26,26,0.45)" textAnchor="end">{minR.toFixed(1)}</text>
      <text x={padX - 4} y={padY + chartH + 4} fontSize={9} fill="rgba(26,26,26,0.45)" textAnchor="end">{maxR.toFixed(1)}</text>

      {/* Area fill */}
      <path d={areaD} fill="url(#sparkGrad)" />

      {/* Line */}
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {validPoints.map((d, i) => (
        <circle
          key={i}
          cx={toX(i)}
          cy={toY(d.avg_rank as number)}
          r={3}
          fill="#fff"
          stroke={lineColor}
          strokeWidth={1.5}
        />
      ))}

      {/* X-axis week labels */}
      {validPoints.map((d, i) => (
        <text
          key={i}
          x={toX(i)}
          y={height - 1}
          fontSize={8}
          fill="rgba(26,26,26,0.45)"
          textAnchor="middle"
        >
          {d.week_of.slice(5)}  {/* MM-DD */}
        </text>
      ))}
    </svg>
  );
}
