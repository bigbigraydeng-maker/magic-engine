import React from 'react'
import { Composition, type CalculateMetadataFunction } from 'remotion'
import { ListReel } from './ListReel'
import { parseListReelProps } from './schema'
import { computeTimingFromProps, FPS, WIDTH, HEIGHT } from './timing'

const calculateMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseListReelProps(props)
  return { durationInFrames: computeTimingFromProps(parsed).totalFrames }
}

export const Root: React.FC = () => (
  <>
    {/* durationInFrames={1} is only a placeholder; calculateMetadata overrides it. */}
    <Composition id="ListReel" component={ListReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateMetadata} />
  </>
)
