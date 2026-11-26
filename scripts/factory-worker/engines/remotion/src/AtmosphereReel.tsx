import React from 'react'
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Logo } from './components'
import { FrameOverlay } from './FrameOverlay'
import { brandColorOf, overlayWindows, resolveFramePlan } from './frame'
import { parseAtmosphereProps, computeAtmosphereTiming, FADE_START_OPACITY, type AtmosphereProps, type AtmosphereTiming } from './atmosphere'
import { FPS } from './timing'
import { fontFamily } from './theme'
import { aspectFromCanvas, coverRect, portraitCoverBox, subjectAnchorY, templateProps } from './aspect'
import { useStage } from './stage'
import { useStyleFamily } from './styles/fonts'
import { logoStartFrame } from './styles/rules'
import { peelStyle } from './styles/select'
import { StyledAtmosphere } from './styles/StyledAtmosphere'
import type { ResolvedLook } from './styles/types'

function atmosphereVideoStyle(props: AtmosphereProps, width: number, height: number): React.CSSProperties {
  const crop = props.crop
  if (crop === undefined) {
    if (aspectFromCanvas(width, height) === '9:16') return { width: '100%', height: '100%', objectFit: 'cover' }
    return portraitCoverBox(width, height)
  }
  const frame = coverRect(9, 16, width, height, subjectAnchorY(width, height))
  const videoW = frame.width / crop.w
  const videoH = frame.height / crop.h
  return {
    position: 'absolute',
    width: videoW,
    height: videoH,
    left: frame.left - crop.x * videoW,
    top: frame.top - crop.y * videoH,
    objectFit: 'fill',
  }
}

const AtmosphereFootage: React.FC<{ props: AtmosphereProps; timing: AtmosphereTiming }> = ({ props, timing }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const push = props.push ?? 1
  const scale = interpolate(frame, [0, timing.totalFrames], [1, push], { extrapolateRight: 'clamp' })
  const videoStyle = atmosphereVideoStyle(props, width, height)
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo src={staticFile(props.clip)} startFrom={timing.sourceInFrames} muted style={videoStyle} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const TextLine: React.FC<{ props: AtmosphereProps; timing: AtmosphereTiming }> = ({ props, timing }) => {
  const frame = useCurrentFrame()
  const stage = useStage()
  const line = props.line
  if (line === null) return null
  const o = interpolate(frame, [timing.fadeInFrames, timing.fadeInFrames + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const placed = stage.place({ left: 60, top: props.textTop ?? 520, width: 900, fontSize: 60, lines: 2, lineHeight: 1.15 })
  return (
    <div style={{ position: 'absolute', left: placed.left, top: placed.top, width: placed.width, fontFamily, fontSize: stage.fit(60, placed, 60), fontWeight: 700, color: '#fff', lineHeight: 1.15, textShadow: '0 4px 22px rgba(0,0,0,0.65)', opacity: o }}>
      {line.text}
    </div>
  )
}

const AtmosphereReelMain: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parseAtmosphereProps(templateProps(rawProps))
  const timing = computeAtmosphereTiming(props)
  const plan = resolveFramePlan('atmosphere', props)
  const windows = overlayWindows(timing.totalFrames)
  const frame = useCurrentFrame()
  const cover = interpolate(
    frame,
    [0, timing.fadeInFrames, timing.totalFrames - timing.fadeOutFrames, timing.totalFrames],
    [FADE_START_OPACITY, 0, 0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const vol = interpolate(
    frame,
    [0, timing.fadeInFrames, timing.totalFrames - timing.fadeOutFrames, timing.totalFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const logoFrom = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const logoUntil = plan.endCard ? windows.endFrom : timing.totalFrames
  const hideLine = plan.hook !== null && frame < windows.hookFrames
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AtmosphereFootage props={props} timing={timing} />
      {hideLine ? null : <TextLine props={props} timing={timing} />}
      <AbsoluteFill style={{ background: '#000', opacity: cover }} />
      {logoUntil > logoFrom ? <Sequence from={logoFrom} durationInFrames={logoUntil - logoFrom}><Logo file={props.logoFile} /></Sequence> : null}
      <FrameOverlay totalFrames={timing.totalFrames} hook={plan.hook} endCard={plan.endCard} brandColor={brandColorOf(props)} />
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

const AtmosphereStyled: React.FC<{ rawProps: Record<string, unknown>; look: ResolvedLook }> = ({ rawProps, look }) => {
  const family = useStyleFamily(look)
  const props = parseAtmosphereProps(templateProps(peelStyle(rawProps).body))
  const timing = computeAtmosphereTiming(props)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, timing.fadeInFrames, timing.totalFrames - timing.fadeOutFrames, timing.totalFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const requestedLogo = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  if (family === null) return null
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <StyledAtmosphere props={props} timing={timing} look={look} family={family} logoFrom={logoStartFrame(requestedLogo, look.rules, FPS)} />
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}

export const AtmosphereReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const look = carriedLook(rawProps)
  if (look) return <AtmosphereStyled rawProps={rawProps} look={look} />
  return <AtmosphereReelMain rawProps={plainProps(rawProps)} />
}
