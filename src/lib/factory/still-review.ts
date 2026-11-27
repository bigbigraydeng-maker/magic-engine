/**
 * Finish gate for one factory still. Red lines and catalog facts are the reel rules.
 * A hit, a fact result other than pass, or a review that cannot be read is not a pass.
 * Nothing here publishes or approves a pack.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'

import { getAnthropicClient, MODEL_HAIKU, modelCostUsd } from '@/lib/anthropic/client'
import { checkFacts } from '@/lib/social/weekly-loop/fact-check'
import { loadSocialFactSource } from '@/lib/social/weekly-loop/fact-aliases'
import { factProblemLines, type OkFactSource } from '@/lib/social/weekly-loop/reel-facts'

import { STILL_REVIEWER_ID } from './still-config'
import { scanRedlineHits } from './worker-guard'

export interface StillCopyVerdict {
  pass: boolean
  reasons: string[]
  redlineHits: string[]
  factVerdict: string
}

export interface StillVisualVerdict {
  pass: boolean
  reasons: string[]
  costUsd: number | null
  model: string | null
  /** True once the model request was sent. A missing price still has to be reserved. */
  billed: boolean
}

export interface StillWorkReview {
  asset_id: string | null
  role: 'story' | 'post'
  aspect: '9:16' | '4:5'
  slot_date: string
  tour_id: string | null
  reviewer: string
  model: string | null
  verdict: 'pass' | 'fail'
  reasons: string[]
  redline_hits: string[]
  fact_verdict: string
  checked_at: string
}

export interface StillCardReview {
  slot_date: string
  role: 'story' | 'post'
  verdict: 'pass' | 'fail'
  reviewer: string
  reasons: string[]
}

const VISUAL_FLAGS = [
  ['text_legible', '画面文字看不清或被裁切'],
  ['faces_ok', '人物或脸部不正常'],
  ['place_ok', '画面和目的地对不上'],
  ['brands_ok', '有水印或其他品牌'],
] as const

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function plainReviewReason(text: string): string {
  return text.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function stillFactLink(website: string | null, slug: string): string | null {
  const id = slug.trim()
  if (!id) return null
  if (!website || !website.startsWith('https://')) return `/${id}`
  try {
    const base = website.endsWith('/') ? website : `${website}/`
    return new URL(id, base).toString()
  } catch {
    return `/${id}`
  }
}

export function judgeStillCopy(input: {
  overlay: string
  caption: string
  linkUrl: string | null
  phrases: string[]
  topics: string[]
  source: OkFactSource | null
  today: string
  imageTourId: string | null
}): StillCopyVerdict {
  const overlay = input.overlay.trim()
  const caption = input.caption.trim()
  if (!overlay || !caption) return copyFail('没有可核对的画面文字或说明', [], 'unreadable')
  const redlineHits = scanRedlineHits([overlay, caption], input.phrases, input.topics)
  if (!input.source) return copyFail('团目录读不到，没有当成通过', redlineHits, 'unreadable')
  const imageTourId = input.imageTourId?.trim() ?? ''
  if (!imageTourId) return copyFail('线路读不到，没有当成通过', redlineHits, 'unreadable')
  const fact = checkFacts({
    texts: { overlay, caption, firstComment: null },
    linkUrl: input.linkUrl,
    tours: input.source.tours,
    aliasesByTourId: input.source.aliasesByTourId,
    catalogVersion: input.source.catalogVersion,
    today: input.today,
    imageTourId,
  })
  const reasons = [...redlineReasons(redlineHits), ...factProblemLines(fact.items).map(plainReviewReason)]
  if (fact.verdict !== 'pass' && reasons.length === 0) reasons.push('事实核对没有通过')
  const pass = redlineHits.length === 0 && fact.verdict === 'pass'
  return { pass, reasons: reasons.filter((line) => line.length > 0).slice(0, 4), redlineHits, factVerdict: fact.verdict }
}

export async function loadStillRedlines(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ phrases: string[]; topics: string[] } | null> {
  const client = await supabase.from('clients').select('brand_redline_phrases').eq('id', clientId).limit(1)
  if (client.error) return null
  // Same choice as the still work order: the newest brief that is actually in use.
  const brief = await supabase
    .from('master_briefs')
    .select('excluded_topics')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
  if (brief.error) return null
  const phrases = stringList(rowField(client.data, 'brand_redline_phrases'))
  const topics = stringList(rowField(brief.data, 'excluded_topics'))
  if (!phrases || !topics) return null
  if (!client.data?.[0] || !brief.data?.[0]) return null
  return { phrases, topics }
}

export async function reviewStillCopy(input: {
  supabase: SupabaseClient
  clientId: string
  overlay: string
  caption: string
  linkUrl: string | null
  today: string
  imageTourId: string | null
}): Promise<StillCopyVerdict> {
  const redlines = await loadStillRedlines(input.supabase, input.clientId)
  if (!redlines) return copyFail('品牌红线读不到，没有当成通过', [], 'unreadable')
  const source = await loadSocialFactSource(input.supabase, input.clientId, input.today)
  return judgeStillCopy({
    overlay: input.overlay,
    caption: input.caption,
    linkUrl: input.linkUrl,
    phrases: redlines.phrases,
    topics: redlines.topics,
    source: source.ok ? source : null,
    today: input.today,
    imageTourId: input.imageTourId,
  })
}

export function parseStillVisual(raw: string): { pass: boolean; reasons: string[] } {
  const row = jsonObject(raw)
  if (!row) return { pass: false, reasons: ['画面审读不出来'] }
  const reasons: string[] = []
  for (const [key, label] of VISUAL_FLAGS) {
    if (typeof row[key] !== 'boolean') return { pass: false, reasons: ['画面审读不出来'] }
    if (row[key] === false) reasons.push(label)
  }
  return { pass: reasons.length === 0, reasons: reasons.slice(0, 4) }
}

export function stillVisualPrompt(input: { tourName: string; place: string; overlay: string }): string {
  const tourName = input.tourName.trim()
  return [
    'Check this one marketing still. Do not assume it passes. When unsure, answer false.',
    `This still is only for this tour: ${tourName || '(none)'}`,
    `Named place: ${input.place.trim() || '(none)'}`,
    `Overlay text that must be readable and not cropped: ${input.overlay.trim() || '(none)'}`,
    'Use only this tour. If the on-image text names a different tour, the still fails.',
    'Return only JSON with boolean fields text_legible, faces_ok, place_ok, brands_ok.',
    'text_legible: on-image text is readable and not cut off by the frame.',
    'faces_ok: there is no person, or no person or face is distorted.',
    'place_ok: the picture matches this tour and its place. Answer false if the on-image text names a different tour.',
    'brands_ok: there is no watermark and no other brand or logo.',
  ].join('\n')
}

export async function reviewStillImage(input: {
  imageUrl: string
  place: string
  overlay: string
  tourName: string
}): Promise<StillVisualVerdict> {
  if (!input.tourName.trim()) {
    return { pass: false, reasons: ['线路读不到，没有当成通过'], costUsd: null, model: null, billed: false }
  }
  const image = await loadReviewImage(input.imageUrl)
  if (typeof image === 'string') {
    return { pass: false, reasons: ['画面读不出来'], costUsd: null, model: null, billed: false }
  }
  return askReviewModel(input, image)
}

export function readStillReviews(output: unknown): StillCardReview[] {
  const stills = record(output)?.stills
  if (!Array.isArray(stills)) return []
  const out: StillCardReview[] = []
  for (const raw of stills) {
    const row = cardReview(raw)
    if (row) out.push(row)
  }
  return out
}

export function buildStillReview(input: {
  assetId: string | null
  role: 'story' | 'post'
  aspect: '9:16' | '4:5'
  slotDate: string
  tourId: string | null
  verdict: 'pass' | 'fail'
  reasons: string[]
  redlineHits: string[]
  factVerdict: string
  model: string | null
  checkedAt: string
}): StillWorkReview {
  const tourId = input.tourId?.trim() ?? ''
  return {
    asset_id: input.assetId,
    role: input.role,
    aspect: input.aspect,
    slot_date: input.slotDate,
    tour_id: tourId.length > 0 ? tourId : null,
    reviewer: STILL_REVIEWER_ID,
    model: input.model,
    verdict: input.verdict,
    reasons: input.reasons.map(plainReviewReason).filter((line) => line.length > 0).slice(0, 4),
    redline_hits: input.redlineHits.slice(0, 8),
    fact_verdict: input.factVerdict.slice(0, 40),
    checked_at: input.checkedAt,
  }
}

function copyFail(reason: string, redlineHits: string[], factVerdict: string): StillCopyVerdict {
  return {
    pass: false,
    reasons: [...redlineReasons(redlineHits), plainReviewReason(reason)].filter((line) => line.length > 0).slice(0, 4),
    redlineHits,
    factVerdict,
  }
}

function redlineReasons(hits: string[]): string[] {
  return hits.map((phrase) => plainReviewReason(`红线：${phrase}`)).filter((line) => line.length > 0)
}

function cardReview(raw: unknown): StillCardReview | null {
  const row = record(raw)
  if (!row || (row.role !== 'story' && row.role !== 'post')) return null
  if (typeof row.slot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.slot_date)) return null
  const reasons = stringList(row.reasons) ?? []
  return {
    slot_date: row.slot_date,
    role: row.role,
    verdict: row.verdict === 'pass' ? 'pass' : 'fail',
    reviewer: typeof row.reviewer === 'string' ? row.reviewer : '',
    reasons,
  }
}

function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return record(JSON.parse(raw.slice(start, end + 1)))
  } catch {
    return null
  }
}

async function askReviewModel(
  input: { tourName: string; place: string; overlay: string },
  image: { data: string; mediaType: ImageMediaType },
): Promise<StillVisualVerdict> {
  const client = reviewClient()
  if (!client) return { pass: false, reasons: ['画面审没有完成'], costUsd: null, model: null, billed: false }
  try {
    const message = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 400,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: stillVisualPrompt(input) },
        ],
      }],
    })
    const text = message.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text).join('\n')
    const parsed = parseStillVisual(text)
    const costUsd = modelCostUsd(MODEL_HAIKU, message.usage.input_tokens, message.usage.output_tokens)
    return { ...parsed, costUsd, model: MODEL_HAIKU, billed: true }
  } catch {
    return { pass: false, reasons: ['画面审没有完成'], costUsd: null, model: MODEL_HAIKU, billed: true }
  }
}

function reviewClient(): ReturnType<typeof getAnthropicClient> | null {
  try {
    return getAnthropicClient()
  } catch {
    return null
  }
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

async function loadReviewImage(imageUrl: string): Promise<{ data: string; mediaType: ImageMediaType } | string> {
  if (!imageUrl.startsWith('https://')) return 'image_url'
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return 'image_fetch'
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return 'image_size'
    return { data: bytes.toString('base64'), mediaType: mediaTypeOf(res.headers.get('content-type')) }
  } catch {
    return 'image_fetch'
  }
}

function mediaTypeOf(contentType: string | null): ImageMediaType {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  if (ct.includes('gif')) return 'image/gif'
  return 'image/jpeg'
}

function rowField(data: unknown, key: string): unknown {
  const row = Array.isArray(data) ? data[0] : null
  return record(row)?.[key]
}

function stringList(value: unknown): string[] | null {
  if (value == null) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return value
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
