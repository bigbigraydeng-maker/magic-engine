import { execFile } from 'child_process'
import { promisify } from 'util'
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentCheckItemResult } from '@/lib/social/content-review'
import { REEL_AUTO_CHECK_KEYS } from '@/lib/social/content-review'
import { buildReelPublishAutoChecks } from '@/lib/social/reel-publishing'
import type { MaliangCheck } from '@/lib/maliang/render-check'
import {
  EXTERNAL_UPLOAD_ENGINE,
  readTalentConsent,
  identifiableFaceCount,
  type ConsentUse,
} from '@/lib/factory/talent-consent'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'

const exec = promisify(execFile)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Same name as MALIANG_RENDER_READY_EVENT in inngest/functions/maliang-render-check.ts (kept local to avoid an import cycle; a test pins them equal). */
export const ADMIT_REVIEW_EVENT = 'me/maliang.render.ready'
/** 马良 refuses to download more than this (render-check.ts). Reject at admit time instead of failing later. */
export const ADMIT_MAX_VIDEO_BYTES = 80 * 1024 * 1024
/**
 * Orders in these states are dead; a new admit of the same path creates a fresh order.
 * publish_failed is NOT dead: the worker may still retry it, or an interrupted publish may already be public.
 */
const DEAD_STATUSES = new Set(['review_rejected', 'failed', 'dead_letter', 'archived', 'superseded'])

const CONSENT_USES: readonly ConsentUse[] = ['facebook_organic', 'meta_ads', 'tiktok_organic']

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

/** Asks 马良 to look at an admitted order. The id carries the time so a deliberate re-review is not dropped by Inngest's 24 h de-duplication. */
export async function sendAdmitReview(
  data: { client_id: string; work_order_id: string; output_url: string },
  now: Date = new Date(),
): Promise<void> {
  await sendInngestEvent({
    id: `maliang-admit:${data.work_order_id}:${now.getTime()}`,
    name: ADMIT_REVIEW_EVENT,
    data,
  })
}

/** Only a relative path inside the content-factory bucket under <client_id>/external/: no scheme, no protocol-relative, no '..' segment, no '%' or '\\'. Returns the path without leading slashes, or null. */
export function normalizeStoragePath(raw: string, clientId: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null
  if (trimmed.includes('%') || trimmed.includes('\\')) return null
  const cleaned = trimmed.replace(/^\/+/, '')
  if (!cleaned) return null
  const segments = cleaned.split('/')
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment === '') return null
  }
  if (!cleaned.startsWith(`${clientId}/external/`)) return null
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
      consentUpdated: boolean
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
  status: string
  brief: Record<string, unknown>
  output: Record<string, unknown>
  updatedAt: string
  autoChecklist: ContentCheckItemResult[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

async function findExistingAdmit(
  supabase: SupabaseClient,
  clientId: string,
  storagePath: string,
): Promise<{ ok: true; row: ExistingAdmit | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, status, brief, output, updated_at')
    .eq('client_id', clientId)
    .eq('output->>video_path', storagePath)
    .not('status', 'in', '(review_rejected,failed,dead_letter,archived,superseded)')
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0] as
    | { id?: unknown; status?: unknown; brief?: unknown; output?: unknown; updated_at?: unknown }
    | undefined
  if (!row || typeof row.id !== 'string') return { ok: true, row: null }
  if (typeof row.status !== 'string' || DEAD_STATUSES.has(row.status)) return { ok: true, row: null }
  const output = asRecord(row.output)
  const rawChecklist = output.quality_checklist_auto
  const autoChecklist = Array.isArray(rawChecklist)
    ? (rawChecklist as ContentCheckItemResult[])
    : []
  return {
    ok: true,
    row: {
      id: row.id,
      status: row.status,
      brief: asRecord(row.brief),
      output,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
      autoChecklist,
    },
  }
}

async function queueReview(
  deps: AdmitDeps,
  data: { client_id: string; work_order_id: string; output_url: string },
): Promise<{ reviewQueued: boolean; reviewError: string | null }> {
  const send = deps.sendReview ?? sendAdmitReview
  try {
    await send(data)
    return { reviewQueued: true, reviewError: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { reviewQueued: false, reviewError: msg.slice(0, 300) }
  }
}

const CONSENT_EDITABLE_STATUSES = new Set(['in_review', 'approved', 'published'])

async function updateExistingConsent(
  supabase: SupabaseClient,
  input: AdmitInput,
  existing: ExistingAdmit,
  consent: BuiltConsent,
  deps: AdmitDeps,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!CONSENT_EDITABLE_STATUSES.has(existing.status)) {
    return {
      ok: false,
      status: 409,
      error: `consent can only be recorded while the order is in review, approved or published (now ${existing.status})`,
    }
  }
  const now = (deps.now ?? (() => new Date()))()
  const nextUpdatedAt = new Date(
    Math.max(now.getTime(), Date.parse(existing.updatedAt) + 1),
  ).toISOString()
  const { data, error } = await supabase
    .from('content_work_orders')
    .update({
      brief: { ...existing.brief, talent_consent: consent },
      updated_at: nextUpdatedAt,
    })
    .eq('id', existing.id)
    .eq('client_id', input.clientId)
    .eq('updated_at', existing.updatedAt)
    .select('id')
  if (error) return { ok: false, status: 500, error: `consent update failed: ${error.message}` }
  if (!data || data.length === 0) {
    return { ok: false, status: 409, error: 'work order changed meanwhile; refresh and retry' }
  }
  return { ok: true }
}

/** Same consent apart from when it was confirmed (a re-admit always stamps a new time). */
function sameConsent(stored: unknown, next: BuiltConsent): boolean {
  const current = readTalentConsent({ talent_consent: stored })
  if (current === null || current === 'invalid') return false
  return (
    current.status === next.status &&
    JSON.stringify(current.scope) === JSON.stringify(next.scope) &&
    current.subject === next.subject &&
    current.confirmed_by === next.confirmed_by &&
    current.evidence === next.evidence
  )
}

async function handleExistingAdmit(
  supabase: SupabaseClient,
  input: AdmitInput,
  existing: ExistingAdmit,
  consent: BuiltConsent | null,
  deps: AdmitDeps,
  publicUrl: string,
): Promise<AdmitResult> {
  let consentUpdated = false
  if (consent) {
    if (!sameConsent(existing.brief.talent_consent, consent)) {
      const updated = await updateExistingConsent(supabase, input, existing, consent, deps)
      if (!updated.ok) return updated
      consentUpdated = true
    }
  }

  let reviewQueued = false
  let reviewError: string | null = null
  if (existing.status === 'in_review' && identifiableFaceCount(existing.output) === null) {
    const review = await queueReview(deps, {
      client_id: input.clientId,
      work_order_id: existing.id,
      output_url: publicUrl,
    })
    reviewQueued = review.reviewQueued
    reviewError = review.reviewError
  }

  return {
    ok: true,
    workOrderId: existing.id,
    autoChecklist: existing.autoChecklist,
    deduped: true,
    reviewQueued,
    reviewError,
    consentUpdated,
  }
}

interface InsertArgs {
  supabase: SupabaseClient
  input: AdmitInput
  goalId: string
  masterBriefId: string
  storagePath: string
  probe: ProbeResult
  consent: BuiltConsent | null
}

async function insertAdmittedOrder(
  args: InsertArgs,
): Promise<{ ok: true; workOrderId: string; autoChecklist: ContentCheckItemResult[] } | { ok: false; status: number; error: string }> {
  const { supabase, input, goalId, masterBriefId, storagePath, probe, consent } = args
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
  return { ok: true, workOrderId: inserted.id as string, autoChecklist }
}

async function resolveGoalId(
  supabase: SupabaseClient,
  input: AdmitInput,
  client: { factory_config?: unknown },
): Promise<string | null> {
  if (input.goalId) return input.goalId
  const configGoalId = asRecord(client.factory_config)['factory_goal_id']
  if (typeof configGoalId === 'string' && UUID_RE.test(configGoalId)) return configGoalId
  const { data: goals } = await supabase
    .from('goals')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (goals?.id as string | undefined) ?? null
}

async function resolveMasterBriefId(
  supabase: SupabaseClient,
  input: AdmitInput,
): Promise<string | null> {
  if (input.masterBriefId) return input.masterBriefId
  const { data: brief } = await supabase
    .from('master_briefs')
    .select('id')
    .eq('client_id', input.clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (brief?.id as string | undefined) ?? null
}

async function downloadAndProbe(
  publicUrl: string,
  localFile: string,
): Promise<{ ok: true; probe: ProbeResult } | { ok: false; status: number; error: string }> {
  const res = await fetch(publicUrl)
  if (!res.ok || !res.body) {
    return { ok: false, status: 422, error: `failed to download video: ${res.status} ${res.statusText}` }
  }
  const dest = createWriteStream(localFile)
  // @ts-expect-error ReadableStream → NodeJS.ReadableStream bridge
  await pipeline(res.body, dest)

  if (statSync(localFile).size > ADMIT_MAX_VIDEO_BYTES) {
    return {
      ok: false,
      status: 422,
      error: 'video is larger than 80 MB; 马良 cannot review it — export a smaller file',
    }
  }

  const probe = await probeUploadedVideo(localFile)
  return { ok: true, probe }
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

  const storagePath = normalizeStoragePath(input.storagePath, input.clientId)
  if (!storagePath) {
    return {
      ok: false,
      status: 400,
      error: 'storage_path must be <client_id>/external/<file> inside the content-factory bucket',
    }
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return { ok: false, status: 500, error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/content-factory/${storagePath}`

  const existing = await findExistingAdmit(supabase, input.clientId, storagePath)
  if (!existing.ok) {
    return { ok: false, status: 500, error: `dedupe check failed: ${existing.error}` }
  }
  if (existing.row) {
    return handleExistingAdmit(supabase, input, existing.row, consent, deps, publicUrl)
  }

  const goalId = await resolveGoalId(supabase, input, client)
  if (!goalId) return { ok: false, status: 422, error: 'no active goal found for this client — pass goal_id explicitly' }

  const masterBriefId = await resolveMasterBriefId(supabase, input)
  if (!masterBriefId) return { ok: false, status: 422, error: 'no active master brief found for this client — pass master_brief_id explicitly' }

  const tempDir = mkdtempSync(join(tmpdir(), 'admit-'))
  const localFile = join(tempDir, 'video.mp4')
  try {
    const downloaded = await downloadAndProbe(publicUrl, localFile)
    if (!downloaded.ok) return downloaded

    const inserted = await insertAdmittedOrder({
      supabase,
      input,
      goalId,
      masterBriefId,
      storagePath,
      probe: downloaded.probe,
      consent,
    })
    if (!inserted.ok) return inserted

    const review = await queueReview(deps, {
      client_id: input.clientId,
      work_order_id: inserted.workOrderId,
      output_url: publicUrl,
    })

    return {
      ok: true,
      workOrderId: inserted.workOrderId,
      autoChecklist: inserted.autoChecklist,
      deduped: false,
      reviewQueued: review.reviewQueued,
      reviewError: review.reviewError,
      consentUpdated: false,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, error: `probe/insert failed: ${msg}` }
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
  }
}

function isConsentUse(v: unknown): v is ConsentUse {
  return CONSENT_USES.some((use) => use === v)
}

function parseBodyConsent(raw: unknown): { ok: true; value: AdmitInput['talentConsent'] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'talent_consent must be an object' }
  }
  const record = raw as Record<string, unknown>
  const status = record.status
  if (status !== 'granted' && status !== 'not_needed') {
    return { ok: false, error: 'talent_consent.status must be granted or not_needed' }
  }
  const scopeRaw = record.scope
  if (!Array.isArray(scopeRaw)) {
    return { ok: false, error: 'talent_consent.scope must be an array' }
  }
  const scope: ConsentUse[] = []
  for (const entry of scopeRaw) {
    if (!isConsentUse(entry)) {
      return { ok: false, error: 'talent_consent.scope has an unknown use' }
    }
    if (!scope.includes(entry)) scope.push(entry)
  }
  const subject = record.subject
  const evidence = record.evidence
  if (typeof subject !== 'string' || typeof evidence !== 'string') {
    return { ok: false, error: 'talent_consent.subject and talent_consent.evidence must be strings' }
  }
  return { ok: true, value: { status, scope, subject, evidence } }
}

/** Builds AdmitInput from a request body. confirmedBy comes from the caller (logged-in admin), never from the body; malformed talent_consent is an error, not "no consent". */
export function admitInputFromBody(
  body: Record<string, unknown>,
  confirmedBy: string,
): { ok: true; input: AdmitInput } | { ok: false; error: string } {
  const endcard = asRecord(body.endcard)
  const consent = parseBodyConsent(body.talent_consent)
  if (!consent.ok) return consent

  return {
    ok: true,
    input: {
      clientId: String(body.client_id ?? ''),
      storagePath: String(body.storage_path ?? ''),
      angle: String(body.angle ?? ''),
      rationale: String(body.rationale ?? body.angle ?? ''),
      caption: String(body.caption ?? ''),
      endcard: {
        cta: String(endcard.cta ?? ''),
        url: String(endcard.url ?? ''),
      },
      masterBriefId: typeof body.master_brief_id === 'string' ? body.master_brief_id : undefined,
      goalId: typeof body.goal_id === 'string' ? body.goal_id : undefined,
      confirmedBy,
      talentConsent: consent.value,
    },
  }
}
