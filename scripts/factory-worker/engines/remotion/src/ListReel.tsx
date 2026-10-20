import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { CutFlash, Footage, Logo, Reveal } from './components'
import { PriceScene } from './PriceScene'
import { parseListReelProps, type ListReelProps } from './schema'
import { computeTimingFromProps, FPS } from './timing'
import { fontFamily } from './theme'

const Hook: React.FC<{ props: ListReelProps }> = ({ props }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={1.1} scrim={props.footageScrim} />
      <div style={{ position: 'absolute', left: 90, top: 640, width: 870, fontFamily, color: '#fff', textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>
        {props.hook.lines.map((line, i) => {
          const p = spring({ frame: frame - i * 9, fps, config: { damping: 9, stiffness: 170, mass: 0.6 } })
          const hl = i === 2
          return (
            <div key={i} style={{ fontSize: 118, fontWeight: 900, lineHeight: 1.12, transform: `scale(${0.55 + 0.45 * p}) rotate(${(1 - p) * -4}deg)`, transformOrigin: '0% 60%', opacity: Math.min(1, p * 2) }}>
              {line.badge !== null ? <span style={{ color: props.brandColor, background: '#fff', padding: '0 16px', borderRadius: 10, marginRight: 18 }}>{line.badge}</span> : null}
              {hl ? <span style={{ color: '#fff', background: props.brandColor, padding: '0 16px', borderRadius: 10 }}>{line.text}</span> : line.text}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const Item: React.FC<{ props: ListReelProps; index: number; dur: number }> = ({ props, index, dur }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const punch = interpolate(frame, [0, 7], [1.22, 1], { extrapolateRight: 'clamp' })
  const stamp = spring({ frame: frame - 2, fps, config: { damping: 8, stiffness: 190, mass: 0.7 } })
  const text = spring({ frame: frame - 6, fps, config: { damping: 14, stiffness: 150, mass: 0.7 } })
  const prog = (index + frame / dur) / props.items.length
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${punch})`, filter: props.items[index].blurBackdrop ? 'blur(14px)' : 'none' }}><Footage src={props.items[index].clip} zoomTo={1.08} scrim={props.footageScrim} /></AbsoluteFill>
      {props.itemOverlayOpacity > 0 ? <AbsoluteFill style={{ background: `rgba(0,0,0,${props.itemOverlayOpacity})` }} /> : null}
      <div style={{ position: 'absolute', left: 90, top: 640, width: 870, fontFamily, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,0.85)' }}>
        <div style={{ fontSize: props.itemLabelSize ?? 40, fontWeight: 900, letterSpacing: 4, opacity: 0.95 }}>{props.itemLabel} {index + 1}/{props.items.length}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
          <div style={{ width: 150, height: 150, flex: '0 0 150px', borderRadius: 28, background: props.brandColor, color: '#fff', fontSize: 110, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * stamp}) rotate(${(1 - stamp) * 18}deg)`, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', textShadow: 'none' }}>✓</div>
          <div style={{ fontSize: 66, fontWeight: 900, lineHeight: 1.08, marginLeft: 28, opacity: Math.min(1, text * 2), transform: `translateX(${(1 - text) * 80}px)` }}>{props.items[index].text}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 90, top: 1170, width: 780, height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.3)' }}>
        <div style={{ width: `${prog * 100}%`, height: 12, borderRadius: 6, background: props.brandColor, boxShadow: `0 0 16px ${props.brandColor}` }} />
      </div>
    </AbsoluteFill>
  )
}

export const ListReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parseListReelProps(rawProps)
  const timing = computeTimingFromProps(props)
  const flash = props.cutFlash !== false
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} /></Sequence>
      {props.items.map((_, i) => (
        <Sequence key={i} from={timing.itemFrom[i]} durationInFrames={timing.itemDur[i]}><Item props={props} index={i} dur={timing.itemDur[i]} />{flash ? <CutFlash /> : null}</Sequence>
      ))}
      <Sequence from={timing.revealFrom} durationInFrames={timing.totalFrames - timing.revealFrom}>
        <PriceScene backdrop={props.price.backdropClip} brandColor={props.brandColor} fromLabel={props.price.fromLabel} currencyPrefix={props.price.currencyPrefix} amount={props.price.amount} qualifier={props.price.qualifier} dateLine={props.price.dateLine} footnote={props.price.footnote} footnoteSize={props.price.footnoteSize} top={700} scrim={props.footageScrim} layout={props.price.layout} qualifierSize={props.price.qualifierSize} footnoteBackdrop={props.price.footnoteBackdrop} />
        <div style={{ position: 'absolute', left: 90, top: 596, width: 900, fontFamily, color: '#fff', fontSize: 60, fontWeight: 900, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}><Reveal delay={0}><div>{props.revealTitle}</div></Reveal></div>
        {flash ? <CutFlash /> : null}
      </Sequence>
      <Sequence from={timing.logoFrom} durationInFrames={timing.totalFrames - timing.logoFrom}><Logo file={props.logoFile} /></Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}
