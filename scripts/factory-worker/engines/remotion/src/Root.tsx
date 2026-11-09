import React from 'react'
import { Composition, type CalculateMetadataFunction } from 'remotion'
import { ListReel } from './ListReel'
import { parseListReelProps } from './schema'
import { computeTimingFromProps, FPS, WIDTH, HEIGHT } from './timing'
import { MontageReel } from './MontageReel'
import { parseMontageReelProps, computeMontageTiming } from './montage'
import { DataCardReel } from './DataCardReel'
import { parseDataCardProps, computeDataCardTiming } from './datacard'
import { PostcardReel } from './PostcardReel'
import { parsePostcardProps, computePostcardTiming } from './postcard'
import { AtmosphereReel } from './AtmosphereReel'
import { parseAtmosphereProps, computeAtmosphereTiming } from './atmosphere'
import { canvasForProps, templateProps } from './aspect'
import { FramePreview } from './FramePreview'

function canvasMeta(props: Record<string, unknown>, durationInFrames: number) {
  const canvas = canvasForProps(props)
  return { durationInFrames, width: canvas.width, height: canvas.height }
}

const calculateMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseListReelProps(templateProps(props))
  return canvasMeta(props, computeTimingFromProps(parsed).totalFrames)
}

const calculateMontageMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseMontageReelProps(templateProps(props))
  return canvasMeta(props, computeMontageTiming(parsed).totalFrames)
}

const calculateDataCardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseDataCardProps(templateProps(props))
  return canvasMeta(props, computeDataCardTiming(parsed).totalFrames)
}

const calculatePostcardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parsePostcardProps(templateProps(props))
  return canvasMeta(props, computePostcardTiming(parsed).totalFrames)
}

const calculateAtmosphereMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseAtmosphereProps(templateProps(props))
  return canvasMeta(props, computeAtmosphereTiming(parsed).totalFrames)
}

const calculatePreviewMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const square = props.aspect === '1:1'
  return { width: 1080, height: square ? 1080 : 1920, durationInFrames: 45, fps: FPS }
}

export const Root: React.FC = () => (
  <>
    {/* durationInFrames={1} is only a placeholder; calculateMetadata overrides it. */}
    <Composition id="ListReel" component={ListReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateMetadata} />
    <Composition id="MontageReel" component={MontageReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateMontageMetadata} />
    <Composition id="DataCardReel" component={DataCardReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateDataCardMetadata} />
    <Composition id="PostcardReel" component={PostcardReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculatePostcardMetadata} />
    <Composition id="AtmosphereReel" component={AtmosphereReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateAtmosphereMetadata} />
    <Composition id="FramePreview" component={FramePreview} durationInFrames={45} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculatePreviewMetadata} />
  </>
)
