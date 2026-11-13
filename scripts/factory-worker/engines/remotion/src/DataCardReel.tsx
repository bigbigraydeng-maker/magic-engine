import React from 'react'
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { computeDataCardTiming, DISCLAIMER_OPACITY, HOOK_SETTLE_FRAMES, SUBLABEL_OPACITY, parseDataCardProps, type DataCardProps } from './datacard'
import { FrameOverlay } from './FrameOverlay'
import { overlayWindows, resolveFramePlan } from './frame'
import { FPS } from './timing'
import { fontFamily } from './theme'
import { templateProps } from './aspect'
import { useStage } from './stage'
import { useStyleFamily } from './styles/fonts'
import { peelStyle } from './styles/select'
import { StyledDataCard } from './styles/StyledDataCard'
import { styledDataCardTiming } from './styles/template-craft'
import type { ResolvedLook } from './styles/types'

const ROW_GAP = 12
const CARD_PAD = 24
const HOOK_MAX_BIG_SCALE = 1.6
// first-frame overshoot of the hook scale
const HOOK_PUNCH = 1.06

/** Re-measure after every render (the frame being drawn can change what is measured); children only mount once fonts are loaded, so the first measurement already uses the real glyph widths. */
function useMeasureAfterFonts(measure: () => void) {
  React.useLayoutEffect(() => {
    measure()
  })
}

/**
 * Hold rendering until every web font weight the card uses is loaded, then mount `children`, let two animation frames pass and mount
 * them again (fresh measurement on settled layout) before releasing the frame. Stage 0 loading, 1 first mount, 2 settled.
 */
const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stage, setStage] = React.useState(0)
  const [handle] = React.useState(() => delayRender('datacard fonts'))
  React.useEffect(() => {
    // fonts.ready alone can resolve before a font has even started loading, so ask for each weight the card uses
    Promise.all(['600', '800', '900'].map((w) => document.fonts.load(`${w} 40px ${fontFamily}`)))
      .then(() => document.fonts.ready)
      .then(() => setStage(1))
      .catch((e: unknown) => cancelRender(e))
  }, [])
  React.useEffect(() => {
    if (stage === 1) requestAnimationFrame(() => requestAnimationFrame(() => setStage(2)))
    if (stage === 2) continueRender(handle)
  }, [stage, handle])
  return stage === 0 ? null : <React.Fragment key={stage}>{children}</React.Fragment>
}

/** Scale (<= 1) that makes the element's measured one-line width fit `avail`; measured after fonts load, so worst-case glyph widths are exact. */
function useFitScale(avail: number) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  useMeasureAfterFonts(() => {
    const el = ref.current
    if (el === null) return
    const natural = el.offsetWidth
    setScale(natural > avail ? avail / natural : 1)
  })
  return { ref, scale }
}

/** One-line text that shrinks (never wraps, never overflows) to fit `avail` px. */
const FitText: React.FC<{ avail: number; origin: 'left' | 'right' | 'center'; text: string; style: React.CSSProperties }> = ({ avail, origin, text, style }) => {
  const { ref, scale } = useFitScale(avail)
  return (
    <div ref={ref} style={{ ...style, display: 'inline-block', whiteSpace: 'nowrap', ...(origin === 'center' ? { position: 'absolute', left: '50%', top: 0, transform: `translateX(-50%) scale(${scale})` } : { transform: `scale(${scale})` }), transformOrigin: `${origin} center` }}>{text}</div>
  )
}

/** Vertical layout: where the compact hook sits and where the rows start. */
function layoutOf(props: DataCardProps, frame: ReturnType<typeof useStage>['dataCard']) {
  const hookLine = Math.round(frame.hookFont * 1.12)
  const hookTop = props.logoFile !== null ? frame.logoTop + frame.logoH + 14 : frame.safeTop + 20
  const blockH = hookLine * props.hook.lines.length
  const rowsTop = hookTop + blockH + 26
  const rowH = Math.min(150, Math.floor((frame.rowsBottom - rowsTop) / props.rows.length))
  return { hookTop, blockH, rowsTop, rowH, hookLine }
}

const Hook: React.FC<{ props: DataCardProps; hookFrames: number }> = ({ props, hookFrames }) => {
  const frame = useCurrentFrame()
  const card = useStage().dataCard
  const { hookTop, blockH, hookLine } = layoutOf(props, card)
  const probe = React.useRef<HTMLDivElement>(null)
  const [natural, setNatural] = React.useState(0)
  useMeasureAfterFonts(() => {
    if (probe.current !== null) setNatural(probe.current.offsetWidth)
  })
  // widest line at the compact font; every scale below is capped so the widest line stays inside the safe width
  const maxScale = natural > 0 ? card.width / natural : 1
  const compact = Math.min(1, maxScale)
  const big = Math.max(compact, Math.min(HOOK_MAX_BIG_SCALE, maxScale / HOOK_PUNCH))
  const settle = interpolate(frame, [hookFrames, hookFrames + HOOK_SETTLE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ease = 1 - Math.pow(1 - settle, 3)
  // frame 0 is already fully visible text; a small punch settles over the first 6 frames
  const punch = 1 + (HOOK_PUNCH - 1) * (1 - Math.min(1, frame / 6))
  const bigScale = Math.min(big * punch, maxScale)
  const centreTop = (card.safeTop + card.safeBottom) / 2 - (blockH * big) / 2
  const scale = bigScale + (compact - bigScale) * ease
  const top = centreTop + (hookTop - centreTop) * ease
  return (
    <>
      <div ref={probe} style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', display: 'inline-block', whiteSpace: 'nowrap', fontFamily, fontSize: card.hookFont, fontWeight: 900 }}>
        {props.hook.lines.map((line, i) => (<div key={i}>{line}</div>))}
      </div>
      <div style={{ position: 'absolute', left: card.left + card.width / 2, top, textAlign: 'center', fontFamily, color: props.textColor, fontSize: card.hookFont, fontWeight: 900, lineHeight: `${hookLine}px`, whiteSpace: 'nowrap', transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'center top' }}>
        {props.hook.lines.map((line, i) => (
          <div key={i} style={{ color: i === props.hook.lines.length - 1 ? props.brandColor : props.textColor, whiteSpace: 'nowrap' }}>{line}</div>
        ))}
      </div>
    </>
  )
}

const Row: React.FC<{ props: DataCardProps; index: number; rowFrames: number }> = ({ props, index, rowFrames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const card = useStage().dataCard
  const { rowH, rowsTop } = layoutOf(props, card)
  const row = props.rows[index]
  const k = Math.min(1, rowH / 130)
  const p = spring({ frame, fps, config: { damping: 14, stiffness: 150, mass: 0.7 } })
  const grow = interpolate(frame, [4, Math.min(rowFrames, 24)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const n = props.rows.length
  const stepOffset = props.barMode === 'steps' ? (index / (n - 1)) * 0.3 : 0
  const barSpan = props.barMode === 'steps' ? 0.7 : 1
  const pad = card.width === 900 ? CARD_PAD : Math.max(12, Math.round(CARD_PAD * card.width / 900))
  const inner = card.width - pad * 2
  const labelAvail = inner * 0.56
  const valueAvail = inner * 0.42
  const barBottom = row.bar !== null ? Math.round(16 * k) : 0
  return (
    <div style={{ position: 'absolute', left: card.left, width: card.width, top: rowsTop + index * rowH, height: rowH - ROW_GAP, fontFamily, color: props.textColor, background: `${props.textColor}14`, borderRadius: 18, opacity: Math.min(1, p * 2), transform: `translateX(${(1 - p) * 120}px)` }}>
      <div style={{ position: 'absolute', left: pad, top: 0, bottom: barBottom, width: labelAvail, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
        <FitText avail={labelAvail} origin="left" text={row.label} style={{ fontSize: Math.round(42 * k), fontWeight: 800, lineHeight: 1.1 }} />
        {row.sublabel !== null ? <FitText avail={labelAvail} origin="left" text={row.sublabel} style={{ fontSize: Math.max(22, Math.round(27 * k)), fontWeight: 600, opacity: SUBLABEL_OPACITY, lineHeight: 1.15 }} /> : null}
      </div>
      <div style={{ position: 'absolute', right: pad, top: 0, bottom: barBottom, width: valueAvail, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <FitText avail={valueAvail} origin="right" text={row.value} style={{ fontSize: Math.round(70 * k), fontWeight: 900, color: props.brandColor }} />
      </div>
      {row.bar !== null ? (
        <div style={{ position: 'absolute', left: pad + inner * stepOffset, bottom: Math.round(10 * k), width: inner * barSpan * row.bar * grow, height: Math.max(6, Math.round(10 * k)), borderRadius: 6, background: props.brandColor }} />
      ) : null}
    </div>
  )
}

const DataCardReelMain: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parseDataCardProps(templateProps(rawProps))
  const timing = computeDataCardTiming(props)
  const plan = resolveFramePlan('datacard', props)
  const windows = overlayWindows(timing.totalFrames)
  const frame = useCurrentFrame()
  const card = useStage().dataCard
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const hideTitle = plan.hook !== null && frame < windows.hookFrames
  return (
    <AbsoluteFill style={{ background: props.bgColor }}>
      <FontGate>
      {props.logoFile !== null ? (
        <Img src={staticFile(props.logoFile)} style={{ position: 'absolute', left: card.left, top: card.logoTop, width: card.width === 900 ? 400 : Math.round(card.width * 0.44), height: card.logoH, objectFit: 'contain', objectPosition: 'left center' }} />
      ) : null}
      {hideTitle ? null : <Hook props={props} hookFrames={timing.hookFrames} />}
      {props.rows.map((_, i) => (
        <Sequence key={i} from={timing.rowFrom[i]} durationInFrames={timing.totalFrames - timing.rowFrom[i]}>
          <Row props={props} index={i} rowFrames={timing.rowFrames} />
        </Sequence>
      ))}
      <div style={{ position: 'absolute', left: card.left, width: card.width, top: card.disclaimerTop, height: 40 }}>
        <FitText avail={card.width} origin="center" text={props.disclaimer} style={{ fontFamily, fontSize: card.width === 900 ? 26 : Math.max(18, Math.round(26 * card.width / 900)), fontWeight: 600, color: props.textColor, opacity: DISCLAIMER_OPACITY }} />
      </div>
      </FontGate>
      <FrameOverlay totalFrames={timing.totalFrames} hook={plan.hook} endCard={plan.endCard} brandColor={props.brandColor} />
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}

function carriedLook(rawProps: Record<string, unknown>): ResolvedLook | null {
  const look = peelStyle(rawProps).look
  return look == null ? null : (look as ResolvedLook)
}

function plainProps(rawProps: Record<string, unknown>): Record<string, unknown> {
  const body = peelStyle(rawProps).body
  return body === rawProps ? rawProps : (body as Record<string, unknown>)
}

const DataCardStyled: React.FC<{ rawProps: Record<string, unknown>; look: ResolvedLook }> = ({ rawProps, look }) => {
  const family = useStyleFamily(look)
  const props = parseDataCardProps(templateProps(peelStyle(rawProps).body))
  const timing = styledDataCardTiming(props.rows, look, FPS)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  if (family === null) return null
  return (
    <AbsoluteFill style={{ background: props.bgColor }}>
      <StyledDataCard props={props} look={look} family={family} timing={timing} />
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}

export const DataCardReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const look = carriedLook(rawProps)
  if (look) return <DataCardStyled rawProps={rawProps} look={look} />
  return <DataCardReelMain rawProps={plainProps(rawProps)} />
}
