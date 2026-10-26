import React from 'react'
import { useVideoConfig } from 'remotion'
import type { ResolvedHook } from './frame.ts'
import { PopIn } from './pop.tsx'
import { safeRectFor, type SafeRect } from './safeZone.ts'
import { fontFamily } from './theme.ts'

function headlineSize(safeWidth: number, lines: string[], cap: number): number {
  const longest = lines.reduce((max, line) => Math.max(max, Array.from(line).length), 1)
  const cjk = lines.some((line) => /[\u3400-\u9fff]/.test(line))
  const unit = cjk ? 1 : 0.58
  const fit = Math.floor((safeWidth - 64) / Math.max(1, longest * unit))
  return Math.max(52, Math.min(cap, fit))
}

function plate(safe: SafeRect): React.CSSProperties {
  return {
    position: 'absolute',
    left: safe.left,
    top: safe.top + 12,
    width: safe.width,
    boxSizing: 'border-box',
    padding: '26px 32px 22px',
    borderRadius: 28,
    background: 'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 100%)',
  }
}

const KineticHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect }> = ({ hook, brandColor, safe }) => {
  const size = headlineSize(safe.width, hook.lines.map((line) => line.text), 80)
  return (
    <div style={plate(safe)}>
      {hook.lines.map((line, i) => (
        <PopIn key={`${line.text}-${i}`} delay={i * 6}>
          <div style={{ fontFamily, fontWeight: 900, fontSize: size, lineHeight: 1.08, color: '#fff', letterSpacing: -0.4, textShadow: '0 4px 18px rgba(0,0,0,0.55)' }}>
            {line.badge ? (
              <span style={{ color: '#fff', background: brandColor, borderRadius: 10, padding: '0 12px', marginRight: 12 }}>{line.badge}</span>
            ) : null}
            {line.text}
          </div>
        </PopIn>
      ))}
      <PopIn delay={hook.lines.length * 6}>
        <div style={{ marginTop: 14, height: 8, width: 120, borderRadius: 8, background: brandColor }} />
      </PopIn>
    </div>
  )
}

const StatHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect }> = ({ hook, brandColor, safe }) => {
  const stat = hook.stat ?? hook.lines[0]?.text ?? ''
  const size = headlineSize(safe.width, [stat], 128)
  const captionSize = Math.max(36, Math.round(size * 0.34))
  return (
    <div style={plate(safe)}>
      <PopIn delay={0}>
        <div style={{ fontFamily, fontWeight: 900, fontSize: size, lineHeight: 0.95, color: brandColor, textShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>{stat}</div>
      </PopIn>
      {hook.lines.map((line, i) => (
        <PopIn key={`${line.text}-${i}`} delay={8 + i * 6}>
          <div style={{ fontFamily, fontWeight: 800, fontSize: captionSize, color: '#fff', lineHeight: 1.15, marginTop: 8 }}>{line.text}</div>
        </PopIn>
      ))}
    </div>
  )
}

const QuestionHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect }> = ({ hook, brandColor, safe }) => {
  const text = hook.question ?? hook.lines[0]?.text ?? ''
  const size = headlineSize(safe.width, [text], 64)
  return (
    <div style={{ ...plate(safe), borderLeft: `10px solid ${brandColor}`, paddingLeft: 28 }}>
      <PopIn delay={0}>
        <div style={{ fontFamily, fontWeight: 900, fontSize: Math.round(size * 0.72), color: brandColor, lineHeight: 1 }}>?</div>
      </PopIn>
      <PopIn delay={5}>
        <div style={{ fontFamily, fontWeight: 800, fontSize: size, color: '#fff', lineHeight: 1.2, marginTop: 8, textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{text}</div>
      </PopIn>
    </div>
  )
}

/** Opening hook parked in the platform safe zone. Readable on the first frame. */
export const OpeningHook: React.FC<{ hook: ResolvedHook; brandColor: string }> = ({ hook, brandColor }) => {
  const { width, height } = useVideoConfig()
  const safe = safeRectFor(width, height)
  if (hook.style === 'stat') return <StatHook hook={hook} brandColor={brandColor} safe={safe} />
  if (hook.style === 'question') return <QuestionHook hook={hook} brandColor={brandColor} safe={safe} />
  return <KineticHook hook={hook} brandColor={brandColor} safe={safe} />
}
