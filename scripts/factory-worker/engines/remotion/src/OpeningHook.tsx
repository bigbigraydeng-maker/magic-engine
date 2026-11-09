import React from 'react'
import { AbsoluteFill, useVideoConfig } from 'remotion'
import { hookRows, hookTypeSize, looksChinese, statTypeSize, type ResolvedHook, type ResolvedHookLine } from './frame.ts'
import { PopIn } from './pop.tsx'
import { safeRectFor, type SafeRect } from './safeZone.ts'
import { fontFamily } from './theme.ts'

function splitEmphasis(text: string): { before: string; hit: string; after: string } {
  const chars = Array.from(text)
  if (looksChinese(text)) {
    const count = chars.length >= 4 ? 2 : Math.max(1, chars.length)
    if (chars.length <= count) return { before: '', hit: text, after: '' }
    return { before: chars.slice(0, -count).join(''), hit: chars.slice(-count).join(''), after: '' }
  }
  const match = text.match(/^(.*\s)(\S+)$/)
  if (!match) return { before: '', hit: text, after: '' }
  return { before: match[1], hit: match[2], after: '' }
}

function Emphasis({ text, color, on }: { text: string; color: string; on: boolean }) {
  if (!on) return <>{text}</>
  const parts = splitEmphasis(text)
  return (
    <>
      {parts.before}
      <span style={{ color }}>{parts.hit}</span>
      {parts.after}
    </>
  )
}

function rowsFrom(lines: ResolvedHookLine[]): ResolvedHookLine[] {
  return hookRows(lines)
}

function Scrim() {
  return (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.08) 16%, rgba(0,0,0,0.58) 46%, rgba(0,0,0,0.42) 74%, rgba(0,0,0,0.2) 100%)',
      }}
    />
  )
}

function stage(safe: SafeRect): React.CSSProperties {
  return {
    position: 'absolute',
    left: safe.left,
    top: safe.top,
    width: safe.width,
    height: safe.height,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    boxSizing: 'border-box',
  }
}

const lineStyle = (size: number): React.CSSProperties => ({
  fontFamily,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 1.02,
  color: '#fff',
  letterSpacing: -0.8,
  textShadow: '0 8px 28px rgba(0,0,0,0.78), 0 2px 0 rgba(0,0,0,0.45)',
  maxWidth: '100%',
})

const KineticHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect; frameWidth: number }> = ({
  hook,
  brandColor,
  safe,
  frameWidth,
}) => {
  const rows = rowsFrom(hook.lines)
  const cjk = rows.some((row) => looksChinese(row.text))
  const longest = rows.reduce((max, row) => Math.max(max, Array.from(row.text).length), 1)
  const size = hookTypeSize(frameWidth, safe.width, longest, cjk)
  const last = rows.length - 1
  return (
    <div style={stage(safe)}>
      {rows.map((row, i) => (
        <PopIn key={`${row.text}-${i}`} delay={i * 7}>
          <div style={lineStyle(size)}>
            {row.badge ? (
              <span style={{ color: '#fff', background: brandColor, borderRadius: 12, padding: '0 14px', marginRight: 14 }}>{row.badge}</span>
            ) : null}
            <Emphasis text={row.text} color={brandColor} on={i === last && !row.badge} />
          </div>
        </PopIn>
      ))}
    </div>
  )
}

const StatHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect; frameWidth: number }> = ({
  hook,
  brandColor,
  safe,
  frameWidth,
}) => {
  const stat = hook.stat ?? hook.lines[0]?.text ?? ''
  const size = statTypeSize(frameWidth, safe.width, stat)
  const longest = hook.lines.reduce((max, line) => Math.max(max, Array.from(line.text).length), 1)
  const cjk = hook.lines.some((line) => looksChinese(line.text))
  const captionSize = hook.lines.length > 0 ? hookTypeSize(frameWidth, safe.width, longest, cjk) : 56
  return (
    <div style={stage(safe)}>
      <PopIn delay={0} travel={88}>
        <div style={{ ...lineStyle(size), color: brandColor, lineHeight: 0.92 }}>{stat}</div>
      </PopIn>
      {hook.lines.map((line, i) => (
        <PopIn key={`${line.text}-${i}`} delay={8 + i * 7}>
          <div style={{ ...lineStyle(captionSize), marginTop: 12 }}>{line.text}</div>
        </PopIn>
      ))}
    </div>
  )
}

const QuestionHook: React.FC<{ hook: ResolvedHook; brandColor: string; safe: SafeRect; frameWidth: number }> = ({
  hook,
  brandColor,
  safe,
  frameWidth,
}) => {
  const source = hook.lines.length > 0 ? hook.lines : [{ text: hook.question ?? '', badge: null }]
  const rows = hookRows(source)
  const cjk = rows.some((row) => looksChinese(row.text))
  const longest = rows.reduce((max, row) => Math.max(max, Array.from(row.text).length), 1)
  const size = hookTypeSize(frameWidth, safe.width, longest, cjk)
  const hit = rows.findIndex((row) => row.text === hook.question)
  const emphasis = hit >= 0 ? hit : rows.length - 1
  return (
    <div style={stage(safe)}>
      {rows.map((row, i) => (
        <PopIn key={`${row.text}-${i}`} delay={i * 7}>
          <div style={lineStyle(size)}>
            <Emphasis text={row.text} color={brandColor} on={i === emphasis && !row.badge} />
          </div>
        </PopIn>
      ))}
    </div>
  )
}

/** Full-width opening hook. Copy sits in the safe zone over a light scrim, not a caption box. */
export const OpeningHook: React.FC<{ hook: ResolvedHook; brandColor: string }> = ({ hook, brandColor }) => {
  const { width, height } = useVideoConfig()
  const safe = safeRectFor(width, height)
  const body =
    hook.style === 'stat' ? (
      <StatHook hook={hook} brandColor={brandColor} safe={safe} frameWidth={width} />
    ) : hook.style === 'question' ? (
      <QuestionHook hook={hook} brandColor={brandColor} safe={safe} frameWidth={width} />
    ) : (
      <KineticHook hook={hook} brandColor={brandColor} safe={safe} frameWidth={width} />
    )
  return (
    <AbsoluteFill>
      <Scrim />
      {body}
    </AbsoluteFill>
  )
}
