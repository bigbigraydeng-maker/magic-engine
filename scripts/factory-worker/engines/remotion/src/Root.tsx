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
import { StyleStudy } from './styles/StyleStudy'
import { effectiveShotSec, studyPlan } from './styles/craft'
import { styledPostcardTiming } from './styles/rules'
import { peelStyle } from './styles/select'
import type { ResolvedLook } from './styles/types'

function bodyOf(props: Record<string, unknown>): unknown {
  return peelStyle(props).body
}

function lookOf(props: Record<string, unknown>): ResolvedLook | null {
  const look = peelStyle(props).look
  return look == null ? null : (look as ResolvedLook)
}

const calculateMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseListReelProps(bodyOf(props))
  return { durationInFrames: computeTimingFromProps(parsed).totalFrames }
}

const calculateMontageMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseMontageReelProps(bodyOf(props))
  return { durationInFrames: computeMontageTiming(parsed).totalFrames }
}

const calculateDataCardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseDataCardProps(bodyOf(props))
  return { durationInFrames: computeDataCardTiming(parsed).totalFrames }
}

const calculatePostcardMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parsePostcardProps(bodyOf(props))
  const look = lookOf(props)
  const timing = look
    ? styledPostcardTiming(parsed, look.rules, FPS, effectiveShotSec(look))
    : computePostcardTiming(parsed)
  return { durationInFrames: timing.totalFrames }
}

const calculateAtmosphereMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const parsed = parseAtmosphereProps(bodyOf(props))
  return { durationInFrames: computeAtmosphereTiming(parsed).totalFrames }
}

const calculateCompareMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  parseCompareProps(bodyOf(props))
  const look = lookOf(props)
  const timing = computeCompareTiming(look?.rules ?? null, look ? effectiveShotSec(look) : undefined)
  return { durationInFrames: timing.totalFrames }
}

const calculateStudyMetadata: CalculateMetadataFunction<Record<string, unknown>> = ({ props }) => {
  const look = props.look as ResolvedLook | undefined
  if (!look?.craft) return { durationInFrames: 30 }
  return { durationInFrames: studyPlan(look.craft).totalFrames }
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
  </>
)
