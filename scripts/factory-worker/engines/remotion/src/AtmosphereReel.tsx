import React from 'react'
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Logo } from './components'
import { parseAtmosphereProps, computeAtmosphereTiming, FADE_START_OPACITY, type AtmosphereProps, type AtmosphereTiming } from './atmosphere'
import { FPS } from './timing'
import { fontFamily } from './theme'
import { useStyleFamily } from './styles/fonts'
import { peelStyle } from './styles/select'
import { logoStartFrame } from './styles/rules'
import { StyledAtmosphere } from './styles/StyledAtmosphere'
import type { ResolvedLook } from './styles/types'

const AtmosphereFootage: React.FC<{ props: AtmosphereProps; timing: AtmosphereTiming }> = ({ props, timing }) => {
  const frame = useCurrentFrame()
  const push = props.push ?? 1
  const scale = interpolate(frame, [0, timing.totalFrames], [1, push], { extrapolateRight: 'clamp' })
  const crop = props.crop
  const videoStyle: React.CSSProperties = crop === undefined
    ? { width: '100%', height: '100%', objectFit: 'cover' }
    : (() => {
        const width = 1080 / crop.w
        const height = 1920 / crop.h
        return {
          position: 'absolute',
          width,
          height,
          left: -crop.x * width,
          top: -crop.y * height,
          objectFit: 'fill',
        } as React.CSSProperties
      })()
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo src={staticFile(props.clip)} startFrom={timing.sourceInFrames} muted style={videoStyle} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const TextLine: React.FC<{ props: AtmosphereProps; timing: AtmosphereTiming; look: ResolvedLook | null; family: string }> = ({ props, timing, look, family }) => {
  const frame = useCurrentFrame()
  const line = props.line
  if (line === null) return null
  const o = interpolate(frame, [timing.fadeInFrames, timing.fadeInFrames + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const color = look ? look.card.lineColor : '#fff'
  const weight = look ? look.type.weightBody : 700
  return (
    <div style={{ position: 'absolute', left: 60, top: props.textTop ?? 520, width: 900, fontFamily: family, fontSize: look ? look.type.body : 60, fontWeight: weight, color, lineHeight: 1.15, textShadow: '0 4px 22px rgba(0,0,0,0.65)', opacity: o }}>
      {line.text}
    </div>
  )
}

export const AtmosphereReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const peeled = peelStyle(rawProps)
  const look = peeled.look === undefined || peeled.look === null ? null : (peeled.look as ResolvedLook)
  const family = useStyleFamily(look)
  const props = parseAtmosphereProps(peeled.body)
  const timing = computeAtmosphereTiming(props)
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
  const requestedLogo = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const logoFrom = look ? logoStartFrame(requestedLogo, look.rules, FPS) : requestedLogo
  if (family === null) return null
  if (look) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <StyledAtmosphere props={props} timing={timing} look={look} family={family} logoFrom={logoFrom} />
        {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AtmosphereFootage props={props} timing={timing} />
      <TextLine props={props} timing={timing} look={look} family={family} />
      <AbsoluteFill style={{ background: '#000', opacity: cover }} />
      <Sequence from={logoFrom} durationInFrames={timing.totalFrames - logoFrom}><Logo file={props.logoFile} /></Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
