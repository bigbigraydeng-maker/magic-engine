// Seedance 2.0 Video Generation Client
// Via Atlas Cloud API — Fast mode (text-to-video / image-to-video)
// 异步生成，需轮询状态

const ATLAS_BASE = 'https://api.atlascloud.ai/api/v1'
const API_KEY = process.env.ATLAS_CLOUD_API_KEY!

// Cost per second by resolution (USD). 720p is the baseline Atlas rate.
const COST_PER_SECOND: Record<string, number> = {
  '480p': 0.014,
  '720p': 0.022,
  '1080p': 0.044,
}

export function videoCostUsd(durationSeconds: number, resolution: string): number {
  return durationSeconds * (COST_PER_SECOND[resolution] ?? 0.022)
}

export interface VideoJobResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

export async function submitVideoGeneration(params: {
  prompt: string
  duration?: number
  resolution?: '480p' | '720p' | '1080p'
  aspect_ratio?: '9:16' | '16:9' | '1:1'
}): Promise<{ job_id: string }> {
  const {
    prompt,
    duration = 6,
    resolution = '720p',
    aspect_ratio = '9:16',
  } = params

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'bytedance/seedance-2.0-fast/text-to-video',
        prompt,
        duration,
        resolution,
        ratio: aspect_ratio,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Seedance submit error ${res.status}: ${err}`)
    }

    const data = await res.json()
    const job_id = data.data?.id ?? data.id
    if (!job_id) {
      throw new Error('Seedance returned no job ID — response may be incomplete')
    }
    return { job_id }
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkVideoStatus(jobId: string): Promise<VideoJobResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(`${ATLAS_BASE}/model/prediction/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`Seedance status error: ${res.status}`)

    const data = await res.json()
    const d = data.data ?? data

    return {
      job_id: jobId,
      status: mapStatus(d?.status),
      video_url: d?.outputs?.[0],
      duration_seconds: d?.duration,
      cost_usd: d?.duration ? videoCostUsd(d.duration, d?.resolution ?? '720p') : undefined,
      error: d?.error || undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Submit an Image-to-Video generation job.
 * Requires two reference frame URLs (opening + closing).
 * Uses bytedance/seedance-2.0-fast/image-to-video on Atlas Cloud.
 * Reference: ROADMAP.md P8.R.4
 */
export async function submitI2VGeneration(params: {
  prompt: string
  opening_frame_url: string
  closing_frame_url: string
  duration?: number
  resolution?: '480p' | '720p' | '1080p'
  aspect_ratio?: '9:16' | '16:9' | '1:1'
  generate_audio?: boolean
}): Promise<{ job_id: string }> {
  const {
    prompt,
    opening_frame_url,
    closing_frame_url,
    duration = 15,
    resolution = '720p',
    aspect_ratio = '9:16',
    generate_audio = false,
  } = params

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'bytedance/seedance-2.0-fast/image-to-video',
        prompt,
        duration,
        resolution,
        ratio: aspect_ratio,
        // Atlas I2V: first_frame_image + last_frame_image
        first_frame_image: opening_frame_url,
        last_frame_image: closing_frame_url,
        generate_audio,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Seedance I2V submit error ${res.status}: ${err}`)
    }

    const data = await res.json()
    const job_id = data.data?.id ?? data.id
    if (!job_id) {
      throw new Error('Seedance I2V returned no job ID — response may be incomplete')
    }
    return { job_id }
  } finally {
    clearTimeout(timeout)
  }
}

function mapStatus(raw?: string): VideoJobResult['status'] {
  const map: Record<string, VideoJobResult['status']> = {
    created: 'pending',
    queued: 'pending',
    processing: 'processing',
    running: 'processing',
    succeeded: 'completed',
    completed: 'completed',
    failed: 'failed',
    error: 'failed',
  }
  return map[raw || ''] || 'pending'
}
