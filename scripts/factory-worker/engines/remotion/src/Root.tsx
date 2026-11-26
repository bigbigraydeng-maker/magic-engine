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
import { CompareReel } from './CompareReel'
import { parseCompareProps, computeCompareTiming } from './compare'
import { canvasForProps, templateProps } from './aspect'
import { FramePreview } from './FramePreview'
import { effectiveShotSec, studyPlan } from './styles/craft'
import { StyleStudy } from './styles/StyleStudy'
import { styledPostcardTiming } from './styles/rules'
import { peelStyle } from './styles/select'
import { styledDataCardTiming, styledListTiming, styledMontageTiming } from './styles/template-craft'
import type { ResolvedLook } from './styles/types'

function canvasMeta(props: Record<string, unknown>, durationInFrames: number) {
  const canvas = canvasForProps(props)
  return { durationInFrames, width: canvas.width, height: canvas.height }
}

function plainBody(props: Record<string, unknown>): unknown {
  return templateProps(peelStyle(props).body)
}

function lookOf(props: Record<string, unknown>): ResolvedLook | null {
  const look = peelStyle(props).look
  return look == null ? null : (look as ResolvedLook)
}

const calculateMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseListReelProps(plainBody(props))
  const look = lookOf(props)
  const frames = look
    ? styledListTiming(parsed.items.length, look, FPS, parsed.logoMode).totalFrames
    : computeTimingFromProps(parsed).totalFrames
  return canvasMeta(props, frames)
}

const calculateMontageMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseMontageReelProps(plainBody(props))
  const look = lookOf(props)
  const frames = look
    ? styledMontageTiming(parsed.clips.length, parsed.words.length, look, FPS).totalFrames
    : computeMontageTiming(parsed).totalFrames
  return canvasMeta(props, frames)
}

const calculateDataCardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseDataCardProps(plainBody(props))
  const look = lookOf(props)
  const frames = look
    ? styledDataCardTiming(parsed.rows, look, FPS).totalFrames
    : computeDataCardTiming(parsed).totalFrames
  return canvasMeta(props, frames)
}

const calculatePostcardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parsePostcardProps(plainBody(props))
  const look = lookOf(props)
  const timing = look
    ? styledPostcardTiming(parsed, look.rules, FPS, effectiveShotSec(look))
    : computePostcardTiming(parsed)
  return canvasMeta(props, timing.totalFrames)
}

const calculateAtmosphereMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseAtmosphereProps(plainBody(props))
  return canvasMeta(props, computeAtmosphereTiming(parsed).totalFrames)
}

const calculateCompareMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  parseCompareProps(plainBody(props))
  const look = lookOf(props)
  const timing = computeCompareTiming(look?.rules ?? null, look ? effectiveShotSec(look) : undefined)
  return canvasMeta(props, timing.totalFrames)
}

const calculateStudyMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const look = props.look as ResolvedLook | undefined
  if (!look?.craft) return { durationInFrames: 30 }
  return { durationInFrames: studyPlan(look.craft).totalFrames }
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
    <Composition id="CompareReel" component={CompareReel} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateCompareMetadata} />
    <Composition id="StyleStudy" component={StyleStudy} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculateStudyMetadata} />
    <Composition id="FramePreview" component={FramePreview} durationInFrames={45} fps={FPS} width={WIDTH} height={HEIGHT} calculateMetadata={calculatePreviewMetadata} />
  </>
)
