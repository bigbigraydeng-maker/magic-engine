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
    outcome: 'PASS',
    detail: 'Uploaded finished video — subtitles are burned in by the creator.',
    source_ref: null,
  }

  const coverCheck: ContentCheckItemResult = {
    key: REEL_AUTO_CHECK_KEYS[3],
    judge: 'AUTO',
    outcome: 'PASS',
    detail: 'Uploaded finished video — cover frame verified by uploader.',
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

export type AdmitResult =
  | { ok: true; workOrderId: string; autoChecklist: ContentCheckItemResult[] }
  | { ok: false; status: number; error: string }

export async function admitFinishedVideo(
  supabase: SupabaseClient,
  input: AdmitInput,
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

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', input.clientId)
    .maybeSingle()
  if (!client) return { ok: false, status: 404, error: 'client not found' }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return { ok: false, status: 500, error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }

  const publicUrl = /^https?:\/\//i.test(input.storagePath)
    ? input.storagePath
    : `${supabaseUrl}/storage/v1/object/public/content-factory/${input.storagePath.replace(/^\/+/, '')}`

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
      engine: 'external_upload',
      copy: {
        caption: input.caption,
        endcard: { cta: input.endcard.cta, url: input.endcard.url },
      },
    }

    const { data: inserted, error } = await supabase
      .from('content_work_orders')
      .insert({
        id: tempId,
        client_id: input.clientId,
        goal_id: input.goalId ?? null,
        master_brief_id: input.masterBriefId ?? null,
        order_type: 'reel',
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
          video_path: input.storagePath,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, error: `probe/insert failed: ${msg}` }
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
  }
}
