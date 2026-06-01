/**
 * MetricSparkline — tiny inline SVG line chart.
 *
 * Renders a 56×24px sparkline from an array of nullable values.
 * Null values break the line (gap in data).
 * No external chart library — pure SVG path.
 *
 * Phase 22.B.6
 */

'use client'

interface MetricSparklineProps {
  /** 28 ordered values, newest last. Null = no data for that bucket. */
  data:   Array<number | null>
  /** Color of the line. Defaults to currentColor so parent controls via className. */
  color?: string
  /** If true, fills the area under the line. */
  filled?: boolean
  width?:  number
  height?: number
}

export function MetricSparkline({
  data,
  color   = '#6366f1',
  filled  = false,
  width   = 56,
  height  = 24,
}: MetricSparklineProps) {
  const validValues = data.filter((v): v is number => v !== null)
  if (validValues.length < 2) {
    // Not enough data — render a flat dashed line
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.4}
        />
      </svg>
    )
  }

  const min    = Math.min(...validValues)
  const max    = Math.max(...validValues)
  const range  = max - min || 1   // avoid div-by-zero when all values identical

  const padding  = 2
  const innerW   = width  - padding * 2
  const innerH   = height - padding * 2

  const scaleX = (i: number) => padding + (i / (data.length - 1)) * innerW
  const scaleY = (v: number) => padding + innerH - ((v - min) / range) * innerH

  // Build SVG path segments, splitting on null gaps
  const segments: string[][] = []
  let current: string[] = []

  data.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
    } else {
      const x = scaleX(i)
      const y = scaleY(v)
      current.push(current.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)
    }
  })
  if (current.length > 0) segments.push(current)

  // For the fill, use the last segment's first/last points
  const lastSeg         = segments[segments.length - 1] ?? []
  const firstFillPoint  = lastSeg[0]?.replace('M ', '').replace('L ', '') ?? ''
  const lastFillPoint   = lastSeg[lastSeg.length - 1]?.replace('M ', '').replace('L ', '') ?? ''

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      {filled && segments.length > 0 && (
        <path
          d={`${lastSeg.join(' ')} L ${lastFillPoint.split(' ')[0]} ${height} L ${firstFillPoint.split(' ')[0]} ${height} Z`}
          fill={color}
          opacity={0.08}
        />
      )}
      {segments.map((seg, idx) => (
        <path
          key={idx}
          d={seg.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
