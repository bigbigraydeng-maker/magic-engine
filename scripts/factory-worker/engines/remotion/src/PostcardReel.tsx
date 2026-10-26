import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { BrandEndCard } from './BrandEndCard'
import { Footage, Logo } from './components'
import {
  brandColorOf,
  estimatePostcardCardHeight,
  overlayWindows,
  postcardCardTop,
  resolveEndCard,
  resolveFramePlan,
  resolveHook,
  workOrderLooksChinese,
} from './frame'
import { OpeningHook } from './OpeningHook'
import { PriceScene } from './PriceScene'
import { parsePostcardProps, computePostcardTiming, type PostcardProps } from './postcard'
import { safeRectFor } from './safeZone'
import { FPS } from './timing'
import { fontFamily } from './theme'

const LegacyHookText: React.FC<{ lines: string[] }> = ({ lines }) => {
  return (
    <div style={{ position: 'absolute', left: 90, top: 640, width: 790, fontFamily, color: '#fff', fontSize: 96, fontWeight: 900, lineHeight: 1.12, textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}

const Hook: React.FC<{ props: PostcardProps; animated: boolean }> = ({ props, animated }) => {
  const hookSpec = props.frame?.hook
  const spec = hookSpec && typeof hookSpec === 'object' ? hookSpec : undefined
  const hook = animated
    ? resolveHook({ lines: props.hook.lines, spec, chinese: workOrderLooksChinese(props) })
    : null
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={animated ? 1.12 : 1.06} scrim={props.scrim ?? 0.35} />
      {hook ? <OpeningHook hook={hook} brandColor={props.brandColor} /> : <LegacyHookText lines={props.hook.lines} />}
    </AbsoluteFill>
  )
}

const Scene: React.FC<{ props: PostcardProps; index: number; logoVisible: boolean }> = ({ props, index, logoVisible }) => {
  const frame = useCurrentFrame()
  const scene = props.scenes[index]
  const o = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rise = interpolate(frame, [6, 22], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const safe = safeRectFor(1080, 1920)
  const left = props.cardSide === 'left' ? 60 : 120
  const width = Math.min(props.cardSide === 'left' ? 900 : 840, safe.right - left)
  const top = postcardCardTop({
    sceneIndex: index,
    cardHeight: estimatePostcardCardHeight(scene.line),
    cardTop: props.cardTop,
    cardZone: props.cardZone,
    logoVisible,
  })
  return (
    <AbsoluteFill>
      <Footage src={scene.clip} zoomTo={1.05} scrim={props.scrim ?? 0.35} />
      <div style={{ position: 'absolute', left, top, width, background: `rgba(0,0,0,${props.cardOpacity})`, borderRadius: 24, padding: '28px 36px', fontFamily, opacity: o, transform: `translateY(${rise}px)` }}>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: props.accent ?? '#ffffff', marginBottom: 14 }}>{scene.place}</div>
        <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.15, color: '#fff', textShadow: '0 3px 16px rgba(0,0,0,0.6)' }}>{scene.line}</div>
      </div>
    </AbsoluteFill>
  )
}

const LegacyEndCard: React.FC<{ backdropClip: string; title: string; scrim: number }> = ({ backdropClip, title, scrim }) => {
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

const BrandedEnd: React.FC<{ props: PostcardProps; backdropClip: string; title: string }> = ({ props, backdropClip, title }) => {
  const endSpec = props.frame?.endCard
  const spec = endSpec && typeof endSpec === 'object' ? endSpec : undefined
  const card = resolveEndCard({ spec, title, logoFile: props.logoFile, chinese: workOrderLooksChinese(props) })
  return (
    <AbsoluteFill>
      <Footage src={backdropClip} zoomTo={1.04} scrim={props.scrim ?? 0.35} />
      <BrandEndCard card={card} brandColor={props.brandColor} />
    </AbsoluteFill>
  )
}

export const PostcardReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parsePostcardProps(rawProps)
  const timing = computePostcardTiming(props)
  const plan = resolveFramePlan('postcard', props)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const logoFrom = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const price = props.price
  const end = props.end
  const replaceEnd = plan.endCard !== null && end !== null && price === null
  const overlayEnd = plan.endCard !== null && !replaceEnd
  const windows = overlayWindows(timing.totalFrames)
  const logoStart = plan.hook ? Math.max(logoFrom, timing.hookFrames) : logoFrom
  const logoEnd = replaceEnd ? timing.priceFrom : overlayEnd ? windows.endFrom : timing.totalFrames
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} animated={plan.hook !== null} /></Sequence>
      {props.scenes.map((_, i) => {
        const sceneFrom = timing.sceneFrom[i] ?? 0
        const sceneDur = timing.sceneDur[i] ?? 0
        const logoVisible = logoStart < sceneFrom + sceneDur && logoEnd > sceneFrom
        return (
          <Sequence key={i} from={sceneFrom} durationInFrames={sceneDur}>
            <Scene props={props} index={i} logoVisible={logoVisible} />
          </Sequence>
        )
      })}
      <Sequence from={timing.priceFrom} durationInFrames={timing.totalFrames - timing.priceFrom}>
        {price !== null ? (
          <PriceScene backdrop={price.backdropClip} brandColor={props.brandColor} fromLabel={price.fromLabel} currencyPrefix={price.currencyPrefix} amount={price.amount} qualifier={price.qualifier} dateLine={price.dateLine} footnote={price.footnote} footnoteSize={price.footnoteSize} top={700} scrim={props.scrim ?? 0.35} />
        ) : end !== null ? (
          replaceEnd ? <BrandedEnd props={props} backdropClip={end.backdropClip} title={end.title} /> : <LegacyEndCard backdropClip={end.backdropClip} title={end.title} scrim={props.scrim ?? 0.35} />
        ) : null}
      </Sequence>
      {logoEnd > logoStart ? <Sequence from={logoStart} durationInFrames={logoEnd - logoStart}><Logo file={props.logoFile} /></Sequence> : null}
      {overlayEnd && plan.endCard && windows.endFrames > 0 ? (
        <Sequence from={windows.endFrom} durationInFrames={windows.endFrames}>
          <BrandEndCard card={plan.endCard} brandColor={brandColorOf(props)} solid />
        </Sequence>
      ) : null}
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
