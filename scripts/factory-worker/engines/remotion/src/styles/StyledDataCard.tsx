import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import type { DataCardProps } from '../datacard'
import { flashOpacity, motionTransition, picturePose, transitionPose, usesFlash } from './craft'
import { CraftText } from './stage'
import type { DataCraftTiming } from './template-craft'
import type { ResolvedLook } from './types'

const LEFT = 60
const BOARD_TOP = 430

function latestValue(rows: DataCardProps['rows'], timing: DataCraftTiming, frame: number): string {
  let value = rows[0]?.value ?? ''
  timing.rowFrom.forEach((from, i) => {
    if (frame >= from) value = rows[i]?.value ?? value
  })
  return value
}

const RowFlash: React.FC = () => {
  const frame = useCurrentFrame()
  return <AbsoluteFill style={{ background: '#fff', opacity: flashOpacity(frame) * 0.4, pointerEvents: 'none' }} />
}

const NumberRow: React.FC<{
  row: DataCardProps['rows'][number]
  index: number
  look: ResolvedLook
  family: string
  rowFrames: number
}> = ({ row, index, look, family, rowFrames }) => {
  const frame = useCurrentFrame()
  const enter = transitionPose(frame, motionTransition(look.craft))
  return (
    <div style={{ position: 'absolute', left: LEFT, width: look.craft.picture === 'split' ? 520 : 900, top: BOARD_TOP + index * 108, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 100, transform: `translate(${enter.x}px, ${enter.y}px) scale(${enter.scale})`, opacity: enter.opacity }}>
      <div style={{ fontFamily: family, fontSize: 32, fontWeight: 700, color: look.colors.onSurface, maxWidth: 420 }}>{row.label}</div>
      <CraftText look={look} family={family} text={row.value} frame={frame} reveal={Math.max(8, rowFrames)} fontScale={1} />
    </div>
  )
}

const HookPlate: React.FC<{ props: DataCardProps; look: ResolvedLook; family: string }> = ({ props, look, family }) => {
  const frame = useCurrentFrame()
  const text = props.hook.lines.join(' ')
  const kind = look.craft.caption
  const shared: React.CSSProperties = { position: 'absolute', left: LEFT, width: 840, fontFamily: family, boxSizing: 'border-box', padding: '12px 18px' }
  const plate = kind === 'sticker'
    ? { ...shared, top: 280, background: look.card.fill, borderRadius: 36, transform: 'rotate(-2deg)', border: `4px solid ${look.colors.brand}` }
    : kind === 'center-card'
      ? { ...shared, top: 290, left: 140, width: 760, background: look.card.fill, borderRadius: look.shape.radiusCard, textAlign: 'center' as const }
      : kind === 'lower-third'
        ? { ...shared, top: 1120, background: look.card.fill, borderTop: `6px solid ${look.colors.brand}` }
        : { ...shared, top: 1140, background: 'transparent' }
  const line = kind === 'lower-third' || kind === 'stroke-bottom' ? props.disclaimer : text
  return (
    <div style={plate}>
      <CraftText look={look} family={family} text={line} frame={frame} reveal={Math.max(8, 24)} fontScale={1} />
    </div>
  )
}

/** Numbers stay the subject. Rhythm, type motion, caption chrome and picture treatment follow the pack. */
export const StyledDataCard: React.FC<{
  props: DataCardProps
  look: ResolvedLook
  family: string
  timing: DataCraftTiming
}> = ({ props, look, family, timing }) => {
  const frame = useCurrentFrame()
  const pose = picturePose(frame, look.craft.picture)
  const hero = latestValue(props.rows, timing, frame)
  const split = look.craft.picture === 'split'
  return (
    <AbsoluteFill style={{ background: look.colors.surface, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})` }}>
        {props.rows.map((row, i) => (
          <Sequence key={`${row.value}-${i}`} from={timing.rowFrom[i]} durationInFrames={Math.max(1, timing.totalFrames - timing.rowFrom[i])}>
            <NumberRow row={row} index={i} look={look} family={family} rowFrames={timing.rowFrames} />
            {usesFlash(look.craft) ? <RowFlash /> : null}
          </Sequence>
        ))}
        {split ? <Hero value={hero} look={look} family={family} /> : null}
        {look.craft.picture === 'pip' ? <Pip value={hero} look={look} family={family} /> : null}
        {look.craft.picture === 'grain' ? <AbsoluteFill style={{ opacity: 0.28, mixBlendMode: 'overlay', backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.2) 0 1px, transparent 1px 3px)' }} /> : null}
      </AbsoluteFill>
      <HookPlate props={props} look={look} family={family} />
    </AbsoluteFill>
  )
}

const Hero: React.FC<{ value: string; look: ResolvedLook; family: string }> = ({ value, look, family }) => (
  <div style={{ position: 'absolute', left: 640, top: 560, width: 380, fontFamily: family, fontSize: 92, fontWeight: 900, color: look.colors.brand, lineHeight: 1 }}>{value}</div>
)

const Pip: React.FC<{ value: string; look: ResolvedLook; family: string }> = ({ value, look, family }) => (
  <div style={{ position: 'absolute', left: 70, top: 290, width: 280, height: 160, border: `4px solid ${look.colors.brand}`, background: look.card.fill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: family, fontSize: 64, fontWeight: 900, color: look.colors.brand }}>{value}</div>
)
