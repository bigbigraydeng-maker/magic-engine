import { execFile } from 'child_process'
import { promisify } from 'util'
import { createWriteStream, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentCheckItemResult } from '@/lib/social/content-review'
import { REEL_AUTO_CHECK_KEYS } from '@/lib/social/content-review'
import { buildReelPublishAutoChecks } from '@/lib/social/reel-publishing'
import type { MaliangCheck } from '@/lib/maliang/render-check'
import { EXTERNAL_UPLOAD_ENGINE, readTalentConsent, type ConsentUse } from '@/lib/factory/talent-consent'

const exec = promisify(execFile)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AdmitInput {
  clientId: string
  storagePath: string
  angle: string
  rationale: string
  caption: string
  endcard: { cta: string; url: string }
  masterBriefId?: string
  goalId?: string
  /** Who confirmed the on-camera consent. Routes pass the logged-in admin email; scripts pass a fixed service identity. Never taken from a request body. */
  confirmedBy: string
  talentConsent?: { status: 'granted' | 'not_needed'; scope: ConsentUse[]; subject: string; evidence: string }
}

export interface AdmitDeps {
  sendReview?: (data: { client_id: string; work_order_id: string; output_url: string }) => Promise<void>
  now?: () => Date
}

/** Only a relative path inside the content-factory bucket: no scheme, no protocol-relative, no '..' segment. Returns the path without leading slashes, or null. */
export function normalizeStoragePath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null
  const cleaned = trimmed.replace(/^\/+/, '')
  if (!cleaned) return null
  const segments = cleaned.split('/')
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment === '') return null
  }
  return cleaned
}

interface ProbeResult {
  width: number
  height: number
  durationSeconds: number
  hasAudio: boolean
}

export async function probeUploadedVideo(filePath: string): Promise<ProbeResult> {
  const { stdout: videoOut } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    filePath,
  ])
  const videoData = JSON.parse(videoOut) as {
    streams?: { width?: number; height?: number }[]
    format?: { duration?: string }
  }
  const stream = videoData.streams?.[0]
  if (!stream?.width || !stream?.height) throw new Error('no video stream found')

  const { stdout: audioOut } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    filePath,
  ])
  const audioData = JSON.parse(audioOut) as { streams?: { codec_type?: string }[] }
  const hasAudio = (audioData.streams ?? []).length > 0

  return {
    width: stream.width,
    height: stream.height,
    durationSeconds: Number(videoData.format?.duration ?? 0),
    hasAudio,
  }
}

export function buildAdmitAutoChecklist(
  probe: ProbeResult,
  publishInput: { workOrderId: string; caption: string; endcard: { cta: string; url: string } },
): ContentCheckItemResult[] {
  const aspect = probe.width > 0 && probe.height > 0
    ? probe.width / probe.height
    : 0
  const targetAspect = 9 / 16
  const aspectOk = Math.abs(aspect - targetAspect) < 0.015
  const sizeOk = probe.width >= 540 && probe.height >= 960
  const durationOk = probe.durationSeconds >= 3 && probe.durationSeconds <= 90

  const audioCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[0],
    judge: 'AUTO',
    outcome: probe.hasAudio ? 'PASS' : 'FAIL',
    detail: probe.hasAudio
      ? 'Uploaded video has an audio track.'
      : 'Uploaded video has no audio track.',
    source_ref: null,
  }

  const resolutionCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[1],
    judge: 'AUTO',
    outcome: aspectOk && sizeOk && durationOk ? 'PASS' : 'FAIL',
    detail: `${probe.width}×${probe.height}, ${probe.durationSeconds.toFixed(1)}s` +
      (!aspectOk ? ' — aspect ratio is not 9:16' : '') +
      (!sizeOk ? ' — resolution too low' : '') +
      (!durationOk ? ' — duration out of 3–90s range' : ''),
    source_ref: null,
  }

  const subtitleCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[2],
    judge: 'AUTO',
    outcome: 'NOT_MEASURED',
    detail: 'Waiting for the 马良 review of the uploaded video.',
    source_ref: null,
  }

  const coverCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[3],
    judge: 'AUTO',
    outcome: 'NOT_MEASURED',
    detail: 'Waiting for the 马良 review of the uploaded video.',
    source_ref: null,
  }

  const formatCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[4],
    judge: 'AUTO',
    outcome: aspectOk && sizeOk && durationOk ? 'PASS' : 'FAIL',
    detail: resolutionCheck.detail,
    source_ref: null,
  }

  const publishChecks = buildReelPublishAutoChecks({
    workOrderId: publishInput.workOrderId,
    body: publishInput.caption,
    endcard: publishInput.endcard as Record<string, unknown>,
  })

  return [audioCheck, resolutionCheck, subtitleCheck, coverCheck, formatCheck, ...publishChecks]
}

/** After 马良 looked at an uploaded video, settle the subtitle and cover items from its frames. Unverifiable or no frames: leave them NOT_MEASURED. */
export function applyMaliangToAdmitChecklist(
  items: readonly ContentCheckItemResult[],
  check: MaliangCheck,
): ContentCheckItemResult[] {
  if (check.status === 'unverifiable' || check.frames.length === 0) {
    return items.map((item) => ({ ...item }))
  }

  const first = check.frames[0]
  const coverOutcome = first.image_ok ? 'PASS' : 'FAIL'
  const coverDetail = `马良 first frame: ${first.image_note || (first.image_ok ? 'ok' : 'not ok')}`

  const failing = check.frames.filter((frame) => !frame.text_ok)
  const subtitleOutcome = failing.length === 0 ? 'PASS' : 'FAIL'
  const subtitleDetail = failing.length === 0
    ? `all ${check.frames.length} frames text ok`
    : `text not ok at ${failing.map((frame) => `${frame.t_pct}%`).join(', ')}`

  return items.map((item) => {
    if (item.key === REEL_AUTO_CHECK_KEYS[3]) {
      return { ...item, outcome: coverOutcome, detail: coverDetail }
    }
    if (item.key === REEL_AUTO_CHECK_KEYS[2]) {
      return { ...item, outcome: subtitleOutcome, detail: subtitleDetail }
    }
    return { ...item }
  })
}

export type AdmitResult =
  | {
      ok: true
      workOrderId: string
      autoChecklist: ContentCheckItemResult[]
      deduped: boolean
      reviewQueued: boolean
      reviewError: string | null
    }
  | { ok: false; status: number; error: string }

type BuiltConsent = {
  status: 'granted' | 'not_needed'
  scope: ConsentUse[]
  subject: string
  confirmed_by: string
  confirmed_at: string
  evidence: string
}

function buildConsent(input: AdmitInput, deps: AdmitDeps): BuiltConsent | null | 'invalid' {
  if (!input.talentConsent) return null
  const now = deps.now ?? (() => new Date())
  const consent = {
    ...input.talentConsent,
    confirmed_by: input.confirmedBy,
    confirmed_at: now().toISOString(),
  }
  const parsed = readTalentConsent({ talent_consent: consent })
  if (parsed === 'invalid' || parsed === null) return 'invalid'
  return parsed
}

interface ExistingAdmit {
  id: string
  autoChecklist: ContentCheckItemResult[]
}

async function findExistingAdmit(
  supabase: SupabaseClient,
  clientId: string,
  storagePath: string,
): Promise<{ ok: true; row: ExistingAdmit | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, output')
    .eq('client_id', clientId)
    .eq('output->>video_path', storagePath)
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0] as { id?: unknown; output?: unknown } | undefined
  if (!row || typeof row.id !== 'string') return { ok: true, row: null }
  const output = typeof row.output === 'object' && row.output !== null
    ? row.output as Record<string, unknown>
    : {}
  const rawChecklist = output.quality_checklist_auto
  const autoChecklist = Array.isArray(rawChecklist)
    ? (rawChecklist as ContentCheckItemResult[])
    : []
  return { ok: true, row: { id: row.id, autoChecklist } }
}

async function queueReview(
  deps: AdmitDeps,
  data: { client_id: string; work_order_id: string; output_url: string },
): Promise<{ reviewQueued: boolean; reviewError: string | null }> {
  if (!deps.sendReview) return { reviewQueued: false, reviewError: null }
  try {
    await deps.sendReview(data)
    return { reviewQueued: true, reviewError: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { reviewQueued: false, reviewError: msg.slice(0, 300) }
  }
}

export async function admitFinishedVideo(
  supabase: SupabaseClient,
  input: AdmitInput,
  deps: AdmitDeps = {},
): Promise<AdmitResult> {
  if (!UUID_RE.test(input.clientId)) {
    return { ok: false, status: 400, error: 'invalid client_id' }
  }
  if (!input.storagePath || !input.angle || !input.caption) {
    return { ok: false, status: 400, error: 'missing required fields: storage_path, angle, caption' }
  }
  if (!input.endcard.cta || !input.endcard.url) {
    return { ok: false, status: 400, error: 'missing endcard.cta and endcard.url for publish checks' }
  }

  const storagePath = normalizeStoragePath(input.storagePath)
  if (!storagePath) {
    return { ok: false, status: 400, error: 'storage_path must be a relative path inside the content-factory bucket' }
  }

  const consent = buildConsent(input, deps)
  if (consent === 'invalid') {
    return { ok: false, status: 400, error: 'talent_consent is invalid (status, scope, subject, evidence and confirmedBy are required)' }
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, factory_config')
    .eq('id', input.clientId)
    .maybeSingle()
  if (!client) return { ok: false, status: 404, error: 'client not found' }

  const existing = await findExistingAdmit(supabase, input.clientId, storagePath)
  if (!existing.ok) {
    return { ok: false, status: 500, error: `dedupe check failed: ${existing.error}` }
  }
  if (existing.row) {
    return {
      ok: true,
      workOrderId: existing.row.id,
      autoChecklist: existing.row.autoChecklist,
      deduped: true,
      reviewQueued: false,
      reviewError: null,
    }
  }

  let goalId = input.goalId
  if (!goalId) {
    const configGoalId = ((client.factory_config ?? {}) as Record<string, unknown>)['factory_goal_id']
    if (typeof configGoalId === 'string' && UUID_RE.test(configGoalId)) {
      goalId = configGoalId
    } else {
      const { data: goals } = await supabase
        .from('goals')
        .select('id')
        .eq('client_id', input.clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      goalId = goals?.id as string | undefined
    }
    if (!goalId) return { ok: false, status: 422, error: 'no active goal found for this client — pass goal_id explicitly' }
  }

  let masterBriefId = input.masterBriefId
  if (!masterBriefId) {
    const { data: brief } = await supabase
      .from('master_briefs')
      .select('id')
      .eq('client_id', input.clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    masterBriefId = brief?.id as string | undefined
    if (!masterBriefId) return { ok: false, status: 422, error: 'no active master brief found for this client — pass master_brief_id explicitly' }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return { ok: false, status: 500, error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/content-factory/${storagePath}`

  const tempDir = mkdtempSync(join(tmpdir(), 'admit-'))
  const localFile = join(tempDir, 'video.mp4')
  try {
    const res = await fetch(publicUrl)
    if (!res.ok || !res.body) {
      return { ok: false, status: 422, error: `failed to download video: ${res.status} ${res.statusText}` }
    }
    const dest = createWriteStream(localFile)
    // @ts-expect-error ReadableStream → NodeJS.ReadableStream bridge
    await pipeline(res.body, dest)

    const probe = await probeUploadedVideo(localFile)

    const tempId = crypto.randomUUID()
    const autoChecklist = buildAdmitAutoChecklist(probe, {
      workOrderId: tempId,
      caption: input.caption,
      endcard: input.endcard,
    })

    const brief: Record<string, unknown> = {
      engine: EXTERNAL_UPLOAD_ENGINE,
      copy: {
        caption: input.caption,
        endcard: { cta: input.endcard.cta, url: input.endcard.url },
      },
    }
    if (consent) brief.talent_consent = consent

    const { data: inserted, error } = await supabase
      .from('content_work_orders')
      .insert({
        id: tempId,
        client_id: input.clientId,
        goal_id: goalId,
        master_brief_id: masterBriefId,
        order_type: 'fresh_angle',
        angle: input.angle,
        angle_source: {
          source: 'me_upload_entry',
          uploaded_at: new Date().toISOString(),
        },
        rationale_one_liner: input.rationale || input.angle,
        brief,
        budget_cap_usd: 0,
        actual_cost_usd: 0,
        status: 'in_review',
        output: {
          video_path: storagePath,
          quality_checklist_auto: autoChecklist,
          probe: {
            width: probe.width,
            height: probe.height,
            duration_seconds: probe.durationSeconds,
            has_audio: probe.hasAudio,
          },
        },
      })
      .select('id')
      .single()

    if (error) return { ok: false, status: 500, error: `insert failed: ${error.message}` }

    const workOrderId = inserted.id as string
    const review = await queueReview(deps, {
      client_id: input.clientId,
      work_order_id: workOrderId,
      output_url: publicUrl,
    })

    return {
      ok: true,
      workOrderId,
      autoChecklist,
      deduped: false,
      reviewQueued: review.reviewQueued,
      reviewError: review.reviewError,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, error: `probe/insert failed: ${msg}` }
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
  }
}
