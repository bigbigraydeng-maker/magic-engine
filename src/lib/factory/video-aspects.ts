// App-side entry for the Remotion aspect contract. The implementation lives next
// to the renderer so the factory worker can load it as plain TypeScript without
// crossing into a package that Node treats as CommonJS.
export {
  ASPECTS,
  ASPECT_IDS,
  RENDER_ASPECT_KEY,
  aspectFromCanvas,
  aspectIdFromProps,
  aspectStoragePath,
  canvasForProps,
  claimAspectUploads,
  coverRect,
  dataCardFrame,
  extraAspectUploadSpecs,
  isAspectId,
  logoBox,
  normalizeDeliveredAspects,
  placeBox,
  planWorkOrderAspects,
  resolveAspectDelivery,
  safeInsets,
  scalePx,
  subjectAnchorY,
  subjectObjectPosition,
  templateProps,
  withRenderAspect,
} from '../../../scripts/factory-worker/engines/remotion/src/video-aspects'

export type {
  AspectId,
  AspectOutputRecord,
  AspectPlan,
  AspectSpec,
  PlaceBoxInput,
  PlacedBox,
  SafeRect,
} from '../../../scripts/factory-worker/engines/remotion/src/video-aspects'
