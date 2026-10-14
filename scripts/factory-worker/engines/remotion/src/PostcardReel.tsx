import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Footage, Logo } from './components'
import { PriceScene } from './PriceScene'
import { parsePostcardProps, computePostcardTiming, type PostcardProps } from './postcard'
import { FPS } from './timing'
import { fontFamily } from './theme'

const Hook: React.FC<{ props: PostcardProps }> = ({ props }) => {
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={1.06} scrim={props.scrim ?? 0.35} />
      <div style={{ position: 'absolute', left: 90, top: 640, width: 790, fontFamily, color: '#fff', fontSize: 96, fontWeight: 900, lineHeight: 1.12, textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>
        {props.hook.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

const Scene: React.FC<{ props: PostcardProps; index: number }> = ({ props, index }) => {
  const frame = useCurrentFrame()
  const scene = props.scenes[index]
  const o = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const left = props.cardSide === 'left' ? 60 : 120
  const width = props.cardSide === 'left' ? 900 : 840
  return (
    <AbsoluteFill>
      <Footage src={scene.clip} zoomTo={1.05} scrim={props.scrim ?? 0.35} />
      <div style={{ position: 'absolute', left, top: props.cardTop ?? 800, width, background: `rgba(0,0,0,${props.cardOpacity})`, borderRadius: 24, padding: '28px 36px', fontFamily, opacity: o }}>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: props.accent ?? '#ffffff', marginBottom: 14 }}>{scene.place}</div>
        <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.15, color: '#fff', textShadow: '0 3px 16px rgba(0,0,0,0.6)' }}>{scene.line}</div>
      </div>
    </AbsoluteFill>
  )
}

const EndCard: React.FC<{ backdropClip: string; title: string; scrim: number }> = ({ backdropClip, title, scrim }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill>
      <Footage src={backdropClip} zoomTo={1.05} scrim={scrim} />
      <AbsoluteFill style={{ background: 'rgba(5,10,18,0.35)' }} />
      <div style={{ position: 'absolute', left: 60, top: 760, width: 840, textAlign: 'center', fontFamily, color: '#fff', fontSize: 84, fontWeight: 900, lineHeight: 1.1, textShadow: '0 6px 30px rgba(0,0,0,0.7)', opacity: o }}>
        {title}
      </div>
    </AbsoluteFill>
  )
}

export const PostcardReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parsePostcardProps(rawProps)
  const timing = computePostcardTiming(props)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const logoFrom = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const price = props.price
  const end = props.end
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} /></Sequence>
      {props.scenes.map((_, i) => (
        <Sequence key={i} from={timing.sceneFrom[i]} durationInFrames={timing.sceneDur[i]}><Scene props={props} index={i} /></Sequence>
      ))}
      <Sequence from={timing.priceFrom} durationInFrames={timing.totalFrames - timing.priceFrom}>
        {price !== null ? (
          <PriceScene backdrop={price.backdropClip} brandColor={props.brandColor} fromLabel={price.fromLabel} currencyPrefix={price.currencyPrefix} amount={price.amount} qualifier={price.qualifier} dateLine={price.dateLine} footnote={price.footnote} footnoteSize={price.footnoteSize} top={700} scrim={props.scrim ?? 0.35} />
        ) : end !== null ? (
          <EndCard backdropClip={end.backdropClip} title={end.title} scrim={props.scrim ?? 0.35} />
        ) : null}
      </Sequence>
      <Sequence from={logoFrom} durationInFrames={timing.totalFrames - logoFrom}><Logo file={props.logoFile} /></Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
