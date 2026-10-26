// Shared aspect contract for Remotion work orders.
// Pixel sizes, safe zones and file names live here so the renderer, the claim
// route and the complete route agree. No database column: extra files are
// sibling objects under renders/{client}/{workOrder}/ and are recorded in the
// existing output JSON.

export const ASPECT_IDS = ['9:16', '4:5', '1:1', '16:9'] as const

export type AspectId = (typeof ASPECT_IDS)[number]

export const RENDER_ASPECT_KEY = '__renderAspect'

export interface AspectSpec {
  id: AspectId
  width: number
  height: number
  fileName: string
  channels: readonly string[]
  placement: 'reels' | 'feed' | 'feed_fallback' | 'landscape'
}

export const ASPECTS: Record<AspectId, AspectSpec> = {
  '9:16': {
    id: '9:16',
    width: 1080,
    height: 1920,
    fileName: 'final.mp4',
    channels: ['tiktok', 'instagram_reels', 'facebook_reels', 'youtube_shorts'],
    placement: 'reels',
  },
  '4:5': {
    id: '4:5',
    width: 1080,
    height: 1350,
    fileName: 'final-4x5.mp4',
    channels: ['facebook_feed', 'instagram_feed', 'meta_ads'],
    placement: 'feed',
  },
  '1:1': {
    id: '1:1',
    width: 1080,
    height: 1080,
    fileName: 'final-1x1.mp4',
    channels: ['facebook_feed', 'instagram_feed', 'meta_ads'],
    placement: 'feed_fallback',
  },
  '16:9': {
    id: '16:9',
    width: 1920,
    height: 1080,
    fileName: 'final-16x9.mp4',
    channels: ['youtube'],
    placement: 'landscape',
  },
}

// 9:16 insets match theme.ts SAFE_TOP / SAFE_BOTTOM / SAFE_RIGHT (Reels rail).
// Other ratios reserve their own button / CTA / end-screen bands.
const SAFE: Record<AspectId, { left: number; top: number; right: number; bottom: number }> = {
  '9:16': { left: 90, top: 270, right: 960, bottom: 1248 },
  '4:5': { left: 64, top: 80, right: 1016, bottom: 1148 },
  '1:1': { left: 72, top: 80, right: 1008, bottom: 900 },
  '16:9': { left: 96, top: 64, right: 1480, bottom: 980 },
}

const FONT_SCALE: Record<AspectId, number> = {
  '9:16': 1,
  '4:5': 0.88,
  '1:1': 0.72,
  '16:9': 0.58,
}

export interface SafeRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface PlaceBoxInput {
  left: number
  top: number
  width: number
  fontSize?: number
  lines?: number
  lineHeight?: number
  blockPx?: number
}

export interface PlacedBox {
  left: number
  top: number
  width: number
  fontSize?: number
}

export interface AspectPlan {
  aspects: AspectId[]
  extras: AspectId[]
}

export interface AspectOutputRecord {
  aspect: AspectId
  width: number
  height: number
  path: string
  channels: string[]
  placement: AspectSpec['placement']
  role: 'primary' | 'variant'
}

export function isAspectId(value: unknown): value is AspectId {
  return typeof value === 'string' && (ASPECT_IDS as readonly string[]).includes(value)
}

export function aspectFromCanvas(width: number, height: number): AspectId {
  for (const id of ASPECT_IDS) {
    if (ASPECTS[id].width === width && ASPECTS[id].height === height) return id
  }
  return '9:16'
}

export function safeInsets(id: AspectId): SafeRect {
  const raw = SAFE[id]
  return { ...raw, width: raw.right - raw.left, height: raw.bottom - raw.top }
}

export function scalePx(width: number, height: number, px: number): number {
  const aspect = aspectFromCanvas(width, height)
  if (aspect === '9:16') return px
  return Math.max(1, Math.round(px * FONT_SCALE[aspect]))
}

/** CSS object-position. Null on 9:16 so the footage style stays unchanged. */
export function subjectObjectPosition(width: number, height: number): string | null {
  const aspect = aspectFromCanvas(width, height)
  if (aspect === '9:16') return null
  const anchor = aspect === '4:5' ? 34 : aspect === '1:1' ? 30 : 42
  return `center ${anchor}%`
}

export function subjectAnchorY(width: number, height: number): number {
  const aspect = aspectFromCanvas(width, height)
  if (aspect === '4:5') return 0.34
  if (aspect === '1:1') return 0.3
  if (aspect === '16:9') return 0.42
  return 0.5
}

/** Cover a destination with a source rectangle. 9:16-into-9:16 is a full bleed. */
export function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  anchorY: number,
): { left: number; top: number; width: number; height: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return {
    left: (dstW - width) / 2,
    top: dstH * anchorY - height * anchorY,
    width,
    height,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function fittedFont(start: number, lines: number, lineHeight: number, extra: number, maxH: number): number {
  let size = start
  while (size > 18 && size * lineHeight * lines + extra > maxH) size -= 1
  return size
}

/**
 * Map a 9:16 design box into this canvas. 9:16 returns the design numbers unchanged.
 * Other ratios reflow into that ratio's safe rect and shrink type until the block fits.
 */
export function placeBox(width: number, height: number, box: PlaceBoxInput): PlacedBox {
  const aspect = aspectFromCanvas(width, height)
  if (aspect === '9:16') {
    const same: PlacedBox = { left: box.left, top: box.top, width: box.width }
    if (box.fontSize !== undefined) same.fontSize = box.fontSize
    return same
  }
  const src = safeInsets('9:16')
  const dst = safeInsets(aspect)
  const nx = clamp((box.left - src.left) / src.width, 0, 1)
  const ny = clamp((box.top - src.top) / src.height, 0, 1)
  let boxW = clamp(box.width / src.width, 0, 1) * dst.width
  let left = dst.left + nx * Math.max(0, dst.width - boxW)
  if (aspect === '16:9') {
    boxW = Math.min(boxW, 680)
    const lane = dst.width * 0.52
    left = dst.left + nx * Math.max(0, lane - boxW)
  }
  const lines = box.lines ?? 1
  const lineHeight = box.lineHeight ?? 1.15
  const extra = box.blockPx ?? 0
  let fontSize = box.fontSize
  if (fontSize !== undefined) {
    fontSize = fittedFont(Math.max(1, Math.round(fontSize * FONT_SCALE[aspect])), lines, lineHeight, extra, dst.height)
  }
  const blockH = fontSize === undefined ? extra : fontSize * lineHeight * lines + extra
  let top = dst.top + ny * Math.max(0, dst.height - blockH)
  if (top + blockH > dst.bottom) top = Math.max(dst.top, dst.bottom - blockH)
  if (left + boxW > dst.right) left = Math.max(dst.left, dst.right - boxW)
  const placed: PlacedBox = {
    left: Math.round(left),
    top: Math.round(Math.max(dst.top, top)),
    width: Math.max(1, Math.round(boxW)),
  }
  if (fontSize !== undefined) placed.fontSize = fontSize
  return placed
}

export function logoBox(width: number, height: number): { left: number; top: number; width: number; height: number } {
  if (aspectFromCanvas(width, height) === '9:16') return { left: 54, top: 292, width: 470, height: 171 }
  const safe = safeInsets(aspectFromCanvas(width, height))
  const scale = FONT_SCALE[aspectFromCanvas(width, height)]
  return {
    left: safe.left,
    top: safe.top,
    width: Math.round(470 * scale * 0.62),
    height: Math.round(171 * scale * 0.5),
  }
}

export function dataCardFrame(width: number, height: number): {
  left: number
  width: number
  logoTop: number
  logoH: number
  rowsBottom: number
  disclaimerTop: number
  hookFont: number
  safeTop: number
  safeBottom: number
} {
  if (aspectFromCanvas(width, height) === '9:16') {
    return {
      left: 60,
      width: 900,
      logoTop: 280,
      logoH: 70,
      rowsBottom: 1160,
      disclaimerTop: 1190,
      hookFont: 80,
      safeTop: 270,
      safeBottom: 1248,
    }
  }
  const aspect = aspectFromCanvas(width, height)
  const safe = safeInsets(aspect)
  const logoH = Math.max(36, Math.round(70 * FONT_SCALE[aspect]))
  const disclaimerTop = safe.bottom - Math.max(28, Math.round(36 * FONT_SCALE[aspect]))
  return {
    left: safe.left,
    width: safe.width,
    logoTop: safe.top,
    logoH,
    rowsBottom: disclaimerTop - 12,
    disclaimerTop,
    hookFont: Math.max(28, Math.round(80 * FONT_SCALE[aspect])),
    safeTop: safe.top,
    safeBottom: safe.bottom,
  }
}

/** Missing or null means the historical single 9:16 deliverable. */
export function planWorkOrderAspects(raw: unknown): { ok: true; plan: AspectPlan } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, plan: { aspects: ['9:16'], extras: [] } }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'brief.remotion.aspects 必须是画幅数组，例如 ["9:16","4:5"]' }
  }
  if (raw.length === 0) {
    return { ok: false, message: 'brief.remotion.aspects 是空的。不写这个字段就只出 9:16' }
  }
  if (raw.length > 4) return { ok: false, message: 'brief.remotion.aspects 最多 4 个画幅' }
  const extras: AspectId[] = []
  for (const item of raw) {
    if (!isAspectId(item)) {
      return { ok: false, message: `不认识的画幅 ${JSON.stringify(item)}。只能是 9:16、4:5、1:1、16:9` }
    }
    if (item !== '9:16' && !extras.includes(item)) extras.push(item)
  }
  return { ok: true, plan: { aspects: ['9:16', ...extras], extras } }
}

function remotionAspectField(brief: unknown): unknown {
  const remotion = brief && typeof brief === 'object' ? (brief as Record<string, unknown>).remotion : undefined
  if (!remotion || typeof remotion !== 'object' || Array.isArray(remotion)) return undefined
  return (remotion as Record<string, unknown>).aspects
}

export function extraAspectUploadSpecs(
  brief: unknown,
  clientId: string,
  workOrderId: string,
): Array<{ aspect: AspectId; path: string; width: number; height: number }> {
  const planned = planWorkOrderAspects(remotionAspectField(brief))
  if (!planned.ok) return []
  return planned.plan.extras.map((id) => ({
    aspect: id,
    path: aspectStoragePath(clientId, workOrderId, id),
    width: ASPECTS[id].width,
    height: ASPECTS[id].height,
  }))
}

/** Signed-upload list for a claim. Invalid requests fail here so the worker can refuse the order. */
export function claimAspectUploads(
  brief: unknown,
  clientId: string,
  workOrderId: string,
): { ok: true; uploads: Array<{ aspect: AspectId; path: string; width: number; height: number }> } | { ok: false; error: string } {
  const planned = planWorkOrderAspects(remotionAspectField(brief))
  if (!planned.ok) return { ok: false, error: planned.message }
  return {
    ok: true,
    uploads: planned.plan.extras.map((id) => ({
      aspect: id,
      path: aspectStoragePath(clientId, workOrderId, id),
      width: ASPECTS[id].width,
      height: ASPECTS[id].height,
    })),
  }
}

/**
 * Accept aspect files only when this work order asked for them.
 * `outputs: null` means the historical single 9:16 deliverable.
 */
export function resolveAspectDelivery(
  brief: unknown,
  rawOutputs: unknown,
  ctx: { clientId: string; workOrderId: string; primaryPath: string },
): { ok: true; outputs: AspectOutputRecord[] | null } | { ok: false; error: string } {
  const planned = planWorkOrderAspects(remotionAspectField(brief))
  if (!planned.ok) return { ok: false, error: planned.message }
  const asked = planned.plan.extras.length > 0
  const sent = rawOutputs !== undefined
  if (!asked && !sent) return { ok: true, outputs: null }
  if (!asked && sent) {
    return { ok: false, error: 'aspect_outputs sent but brief.remotion.aspects did not ask for extra ratios' }
  }
  if (asked && !sent) {
    return { ok: false, error: 'brief.remotion.aspects asked for extra ratios but aspect_outputs is missing' }
  }
  const normalized = normalizeDeliveredAspects(rawOutputs, ctx)
  if (!normalized.ok) return normalized
  const want = planned.plan.aspects
  const got = normalized.outputs.map((row) => row.aspect)
  if (got.length !== want.length || want.some((id) => !got.includes(id))) {
    return { ok: false, error: 'aspect_outputs must list 9:16 and exactly the extra ratios in brief.remotion.aspects' }
  }
  return { ok: true, outputs: normalized.outputs }
}

export function aspectStoragePath(clientId: string, workOrderId: string, id: AspectId): string {
  return `renders/${clientId}/${workOrderId}/${ASPECTS[id].fileName}`
}

export function aspectIdFromProps(props: unknown): AspectId {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return '9:16'
  const raw = (props as Record<string, unknown>)[RENDER_ASPECT_KEY]
  return isAspectId(raw) ? raw : '9:16'
}

export function canvasForProps(props: unknown): { id: AspectId; width: number; height: number } {
  const id = aspectIdFromProps(props)
  return { id, width: ASPECTS[id].width, height: ASPECTS[id].height }
}

export function templateProps<T>(raw: T): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  if (!Object.prototype.hasOwnProperty.call(raw, RENDER_ASPECT_KEY)) return raw
  const copy = { ...(raw as Record<string, unknown>) }
  delete copy[RENDER_ASPECT_KEY]
  return copy as T
}

export function withRenderAspect<T extends object>(props: T, aspect: string): T {
  if (!isAspectId(aspect) || aspect === '9:16') return props
  return { ...props, [RENDER_ASPECT_KEY]: aspect }
}

function oneDeliveredAspect(
  item: unknown,
  ctx: { clientId: string; workOrderId: string },
  seen: Set<string>,
): { ok: true; output: AspectOutputRecord } | { ok: false; error: string } {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, error: 'aspect_outputs entries must be objects' }
  }
  const row = item as Record<string, unknown>
  if (!isAspectId(row.aspect)) return { ok: false, error: 'aspect_outputs contains an unknown aspect' }
  if (seen.has(row.aspect)) return { ok: false, error: `aspect_outputs repeats ${row.aspect}` }
  seen.add(row.aspect)
  const path = typeof row.video_url === 'string' ? row.video_url : ''
  const expected = aspectStoragePath(ctx.clientId, ctx.workOrderId, row.aspect)
  if (path !== expected) {
    return { ok: false, error: `aspect_outputs ${row.aspect} path must be ${expected}` }
  }
  const spec = ASPECTS[row.aspect]
  return {
    ok: true,
    output: {
      aspect: row.aspect,
      width: spec.width,
      height: spec.height,
      path,
      channels: [...spec.channels],
      placement: spec.placement,
      role: row.aspect === '9:16' ? 'primary' : 'variant',
    },
  }
}

/** Turn a worker's aspect file list into the output-JSON manifest. Paths are checked exactly. */
export function normalizeDeliveredAspects(
  raw: unknown,
  ctx: { clientId: string; workOrderId: string; primaryPath: string },
): { ok: true; outputs: AspectOutputRecord[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) {
    return { ok: false, error: 'aspect_outputs must be an array of 2 to 4 aspect files' }
  }
  const seen = new Set<string>()
  const outputs: AspectOutputRecord[] = []
  for (const item of raw) {
    const parsed = oneDeliveredAspect(item, ctx, seen)
    if (!parsed.ok) return parsed
    outputs.push(parsed.output)
  }
  const primary = outputs.find((row) => row.aspect === '9:16')
  if (!primary || primary.path !== ctx.primaryPath) {
    return { ok: false, error: 'aspect_outputs 9:16 path must match video_url' }
  }
  return { ok: true, outputs }
}
