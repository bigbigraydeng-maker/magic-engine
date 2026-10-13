import React from 'react'
import { AbsoluteFill, Audio, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { computeDataCardTiming, DISCLAIMER_OPACITY, HOOK_SETTLE_FRAMES, SUBLABEL_OPACITY, parseDataCardProps, type DataCardProps } from './datacard'
import { FPS } from './timing'
import { fontFamily, SAFE_BOTTOM, SAFE_RIGHT, SAFE_TOP } from './theme'

const LEFT = 60
const WIDTH = SAFE_RIGHT - LEFT
const LOGO_TOP = SAFE_TOP + 10
const LOGO_H = 70
const ROWS_BOTTOM = 1160
const DISCLAIMER_TOP = 1190
const CHAR_W = 0.78
// widest glyph (capital W at weight 900) per em; used so validated worst-case text still fits one line
const WIDE_CHAR_W = 0.95
// first-frame overshoot of the hook scale
const HOOK_PUNCH = 1.06
const ROW_GAP = 12
const CARD_PAD = 24

/** Largest font size (px) at which `chars` worst-case-width characters fit in `width`. */
function fitFont(width: number, chars: number) {
  return Math.floor(width / (Math.max(1, chars) * WIDE_CHAR_W))
}

/** Compact (settled) hook font size and the scale that blows it up to centre stage. */
function hookMetrics(props: DataCardProps) {
  const longest = Math.max(...props.hook.lines.map((l) => l.length))
  const font = Math.min(96, Math.floor((WIDTH - 60) / (longest * WIDE_CHAR_W)))
  // widest-glyph width at the first-frame punch must stay inside the safe width
  const bigScale = Math.min(1.6, WIDTH / (longest * WIDE_CHAR_W * font * HOOK_PUNCH))
  const lineH = Math.round(font * 1.12)
  return { font, bigScale, blockH: lineH * props.hook.lines.length, lineH }
}

/** Vertical layout: where the compact hook sits and where the rows start. */
function layoutOf(props: DataCardProps) {
  const hook = hookMetrics(props)
  const hookTop = props.logoFile !== null ? LOGO_TOP + LOGO_H + 14 : SAFE_TOP + 20
  const rowsTop = hookTop + hook.blockH + 26
  const rowH = Math.min(150, Math.floor((ROWS_BOTTOM - rowsTop) / props.rows.length))
  return { hook, hookTop, rowsTop, rowH }
}

const Hook: React.FC<{ props: DataCardProps; hookFrames: number }> = ({ props, hookFrames }) => {
  const frame = useCurrentFrame()
  const { hook, hookTop } = layoutOf(props)
  const settle = interpolate(frame, [hookFrames, hookFrames + HOOK_SETTLE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ease = 1 - Math.pow(1 - settle, 3)
  // frame 0 is already fully visible text; a small punch settles over the first 6 frames
  const punch = 1 + (HOOK_PUNCH - 1) * (1 - Math.min(1, frame / 6))
  const bigScale = hook.bigScale * punch
  const centreTop = (SAFE_TOP + SAFE_BOTTOM) / 2 - (hook.blockH * hook.bigScale) / 2
  const scale = bigScale + (1 - bigScale) * ease
  const top = centreTop + (hookTop - centreTop) * ease
  return (
    <div style={{ position: 'absolute', left: LEFT, width: WIDTH, top, textAlign: 'center', fontFamily, color: props.textColor, fontSize: hook.font, fontWeight: 900, lineHeight: `${hook.lineH}px`, transform: `scale(${scale})`, transformOrigin: 'center top' }}>
      {props.hook.lines.map((line, i) => (
        <div key={i} style={{ color: i === props.hook.lines.length - 1 ? props.brandColor : props.textColor, whiteSpace: 'nowrap' }}>{line}</div>
      ))}
    </div>
  )
}

const Row: React.FC<{ props: DataCardProps; index: number; rowFrames: number }> = ({ props, index, rowFrames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { rowH } = layoutOf(props)
  const row = props.rows[index]
  const k = Math.min(1, rowH / 130)
  const p = spring({ frame, fps, config: { damping: 14, stiffness: 150, mass: 0.7 } })
  const grow = interpolate(frame, [4, Math.min(rowFrames, 24)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const n = props.rows.length
  const stepOffset = props.barMode === 'steps' ? (index / (n - 1)) * 0.3 : 0
  const barSpan = props.barMode === 'steps' ? 0.7 : 1
  const inner = WIDTH - CARD_PAD * 2
  // value gets the width the label column leaves free; shrink the font so long values never overlap the label
  const valueFont = Math.min(Math.round(70 * k), Math.floor((inner * 0.42) / (Math.max(1, row.value.length) * CHAR_W)))
  return (
    <div style={{ position: 'absolute', left: LEFT, width: WIDTH, top: layoutOf(props).rowsTop + index * rowH, height: rowH - ROW_GAP, fontFamily, color: props.textColor, background: `${props.textColor}14`, borderRadius: 18, opacity: Math.min(1, p * 2), transform: `translateX(${(1 - p) * 120}px)` }}>
      <div style={{ position: 'absolute', left: CARD_PAD, top: 0, bottom: row.bar !== null ? Math.round(16 * k) : 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: inner * 0.56 }}>
        <div style={{ fontSize: Math.min(Math.round(42 * k), fitFont(inner * 0.56, row.label.length)), fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{row.label}</div>
        {row.sublabel !== null ? <div style={{ whiteSpace: 'nowrap', fontSize: Math.min(Math.max(22, Math.round(27 * k)), fitFont(inner * 0.56, row.sublabel.length)), fontWeight: 600, opacity: SUBLABEL_OPACITY, lineHeight: 1.15 }}>{row.sublabel}</div> : null}
      </div>
      <div style={{ position: 'absolute', right: CARD_PAD, top: 0, bottom: row.bar !== null ? Math.round(16 * k) : 0, display: 'flex', alignItems: 'center', fontSize: valueFont, fontWeight: 900, color: props.brandColor, whiteSpace: 'nowrap' }}>{row.value}</div>
      {row.bar !== null ? (
        <div style={{ position: 'absolute', left: CARD_PAD + inner * stepOffset, bottom: Math.round(10 * k), width: inner * barSpan * row.bar * grow, height: Math.max(6, Math.round(10 * k)), borderRadius: 6, background: props.brandColor }} />
      ) : null}
    </div>
  )
}

export const DataCardReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parseDataCardProps(rawProps)
  const timing = computeDataCardTiming(props)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: props.bgColor }}>
      {props.logoFile !== null ? (
        <Img src={staticFile(props.logoFile)} style={{ position: 'absolute', left: LEFT, top: LOGO_TOP, width: 400, height: LOGO_H, objectFit: 'contain', objectPosition: 'left center' }} />
      ) : null}
      <Hook props={props} hookFrames={timing.hookFrames} />
      {props.rows.map((_, i) => (
        <Sequence key={i} from={timing.rowFrom[i]} durationInFrames={timing.totalFrames - timing.rowFrom[i]}>
          <Row props={props} index={i} rowFrames={timing.rowFrames} />
        </Sequence>
      ))}
      <div style={{ position: 'absolute', left: LEFT, width: WIDTH, top: DISCLAIMER_TOP, textAlign: 'center', fontFamily, fontSize: Math.min(26, fitFont(WIDTH, props.disclaimer.length)), fontWeight: 600, color: props.textColor, opacity: DISCLAIMER_OPACITY, whiteSpace: 'nowrap' }}>{props.disclaimer}</div>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
