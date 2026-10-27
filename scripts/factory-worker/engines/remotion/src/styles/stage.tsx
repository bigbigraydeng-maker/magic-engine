import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import {
  beatEvery,
  captionBox,
  flashOpacity,
  motionTransition,
  picturePose,
  shownChars,
  transitionPose,
  usesFlash,
  type Craft,
} from './craft.ts'
import { measureHook, type ViralRules } from './rules.ts'
import type { ResolvedLook } from './types.ts'

/** One styled shot: picture treatment, transition, caption and text motion. */
export const CraftShot: React.FC<{
  look: ResolvedLook
  family: string
  src: string
  text: string
  point: string
  rules: ViralRules
  startFrom?: number
  beats?: boolean
}> = ({ look, family, src, text, point, rules, startFrom = 0, beats = true }) => {
  const frame = useCurrentFrame()
  const fit = measureHook(text, rules)
  const showWords = text !== '' || point !== ''
  const beatOn = beats && frame % beatEvery(look.craft) < 4
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <PicturePlate craft={look.craft} src={src} startFrom={startFrom} />
      {showWords ? <CaptionPlate look={look} family={family} text={fit.text} point={point} fontScale={fit.fontScale} frame={frame} /> : null}
      {beatOn ? <BeatTick color={look.colors.brand} /> : null}
    </AbsoluteFill>
  )
}

const PicturePlate: React.FC<{ craft: Craft; src: string; startFrom: number }> = ({ craft, src, startFrom }) => {
  const frame = useCurrentFrame()
  const pose = picturePose(frame, craft.picture)
  const enter = transitionPose(frame, motionTransition(craft))
  const clip = `inset(0 ${Math.round(enter.wipe * 100)}% 0 0)`
  return (
    <AbsoluteFill style={{ transform: `translate(${enter.x}px, ${enter.y}px) scale(${enter.scale})`, opacity: enter.opacity, clipPath: clip }}>
      <AbsoluteFill style={{ transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})` }}>
        {craft.picture === 'split' ? <Split src={src} startFrom={startFrom} /> : <Cover src={src} startFrom={startFrom} />}
        {craft.picture === 'pip' ? <Pip src={src} startFrom={startFrom} /> : null}
      </AbsoluteFill>
      {craft.picture === 'grain' ? <Grain /> : null}
      {usesFlash(craft) ? <AbsoluteFill style={{ background: '#fff', opacity: flashOpacity(frame) }} /> : null}
    </AbsoluteFill>
  )
}

const Cover: React.FC<{ src: string; startFrom: number }> = ({ src, startFrom }) => (
  <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
)

const Split: React.FC<{ src: string; startFrom: number }> = ({ src, startFrom }) => (
  <AbsoluteFill style={{ display: 'flex' }}>
    <div style={{ width: '50%', height: '100%', overflow: 'hidden' }}><Cover src={src} startFrom={startFrom} /></div>
    <div style={{ width: '50%', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: '200%', height: '100%', marginLeft: '-100%' }}><Cover src={src} startFrom={startFrom} /></div>
    </div>
  </AbsoluteFill>
)

const Pip: React.FC<{ src: string; startFrom: number }> = ({ src, startFrom }) => (
  <div style={{ position: 'absolute', left: 70, top: 290, width: 360, height: 520, overflow: 'hidden', border: '4px solid #fff' }}>
    <div style={{ width: '180%', height: '140%', marginLeft: '-40%', marginTop: '-20%' }}><Cover src={src} startFrom={startFrom} /></div>
  </div>
)

const Grain: React.FC = () => (
  <AbsoluteFill style={{ opacity: 0.38, mixBlendMode: 'overlay', backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 4px)' }} />
)

const BeatTick: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ position: 'absolute', left: 60, top: 270, width: 120, height: 10, background: color }} />
)

const CaptionPlate: React.FC<{
  look: ResolvedLook
  family: string
  text: string
  point: string
  fontScale: number
  frame: number
}> = ({ look, family, text, point, fontScale, frame }) => {
  const box = captionBox(look.craft.caption, look.safe)
  const reveal = Math.max(8, Math.round(look.craft.shotSec * 30 * 0.7))
  return (
    <div style={plateStyle(look, box)}>
      <CraftText look={look} family={family} text={text} frame={frame} reveal={reveal} fontScale={fontScale} />
      <div style={{ marginTop: 10, fontFamily: family, fontSize: 36, fontWeight: 700, color: look.card.placeColor }}>{point}</div>
    </div>
  )
}

function plateStyle(look: ResolvedLook, box: { left: number; top: number; width: number; height: number }): React.CSSProperties {
  const shared: React.CSSProperties = {
    position: 'absolute',
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    boxSizing: 'border-box',
    padding: '16px 22px',
    overflow: 'hidden',
  }
  if (look.craft.caption === 'stroke-bottom') return { ...shared, background: 'transparent' }
  if (look.craft.caption === 'sticker') {
    return { ...shared, background: look.card.fill, borderRadius: 48, transform: 'rotate(-2deg)', border: `4px solid ${look.colors.brand}` }
  }
  if (look.craft.caption === 'center-card') {
    return { ...shared, background: look.card.fill, borderRadius: look.shape.radiusCard, display: 'flex', flexDirection: 'column', justifyContent: 'center' }
  }
  return { ...shared, background: look.card.fill, borderRadius: 0, borderTop: `6px solid ${look.colors.brand}` }
}

export const CraftText: React.FC<{
  look: ResolvedLook
  family: string
  text: string
  frame: number
  reveal: number
  fontScale: number
}> = ({ look, family, text, frame, reveal, fontScale }) => {
  const size = Math.min(84, Math.round(look.type.hook * fontScale))
  const base: React.CSSProperties = { fontFamily: family, fontSize: size, fontWeight: look.type.weightHook, color: look.card.lineColor, lineHeight: 1.12 }
  if (look.craft.textMotion === 'typewriter') return <div style={base}>{shownChars(text, frame, reveal)}</div>
  if (look.craft.textMotion === 'highlight') return <Highlight text={text} frame={frame} style={base} brand={look.colors.brand} ink={look.colors.textOnBrand} />
  if (look.craft.textMotion === 'stroke') return <StrokeLine text={text} frame={frame} reveal={reveal} style={base} brand={look.colors.brand} />
  if (look.craft.textMotion === 'slide-line') {
    const t = Math.min(1, frame / 12)
    return <div style={{ ...base, transform: `translateX(${Math.round((1 - t) * 80)}px)` }}>{text}</div>
  }
  const t = Math.min(1, frame / 10)
  return <div style={{ ...base, transform: `scale(${0.62 + 0.38 * t})`, transformOrigin: '0% 60%' }}>{text}</div>
}

const Highlight: React.FC<{ text: string; frame: number; style: React.CSSProperties; brand: string; ink: string }> = ({ text, frame, style, brand, ink }) => {
  const chars = Array.from(text)
  const on = chars.length === 0 ? 0 : Math.min(chars.length - 1, Math.floor(frame / 4))
  return (
    <div style={style}>
      {chars.map((ch, i) => (
        <span key={`${ch}-${i}`} style={i === on ? { background: brand, color: ink } : undefined}>{ch}</span>
      ))}
    </div>
  )
}

const StrokeLine: React.FC<{ text: string; frame: number; reveal: number; style: React.CSSProperties; brand: string }> = ({ text, frame, reveal, style, brand }) => {
  const t = Math.min(1, frame / Math.max(1, reveal))
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ ...style, WebkitTextStroke: `3px ${brand}`, color: 'transparent' }}>{text}</div>
      <div style={{ ...style, position: 'absolute', left: 0, top: 0, clipPath: `inset(0 ${Math.round((1 - t) * 100)}% 0 0)` }}>{text}</div>
    </div>
  )
}
