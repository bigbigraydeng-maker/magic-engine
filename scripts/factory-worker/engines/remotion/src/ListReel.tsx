import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { CutFlash, Footage, Logo, Reveal } from './components'
import { PriceScene } from './PriceScene'
import { parseListReelProps, type ListReelProps } from './schema'
import { computeTimingFromProps, FPS } from './timing'
import { useStyleFamily } from './styles/fonts'
import { listPaint, priceChrome } from './styles/paint-list'
import { peelStyle } from './styles/select'
import { StyledList } from './styles/StyledList'
import { styledListTiming } from './styles/template-craft'
import type { ResolvedLook } from './styles/types'

const Hook: React.FC<{ props: ListReelProps; look: ResolvedLook | null; family: string }> = ({ props, look, family }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const paint = listPaint(look, props.brandColor, family, props.itemLabelSize ?? 40, props.revealTitleSize ?? 60)
  const springConfig = look ? { damping: look.motion.damping, stiffness: look.motion.stiffness, mass: look.motion.mass } : { damping: 9, stiffness: 170, mass: 0.6 }
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={1.1} scrim={props.footageScrim} />
      <div style={paint.hook}>
        {props.hook.lines.map((line, i) => {
          const p = spring({ frame: frame - i * 9, fps, config: springConfig })
          const hl = i === 2
          return (
            <div key={i} style={{ ...paint.line, transform: `scale(${0.55 + 0.45 * p}) rotate(${(1 - p) * -4}deg)`, transformOrigin: '0% 60%', opacity: Math.min(1, p * 2) }}>
              {line.badge !== null ? <span style={paint.badge}>{line.badge}</span> : null}
              {hl ? <span style={paint.highlight}>{line.text}</span> : line.text}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const Item: React.FC<{ props: ListReelProps; index: number; dur: number; look: ResolvedLook | null; family: string }> = ({ props, index, dur, look, family }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const paint = listPaint(look, props.brandColor, family, props.itemLabelSize ?? 40, props.revealTitleSize ?? 60)
  const punch = interpolate(frame, [0, 7], [1.22, 1], { extrapolateRight: 'clamp' })
  const stampCfg = look ? { damping: look.motion.damping, stiffness: look.motion.stiffness, mass: look.motion.mass } : { damping: 8, stiffness: 190, mass: 0.7 }
  const textCfg = look ? { damping: Math.min(20, look.motion.damping + 4), stiffness: look.motion.stiffness, mass: look.motion.mass } : { damping: 14, stiffness: 150, mass: 0.7 }
  const stamp = spring({ frame: frame - 2, fps, config: stampCfg })
  const text = spring({ frame: frame - 6, fps, config: textCfg })
  const prog = (index + frame / dur) / props.items.length
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${punch})`, filter: props.items[index].blurBackdrop ? 'blur(14px)' : 'none' }}><Footage src={props.items[index].clip} zoomTo={1.08} scrim={props.footageScrim} /></AbsoluteFill>
      {props.itemOverlayOpacity > 0 ? <AbsoluteFill style={{ background: `rgba(0,0,0,${props.itemOverlayOpacity})` }} /> : null}
      <div style={paint.block}>
        <div style={paint.label}>{props.itemLabel} {index + 1}/{props.items.length}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
          <div style={{ ...paint.stamp, transform: `scale(${0.4 + 0.6 * stamp}) rotate(${(1 - stamp) * 18}deg)` }}>✓</div>
          <div style={{ ...paint.itemText, opacity: Math.min(1, text * 2), transform: `translateX(${(1 - text) * 80}px)` }}>{props.items[index].text}</div>
        </div>
      </div>
      <div style={paint.track}>
        <div style={{ width: `${prog * 100}%`, height: 12, borderRadius: 6, background: String(paint.track.fill), boxShadow: `0 0 16px ${String(paint.track.fill)}` }} />
      </div>
    </AbsoluteFill>
  )
}

export const ListReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const peeled = peelStyle(rawProps)
  const look = peeled.look === undefined || peeled.look === null ? null : (peeled.look as ResolvedLook)
  const family = useStyleFamily(look)
  const props = parseListReelProps(peeled.body)
  const craftTiming = look ? styledListTiming(props.items.length, look, FPS, props.logoMode) : null
  const timing = craftTiming ?? computeTimingFromProps(props)
  const flash = props.cutFlash !== false
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const revealMotion = look ? { damping: look.motion.damping, stiffness: look.motion.stiffness, mass: look.motion.mass } : undefined
  const paint = family === null ? null : listPaint(look, props.brandColor, family, props.itemLabelSize ?? 40, props.revealTitleSize ?? 60)
  if (family === null || paint === null) return null
  if (look && craftTiming) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <StyledList props={props} look={look} family={family} timing={craftTiming} />
        {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} look={look} family={family} /></Sequence>
      {props.items.map((_, i) => (
        <Sequence key={i} from={timing.itemFrom[i]} durationInFrames={timing.itemDur[i]}>
          <Item props={props} index={i} dur={timing.itemDur[i]} look={look} family={family} />
          {flash ? (look ? <CutFlash peak={look.motion.flashPeak} fadeAt={look.motion.flashFrames} /> : <CutFlash />) : null}
        </Sequence>
      ))}
      <Sequence from={timing.revealFrom} durationInFrames={timing.totalFrames - timing.revealFrom}>
        <PriceScene backdrop={props.price.backdropClip} brandColor={props.brandColor} fromLabel={props.price.fromLabel} currencyPrefix={props.price.currencyPrefix} amount={props.price.amount} qualifier={props.price.qualifier} dateLine={props.price.dateLine} footnote={props.price.footnote} footnoteSize={props.price.footnoteSize ?? 40} fastReveal top={660} scrim={props.footageScrim} layout={props.price.layout} qualifierSize={props.price.qualifierSize} footnoteBackdrop={props.price.footnoteBackdrop} left={90} chrome={look ? priceChrome(look, family) : undefined} />
        <div style={paint.reveal}><Reveal delay={0} motion={revealMotion}><div>{props.revealTitle}</div></Reveal></div>
        {flash ? (look ? <CutFlash peak={look.motion.flashPeak} fadeAt={look.motion.flashFrames} /> : <CutFlash />) : null}
      </Sequence>
      <Sequence from={timing.logoFrom} durationInFrames={timing.totalFrames - timing.logoFrom}><Logo file={look?.logoFile ?? props.logoFile} /></Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
