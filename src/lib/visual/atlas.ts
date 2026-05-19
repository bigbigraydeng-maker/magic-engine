// Atlas Cloud Image Generation Client (Flux-dev)
// Used by Reels frame generation. Content images now use openai-images.ts.

const ATLAS_BASE = 'https://api.atlascloud.ai/api/v1'
const API_KEY = process.env.ATLAS_CLOUD_API_KEY!

export interface ImageJobResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  image_url?: string
  cost_usd?: number
  error?: string
}

export async function submitImageGeneration(params: {
  prompt: string
  width?: number
  height?: number
}): Promise<{ job_id: string }> {
  const { prompt, width = 1024, height = 1024 } = params

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${ATLAS_BASE}/model/generateImage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'black-forest-labs/flux-dev',
        prompt,
        width,
        height,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Atlas image submit error ${res.status}: ${err}`)
    }

    const data = await res.json()
    const job_id = data.data?.id
    if (!job_id) {
      throw new Error('Atlas returned no job ID — response may be incomplete')
    }
    return { job_id }
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkImageStatus(jobId: string): Promise<ImageJobResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${ATLAS_BASE}/model/prediction/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`Atlas image status error: ${res.status}`)

    const data = await res.json()
    const d = data.data

    return {
      job_id: jobId,
      status: mapStatus(d?.status),
      image_url: d?.outputs?.[0],
      cost_usd: 0.02,
      error: d?.error || undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function mapStatus(raw?: string): ImageJobResult['status'] {
  const map: Record<string, ImageJobResult['status']> = {
    created: 'pending',
    processing: 'processing',
    succeeded: 'completed',
    completed: 'completed',
    failed: 'failed',
  }
  return map[raw || ''] || 'pending'
}
