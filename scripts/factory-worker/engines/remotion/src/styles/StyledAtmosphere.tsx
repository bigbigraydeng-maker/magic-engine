import React from 'react'
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from 'remotion'
import { Logo } from '../components'
import { FADE_START_OPACITY, type AtmosphereProps, type AtmosphereTiming } from '../atmosphere'
import { silentCard } from './rules'
import { CraftShot } from './stage'
import { atmosphereCraftOf } from './template-craft'
import type { ResolvedLook } from './types'

/** One continuous shot. Only the caption and the picture treatment follow the pack. */
export const StyledAtmosphere: React.FC<{
  props: AtmosphereProps
  timing: AtmosphereTiming
  look: ResolvedLook
  family: string
  logoFrom: number
}> = ({ props, timing, look, family, logoFrom }) => {
  const frame = useCurrentFrame()
  const line = props.line?.text ?? ''
  const point = line === '' ? '' : silentCard(look.rules, line).point
  const styled = { ...look, craft: atmosphereCraftOf(look.craft) }
  const cover = interpolate(
    frame,
    [0, timing.fadeInFrames, timing.totalFrames - timing.fadeOutFrames, timing.totalFrames],
    [FADE_START_OPACITY, 0, 0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={timing.totalFrames}>
        <CraftShot
          look={styled}
          family={family}
          src={props.clip}
          text={line}
          point={point}
          rules={look.rules}
          startFrom={timing.sourceInFrames}
          beats={false}
        />
      </Sequence>
      <AbsoluteFill style={{ background: '#000', opacity: cover }} />
      <Sequence from={logoFrom} durationInFrames={Math.max(1, timing.totalFrames - logoFrom)}>
        <Logo file={look.logoFile ?? props.logoFile} />
      </Sequence>
    </AbsoluteFill>
  )
}
