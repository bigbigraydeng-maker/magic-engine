import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { Logo } from '../components'
import type { ListReelProps } from '../schema'
import { silentCard } from './rules'
import { CraftShot } from './stage'
import type { ListCraftTiming } from './template-craft'
import type { ResolvedLook } from './types'

interface Segment {
  src: string
  text: string
}

function listSegments(props: ListReelProps): Segment[] {
  const count = props.items.length
  const hook = props.hook.lines.map((line) => line.text).join(' ')
  const items = props.items.map((item, i) => ({ src: item.clip, text: `${i + 1}/${count} ${item.text}` }))
  const closing = `${props.price.currencyPrefix}${props.price.amount}`
  return [{ src: props.hook.clip, text: hook }, ...items, { src: props.price.backdropClip, text: closing }]
}

/** Checklist whose cuts, type, captions and picture treatment follow the pack. */
export const StyledList: React.FC<{
  props: ListReelProps
  look: ResolvedLook
  family: string
  timing: ListCraftTiming
}> = ({ props, look, family, timing }) => {
  const point = silentCard(look.rules, props.items[0]?.text ?? props.revealTitle).point
  const segments = listSegments(props)
  const shown = timing.cuts === 0 ? [segments[1] ?? segments[0]] : segments
  const fromOf = (index: number) => (timing.cuts === 0 ? 0 : index * timing.shotFrames)
  const dur = timing.cuts === 0 ? timing.totalFrames : timing.shotFrames
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {shown.map((seg, i) => (
        <Sequence key={`${seg.text}-${i}`} from={fromOf(i)} durationInFrames={dur}>
          <CraftShot look={look} family={family} src={seg.src} text={seg.text} point={point} rules={look.rules} />
        </Sequence>
      ))}
      <Sequence from={timing.logoFrom} durationInFrames={Math.max(1, timing.totalFrames - timing.logoFrom)}>
        <Logo file={look.logoFile ?? props.logoFile} />
      </Sequence>
    </AbsoluteFill>
  )
}
