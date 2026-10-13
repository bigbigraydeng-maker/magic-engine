import React from 'react'
import { Composition, type CalculateMetadataFunction } from 'remotion'
import { ListReel } from './ListReel'
import { parseListReelProps } from './schema'
import { computeTimingFromProps, FPS, WIDTH, HEIGHT } from './timing'
import { MontageReel } from './MontageReel'
import { parseMontageReelProps, computeMontageTiming } from './montage'
import { DataCardReel } from './DataCardReel'
import { parseDataCardProps, computeDataCardTiming } from './datacard'

const calculateMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseListReelProps(props)
  return { durationInFrames: computeTimingFromProps(parsed).totalFrames }
}

const calculateMontageMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseMontageReelProps(props)
  return { durationInFrames: computeMontageTiming(parsed).totalFrames }
}

const calculateDataCardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseDataCardProps(props)
  return { durationInFrames: computeDataCardTiming(parsed).totalFrames }
}

export const Root: React.FC = () => (
  <>
    {/* durationInFrames={1} is only a placeholder; calculateMetadata overrides it. */}
    <Composition id="ListReel" component={ListReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateMetadata} />
    <Composition id="MontageReel" component={MontageReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateMontageMetadata} />
    <Composition id="DataCardReel" component={DataCardReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateDataCardMetadata} />
  </>
)
