import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { Logo } from '../components'
import type { MontageReelProps } from '../montage'
import { silentCard } from './rules'
import { CraftShot } from './stage'
import { styledMontageTiming } from './template-craft'
import type { ResolvedLook } from './types'

/** Many clips and short words, cut with the pack instead of the torn-paper default. */
export const StyledMontage: React.FC<{
  props: MontageReelProps
  look: ResolvedLook
  family: string
}> = ({ props, look, family }) => {
  const plan = styledMontageTiming(props.clips.length, props.words.length, look)
  const point = silentCard(look.rules, props.words[0]?.text ?? '看这里').point
  const shots = plan.cuts === 0 ? 1 : plan.shots
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {Array.from({ length: shots }, (_, i) => {
        const clip = props.clips[i % props.clips.length]
        const word = props.words[i % props.words.length]
        return (
          <Sequence key={i} from={i * plan.shotFrames} durationInFrames={plan.shotFrames}>
            <CraftShot look={look} family={family} src={clip.file} text={word.text} point={point} rules={look.rules} />
          </Sequence>
        )
      })}
      <Sequence from={plan.logoFrom} durationInFrames={Math.max(1, plan.totalFrames - plan.logoFrom)}>
        <Logo file={look.logoFile ?? props.logoFile} />
      </Sequence>
    </AbsoluteFill>
  )
}
