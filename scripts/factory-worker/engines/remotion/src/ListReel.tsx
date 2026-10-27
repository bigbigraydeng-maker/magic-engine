import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { CutFlash, Footage, Logo, Reveal } from './components'
import { FrameOverlay } from './FrameOverlay'
import { templateProps } from './aspect'
import { brandColorOf, overlayWindows, resolveFramePlan, type ResolvedHook } from './frame'
import { OpeningHook } from './OpeningHook'
import { PriceScene } from './PriceScene'
import { parseListReelProps, type ListReelProps } from './schema'
import { useStage } from './stage'
import { computeTimingFromProps, FPS } from './timing'
import { fontFamily } from './theme'
import { useStyleFamily } from './styles/fonts'
import { peelStyle } from './styles/select'
import { StyledList } from './styles/StyledList'
import { styledListTiming } from './styles/template-craft'
import type { ResolvedLook } from './styles/types'

const Hook: React.FC<{ props: ListReelProps; shared: ResolvedHook | null }> = ({ props, shared }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const stage = useStage()
  const placed = stage.place({ left: 90, top: 640, width: 870, fontSize: 118, lines: 3, lineHeight: 1.12 })
  const fontSize = stage.fit(118, placed, 118)
  return (
    <AbsoluteFill>
      <Footage src={props.hook.clip} zoomTo={1.1} scrim={props.footageScrim} />
      {shared ? <OpeningHook hook={shared} brandColor={props.brandColor} /> : (
        <div style={{ position: 'absolute', left: placed.left, top: placed.top, width: placed.width, fontFamily, color: '#fff', textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>
          {props.hook.lines.map((line, i) => {
            const p = spring({ frame: frame - i * 9, fps, config: { damping: 9, stiffness: 170, mass: 0.6 } })
            const hl = i === 2
            return (
              <div key={i} style={{ fontSize, fontWeight: 900, lineHeight: 1.12, transform: `scale(${0.55 + 0.45 * p}) rotate(${(1 - p) * -4}deg)`, transformOrigin: '0% 60%', opacity: Math.min(1, p * 2) }}>
                {line.badge !== null ? <span style={{ color: props.brandColor, background: '#fff', padding: '0 16px', borderRadius: 10, marginRight: 18 }}>{line.badge}</span> : null}
                {hl ? <span style={{ color: '#fff', background: props.brandColor, padding: '0 16px', borderRadius: 10 }}>{line.text}</span> : line.text}
              </div>
            )
          })}
        </div>
      )}
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
  const stage = useStage()
  const placed = stage.place({ left: 90, top: 640, width: 870, fontSize: 66, lines: 3, lineHeight: 1.2, blockPx: 160 })
  const bar = stage.place({ left: 90, top: 1170, width: 780, fontSize: 12, lines: 1, lineHeight: 1 })
  const mark = stage.px(150)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${punch})`, filter: props.items[index].blurBackdrop ? 'blur(14px)' : 'none' }}><Footage src={props.items[index].clip} zoomTo={1.08} scrim={props.footageScrim} /></AbsoluteFill>
      {props.itemOverlayOpacity > 0 ? <AbsoluteFill style={{ background: `rgba(0,0,0,${props.itemOverlayOpacity})` }} /> : null}
      <div style={{ position: 'absolute', left: placed.left, top: placed.top, width: placed.width, fontFamily, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,0.85)' }}>
        <div style={{ fontSize: stage.fit(props.itemLabelSize ?? 40, placed, 66), fontWeight: 900, letterSpacing: 4, opacity: 0.95 }}>{props.itemLabel} {index + 1}/{props.items.length}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: stage.px(18) }}>
          <div style={{ width: mark, height: mark, flex: `0 0 ${mark}px`, borderRadius: stage.px(28), background: props.brandColor, color: '#fff', fontSize: stage.px(110), fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * stamp}) rotate(${(1 - stamp) * 18}deg)`, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', textShadow: 'none' }}>✓</div>
          <div style={{ fontSize: stage.fit(66, placed, 66), fontWeight: 900, lineHeight: 1.08, marginLeft: stage.px(28), opacity: Math.min(1, text * 2), transform: `translateX(${(1 - text) * 80}px)` }}>{props.items[index].text}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: bar.left, top: bar.top, width: bar.width, height: stage.px(12), borderRadius: 6, background: 'rgba(255,255,255,0.3)' }}>
        <div style={{ width: `${prog * 100}%`, height: stage.px(12), borderRadius: 6, background: props.brandColor, boxShadow: `0 0 16px ${props.brandColor}` }} />
      </div>
    </AbsoluteFill>
  )
}

const ListReelMain: React.FC<Record<string, unknown>> = (rawProps) => {
  const props = parseListReelProps(templateProps(rawProps))
  const timing = computeTimingFromProps(props)
  const plan = resolveFramePlan('list', props)
  const flash = props.cutFlash !== false
  const frame = useCurrentFrame()
  const stage = useStage()
  const title = stage.place({ left: 90, top: 556, width: 900, fontSize: props.revealTitleSize ?? 60, lines: 1, lineHeight: 1.2 })
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  const endFrames = plan.endCard ? overlayWindows(timing.totalFrames).endFrames : 0
  const logoUntil = timing.totalFrames - endFrames
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.hookFrames}><Hook props={props} shared={plan.hook} /></Sequence>
      {props.items.map((_, i) => (
        <Sequence key={i} from={timing.itemFrom[i]} durationInFrames={timing.itemDur[i]}><Item props={props} index={i} dur={timing.itemDur[i]} />{flash ? <CutFlash /> : null}</Sequence>
      ))}
      <Sequence from={timing.revealFrom} durationInFrames={timing.totalFrames - timing.revealFrom}>
        <PriceScene backdrop={props.price.backdropClip} brandColor={props.brandColor} fromLabel={props.price.fromLabel} currencyPrefix={props.price.currencyPrefix} amount={props.price.amount} qualifier={props.price.qualifier} dateLine={props.price.dateLine} footnote={props.price.footnote} footnoteSize={props.price.footnoteSize ?? 40} fastReveal top={660} scrim={props.footageScrim} layout={props.price.layout} qualifierSize={props.price.qualifierSize} footnoteBackdrop={props.price.footnoteBackdrop} left={90} />
        <div style={{ position: 'absolute', left: title.left, top: title.top, width: title.width, fontFamily, color: '#fff', fontSize: stage.fit(props.revealTitleSize ?? 60, title, props.revealTitleSize ?? 60), fontWeight: 900, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}><Reveal delay={0}><div>{props.revealTitle}</div></Reveal></div>
        {flash ? <CutFlash /> : null}
      </Sequence>
      {logoUntil > timing.logoFrom ? <Sequence from={timing.logoFrom} durationInFrames={logoUntil - timing.logoFrom}><Logo file={props.logoFile} /></Sequence> : null}
      <FrameOverlay totalFrames={timing.totalFrames} hook={null} endCard={plan.endCard} brandColor={brandColorOf(props)} />
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

const ListStyled: React.FC<{ rawProps: Record<string, unknown>; look: ResolvedLook }> = ({ rawProps, look }) => {
  const family = useStyleFamily(look)
  const props = parseListReelProps(templateProps(peelStyle(rawProps).body))
  const timing = styledListTiming(props.items.length, look, FPS, props.logoMode)
  const frame = useCurrentFrame()
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  if (family === null) return null
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <StyledList props={props} look={look} family={family} timing={timing} />
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} /> : null}
    </AbsoluteFill>
  )
}

export const ListReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const look = carriedLook(rawProps)
  if (look) return <ListStyled rawProps={rawProps} look={look} />
  return <ListReelMain rawProps={plainProps(rawProps)} />
}
