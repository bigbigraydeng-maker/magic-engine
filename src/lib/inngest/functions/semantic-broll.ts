import { inngest, CLOUD_FN_PREFIX } from '../client'

export const SEMANTIC_BROLL_REQUESTED_EVENT = 'video/broll.semantic-matching.requested' as const
export const SEMANTIC_BROLL_READY_EVENT = 'video/broll.semantic-matching.ready' as const
export const SEMANTIC_BROLL_APPROVED_EVENT = 'video/broll.plan.approved' as const

export interface TranscriptSegment {
  start_sec: number
  end_sec: number
  text: string
}

export interface BrollAssetRef {
  asset_id: string
  uri: string
  title?: string
  tags?: string[]
  ocr_text?: string
  role?: 'screen' | 'diagram' | 'product' | 'street' | 'proof' | 'music' | 'other'
}

export interface SemanticBrollRequest {
  job_id: string
  source_video_uri: string
  transcript_segments: TranscriptSegment[]
  asset_refs: BrollAssetRef[]
  max_duration_sec?: number
  approval_required?: boolean
}

export interface SemanticBrollPlanItem {
  segment_index: number
  start_sec: number
  end_sec: number
  text: string
  candidates: Array<{ asset_id: string; uri: string; score: number; reason: string }>
}

export interface SemanticBrollPlan {
  job_id: string
  source_video_uri: string
  version: 1
  items: SemanticBrollPlanItem[]
  generated_at: string
}

const HTTP_URI = /^(https?:\/\/|storage:\/\/)/i
const WORDS = /[\p{L}\p{N}]+/gu

function tokens(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase().match(WORDS) ?? []).filter((word) => word.length > 1))
}

function assertRemoteUri(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !HTTP_URI.test(value)) throw new Error(`invalid_remote_uri:${field}`)
}

export function validateSemanticBrollRequest(raw: unknown): SemanticBrollRequest {
  if (!raw || typeof raw !== 'object') throw new Error('payload_not_object')
  const value = raw as Record<string, unknown>
  if (typeof value.job_id !== 'string' || value.job_id.trim().length < 3) throw new Error('invalid_job_id')
  assertRemoteUri(value.source_video_uri, 'source_video_uri')
  if (!Array.isArray(value.transcript_segments) || value.transcript_segments.length === 0) throw new Error('missing_transcript_segments')
  if (!Array.isArray(value.asset_refs) || value.asset_refs.length === 0) throw new Error('missing_asset_refs')
  const transcript_segments = value.transcript_segments.map((rawSegment, index) => {
    if (!rawSegment || typeof rawSegment !== 'object') throw new Error(`invalid_transcript_segment:${index}`)
    const segment = rawSegment as Record<string, unknown>
    if (typeof segment.start_sec !== 'number' || typeof segment.end_sec !== 'number' || segment.end_sec <= segment.start_sec) {
      throw new Error(`invalid_transcript_timing:${index}`)
    }
    if (typeof segment.text !== 'string' || segment.text.trim().length < 2) throw new Error(`invalid_transcript_text:${index}`)
    return { start_sec: segment.start_sec, end_sec: segment.end_sec, text: segment.text.trim() }
  })
  const asset_refs = value.asset_refs.map((rawAsset, index) => {
    if (!rawAsset || typeof rawAsset !== 'object') throw new Error(`invalid_asset_ref:${index}`)
    const asset = rawAsset as Record<string, unknown>
    if (typeof asset.asset_id !== 'string' || asset.asset_id.trim().length < 1) throw new Error(`invalid_asset_id:${index}`)
    assertRemoteUri(asset.uri, `asset_refs.${index}.uri`)
    const tags = Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is string => typeof tag === 'string') : []
    const role = ['screen', 'diagram', 'product', 'street', 'proof', 'music', 'other'].includes(String(asset.role))
      ? (asset.role as BrollAssetRef['role'])
      : undefined
    return { asset_id: asset.asset_id, uri: asset.uri, title: typeof asset.title === 'string' ? asset.title : undefined, tags, ocr_text: typeof asset.ocr_text === 'string' ? asset.ocr_text : undefined, role }
  })
  return {
    job_id: value.job_id,
    source_video_uri: value.source_video_uri,
    transcript_segments,
    asset_refs,
    max_duration_sec: typeof value.max_duration_sec === 'number' && value.max_duration_sec > 0 ? value.max_duration_sec : undefined,
    approval_required: value.approval_required !== false,
  }
}

export function buildSemanticBrollPlan(request: SemanticBrollRequest): SemanticBrollPlan {
  const items = request.transcript_segments.map((segment, segment_index) => {
    const words = tokens(segment.text)
    const ranked = request.asset_refs.map((asset) => {
      const searchable = tokens([asset.title, ...(asset.tags ?? []), asset.ocr_text].filter(Boolean).join(' '))
      const overlap = [...words].filter((word) => searchable.has(word)).length
      const roleBoost = asset.role === 'screen' && /广告|数据|平台|后台|工具|工作流|截图|界面|投流|AI|agent/i.test(segment.text) ? 2 : 0
      const score = Number((overlap / Math.max(words.size, 1) + roleBoost / 10).toFixed(3))
      return { asset_id: asset.asset_id, uri: asset.uri, score, reason: overlap ? `关键词匹配${overlap}个` : roleBoost ? '内容语义适合屏幕素材' : '候选素材' }
    }).sort((a, b) => b.score - a.score || a.asset_id.localeCompare(b.asset_id))
    return { segment_index, start_sec: segment.start_sec, end_sec: segment.end_sec, text: segment.text, candidates: ranked.slice(0, 3) }
  })
  const bounded = request.max_duration_sec ? items.filter((item) => item.start_sec < request.max_duration_sec) : items
  return { job_id: request.job_id, source_video_uri: request.source_video_uri, version: 1, items: bounded, generated_at: new Date().toISOString() }
}

export const semanticBrollMatchingRequested = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}semantic-broll-matching`,
    name: 'Video: semantic B-roll matching plan',
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.job_id' },
  },
  { event: SEMANTIC_BROLL_REQUESTED_EVENT },
  async ({ event, step }) => {
    const request = validateSemanticBrollRequest(event.data)
    const plan = await step.run('build-semantic-broll-plan', () => buildSemanticBrollPlan(request))
    await step.sendEvent('publish-plan', {
      name: SEMANTIC_BROLL_READY_EVENT,
      id: `${request.job_id}:plan:${plan.version}`,
      data: plan,
    })
    if (!request.approval_required) return { status: 'ready_for_render', plan }
    const approval = await step.waitForEvent(`wait-approval-${request.job_id}`, {
      event: SEMANTIC_BROLL_APPROVED_EVENT,
      match: 'data.job_id',
      timeout: '7d',
    })
    if (!approval?.data || approval.data.approved !== true) return { status: 'rejected', job_id: request.job_id }
    return { status: 'approved_for_render', job_id: request.job_id, plan_version: plan.version, plan }
  },
)
