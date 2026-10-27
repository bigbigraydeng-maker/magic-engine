import React from 'react'
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Logo } from './components'
import { useStyleFamily } from './styles/fonts'
import { peelStyle } from './styles/select'
import { StyledMontage } from './styles/StyledMontage'
import { styledMontageTiming } from './styles/template-craft'
import type { ResolvedLook } from './styles/types'
import {
  parseMontageReelProps,
  computeMontageTiming,
  buildMontageSegments,
  montageFrameOf,
  rnd,
  type MontageReelProps,
  type MontageSegment,
  type MontageWord,
} from './montage'

const tornClip = 'polygon(0% 6%, 6% 0%, 14% 5%, 24% 0%, 36% 6%, 48% 0%, 60% 5%, 72% 0%, 84% 6%, 94% 0%, 100% 5%, 100% 94%, 95% 100%, 86% 94%, 74% 100%, 62% 95%, 50% 100%, 38% 94%, 26% 100%, 14% 95%, 5% 100%, 0% 93%)'

const Cut: React.FC<{ props: MontageReelProps; seg: MontageSegment }> = ({ props, seg }) => {
  const frame = useCurrentFrame()
  const punch = interpolate(frame, [0, 5], [1.22, 1.04], { extrapolateRight: 'clamp' })
  const sx = frame < 4 ? (rnd(seg.from + frame) - 0.5) * 26 : 0
  const sy = frame < 4 ? (rnd(seg.from + frame + 9) - 0.5) * 26 : 0
  // photosensitivity: flash only on the bar downbeat (every 4 beats); never on every cut
  const flash = seg.down ? interpolate(frame, [0, 3], [0.26, 0], { extrapolateRight: 'clamp' }) : 0
  const clip = props.clips[seg.clip]
  // normalise brightness between clips so cut-to-cut luminance jumps stay small (photosensitivity margin)
  const luma = clip.luma ?? 95
  const bright = Math.max(0.72, Math.min(1.7, 95 / luma))
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px) scale(${punch})`, filter: seg.bw ? `grayscale(1) contrast(1.4) brightness(${(bright * 0.95).toFixed(2)})` : `brightness(${bright.toFixed(2)}) contrast(1.15) saturate(1.2)` }}>
        <OffthreadVideo src={staticFile(clip.file)} startFrom={seg.start} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      {seg.bw ? <AbsoluteFill style={{ background: props.brandColor, mixBlendMode: 'multiply', opacity: 0.55 }} /> : null}
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  )
}

const WordSlam: React.FC<{ word: MontageWord; brandColor: string; family: string; ink: string }> = ({ word, brandColor, family, ink }) => {
  const frame = useCurrentFrame()
  const s = interpolate(frame, [0, 3], [1.7, 1], { extrapolateRight: 'clamp' })
  const sx = frame < 3 ? (rnd(word.at * 7 + frame) - 0.5) * 22 : 0
  const fs = Math.min(190, Math.floor(1000 / word.text.length))
  const col = word.bg === 'black' ? { bg: '#0b0b0b', fg: '#fff' } : word.bg === 'brand' ? { bg: brandColor, fg: ink } : { bg: '#f4f1ea', fg: '#0b0b0b' }
  return (
    <div style={{ position: 'absolute', left: 0, width: 960, top: 700, display: 'flex', justifyContent: 'center' }}>
      <div style={{ fontFamily: family, fontWeight: 900, fontSize: fs, lineHeight: 1.0, color: col.fg, background: col.bg, padding: `${fs * 0.16}px ${fs * 0.28}px`, clipPath: tornClip, transform: `translateX(${sx}px) scale(${s}) rotate(${word.rot}deg)`, boxShadow: 'none', letterSpacing: -1, textAlign: 'center', maxWidth: 900 }}>{word.text}</div>
    </div>
  )
}

const Grain: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ mixBlendMode: 'overlay', opacity: 0.22, pointerEvents: 'none' }}>
      <svg width="1080" height="1920"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 9} /></filter><rect width="1080" height="1920" filter="url(#g)" /></svg>
    </AbsoluteFill>
  )
}

export const MontageReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const peeled = peelStyle(rawProps)
  const look = peeled.look === undefined || peeled.look === null ? null : (peeled.look as ResolvedLook)
  const family = useStyleFamily(look)
  const props = parseMontageReelProps(peeled.body)
  const craftPlan = look ? styledMontageTiming(props.clips.length, props.words.length, look) : null
  const timing = craftPlan ?? computeMontageTiming(props)
  const segments = buildMontageSegments(props)
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [timing.totalFrames - 8, timing.totalFrames], [1, 0], { extrapolateLeft: 'clamp' })
  const vol = interpolate(frame, [0, 6, timing.totalFrames - 24, timing.totalFrames - 2], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (family === null) return null
  if (look) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <StyledMontage props={props} look={look} family={family} />
        <AbsoluteFill style={{ background: '#000', opacity: 1 - fade }} />
        <Audio src={staticFile(props.musicFile)} volume={vol * (props.musicGain ?? 1)} />
      </AbsoluteFill>
    )
  }
  const brand = props.brandColor
  const ink = '#fff'
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {segments.map((seg, i) => (<Sequence key={i} from={seg.from} durationInFrames={seg.dur}><Cut props={props} seg={seg} /></Sequence>))}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }} />
      {props.words.map((w, i) => {
        const from = montageFrameOf(props.beats, w.at)
        return (<Sequence key={i} from={from} durationInFrames={montageFrameOf(props.beats, w.at + w.beats) - from}><WordSlam word={w} brandColor={brand} family={family} ink={ink} /></Sequence>)
      })}
      <Grain />
      <Sequence from={timing.logoFrom} durationInFrames={timing.totalFrames - timing.logoFrom}><Logo file={props.logoFile} /></Sequence>
      <AbsoluteFill style={{ background: '#000', opacity: 1 - fade }} />
      <Audio src={staticFile(props.musicFile)} volume={vol * (props.musicGain ?? 1)} />
    </AbsoluteFill>
  )
}
