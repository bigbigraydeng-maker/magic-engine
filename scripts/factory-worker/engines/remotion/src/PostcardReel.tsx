import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Footage, Logo } from './components'
import { PriceScene } from './PriceScene'
import { parsePostcardProps, computePostcardTiming, type PostcardProps } from './postcard'
import { FPS } from './timing'
import { useStyleFamily } from './styles/fonts'
import { postcardPaint } from './styles/paint-postcard'
import { StyledPostcard } from './styles/StyledPostcard'
import { priceChrome } from './styles/paint-list'
import { peelStyle } from './styles/select'
import type { ResolvedLook } from './styles/types'

const Hook: React.FC<{ props: PostcardProps; look: ResolvedLook | null; family: string }> = ({ props, look, family }) => {
  const paint = postcardPaint(look, props, family)
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={1.06} scrim={props.scrim ?? 0.35} />
      <div style={paint.hook}>
        {props.hook.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

const Scene: React.FC<{ props: PostcardProps; index: number; look: ResolvedLook | null; family: string }> = ({ props, index, look, family }) => {
  const frame = useCurrentFrame()
  const scene = props.scenes[index]
  const o = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const paint = postcardPaint(look, props, family)
  return (
    <AbsoluteFill>
      <Footage src={scene.clip} zoomTo={1.05} scrim={props.scrim ?? 0.35} />
      <div style={{ ...paint.scene, opacity: o }}>
        <div style={paint.place}>{scene.place}</div>
        <div style={paint.line}>{scene.line}</div>
      </div>
    </AbsoluteFill>
  )
}

const EndCard: React.FC<{ backdropClip: string; title: string; scrim: number; look: ResolvedLook | null; family: string; cardOpacity: number; cardSide: 'left' | 'center' }> = ({ backdropClip, title, scrim, look, family, cardOpacity, cardSide }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const paint = postcardPaint(look, { cardOpacity, cardSide }, family)
  return (
    <AbsoluteFill>
      <Footage src={backdropClip} zoomTo={1.05} scrim={scrim} />
      <AbsoluteFill style={{ background: paint.endScrim }} />
      <div style={{ ...paint.end, opacity: o }}>{title}</div>
    </AbsoluteFill>
  )
}

export const PostcardReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const peeled = peelStyle(rawProps)
  const look = peeled.look === undefined || peeled.look === null ? null : (peeled.look as ResolvedLook)
  const family = useStyleFamily(look)
  const props = parsePostcardProps(peeled.body)
  const timing = computePostcardTiming(props)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const logoFrom = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const price = props.price
  const end = props.end
  const logoFile = look?.logoFile ?? props.logoFile
  if (family === null) return null
  if (look) return <StyledPostcard props={props} look={look} family={family} />
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} look={look} family={family} /></Sequence>
      {props.scenes.map((_, i) => (
        <Sequence key={i} from={timing.sceneFrom[i]} durationInFrames={timing.sceneDur[i]}><Scene props={props} index={i} look={look} family={family} /></Sequence>
      ))}
      <Sequence from={timing.priceFrom} durationInFrames={timing.totalFrames - timing.priceFrom}>
        {price !== null ? (
          <PriceScene backdrop={price.backdropClip} brandColor={props.brandColor} fromLabel={price.fromLabel} currencyPrefix={price.currencyPrefix} amount={price.amount} qualifier={price.qualifier} dateLine={price.dateLine} footnote={price.footnote} footnoteSize={price.footnoteSize} top={700} scrim={props.scrim ?? 0.35} chrome={look ? priceChrome(look, family) : undefined} />
        ) : end !== null ? (
          <EndCard backdropClip={end.backdropClip} title={end.title} scrim={props.scrim ?? 0.35} look={look} family={family} cardOpacity={props.cardOpacity} cardSide={props.cardSide} />
        ) : null}
      </Sequence>
      <Sequence from={logoFrom} durationInFrames={timing.totalFrames - logoFrom}><Logo file={logoFile} /></Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
