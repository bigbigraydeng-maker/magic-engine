/**
 * ME brand logo mark — server-safe, no client hooks.
 * Drop <MeMarkDefs/> once in layout.tsx, then use <MeMark/> anywhere.
 */

export function MeMarkDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="meGrad" x1="20" y1="20" x2="180" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EBCB8B" />
          <stop offset="0.55" stopColor="#C4912E" />
          <stop offset="1" stopColor="#A6781F" />
        </linearGradient>
        <radialGradient id="meNode" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0"    stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#FBEFD2" />
          <stop offset="1"    stopColor="#EBCB8B" />
        </radialGradient>
        <radialGradient id="meGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#EBCB8B" stopOpacity="0.55" />
          <stop offset="1" stopColor="#EBCB8B" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}

const STREAMS = [
  'M22,38 C70,50 110,78 150,92',
  'M22,62 C72,68 112,84 150,92',
  'M22,86 C76,90 112,90 150,92',
  'M22,110 C76,102 112,98 150,92',
  'M22,134 C70,122 112,104 150,92',
]
const DOTS = [38, 62, 86, 110, 134]

export function MeMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 180" fill="none" className={className} aria-hidden="true">
      <g stroke="url(#meGrad)" fill="none" strokeLinecap="round" strokeWidth="7">
        {STREAMS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <g fill="url(#meGrad)">
        {DOTS.map(cy => <circle key={cy} cx="22" cy={cy} r="6" />)}
      </g>
      <rect x="150" y="76" width="32" height="32" rx="9" fill="url(#meNode)" />
    </svg>
  )
}
