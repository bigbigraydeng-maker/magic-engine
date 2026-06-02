import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 6

// A single analysed asset row, trimmed to what ranking + the UI needs.
interface AnalyzedAsset {
  id: string
  storage_url: string | null
  original_filename: string | null
  vision_metadata: VisionMetadata | null
}

interface VisionMetadata {
  objects?: string[]
  scene?: string
  emotion?: string
  has_people?: boolean
  brand_elements?: string[]
  quality_score?: number
  ai_notes?: string
}

interface Recommendation {
  id: string
  storage_url: string
  original_filename: string | null
  reason: string
  quality_score: number
  metadata: VisionMetadata | null
}

// POST /api/clients/[id]/asset-library/search
// Ranks a client's analysed photo library against an image-generation prompt
// and returns the top N matches, so the Social Plan Studio can offer
// "pick from library" instead of generating a fresh image.
// Body: { image_prompt: string, limit?: number }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { image_prompt, limit = DEFAULT_LIMIT } = (await req.json()) as {
      image_prompt?: string
      limit?: number
    }

    if (!image_prompt || !image_prompt.trim()) {
      return NextResponse.json(
        { success: false, error: 'image_prompt required' },
        { status: 400 },
      )
    }

    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const topN = clampLimit(limit)

    const { data, error } = await supabaseAdmin
      .from('client_assets')
      .select('id, storage_url, original_filename, vision_metadata')
      .eq('client_id', params.id)
      .eq('status', 'analyzed')
      .is('archived_at', null)
      .not('storage_url', 'is', null)

    if (error) throw error

    const assets = (data ?? []) as AnalyzedAsset[]

    // Small library: skip the LLM, return everything (best quality first).
    if (assets.length <= topN) {
      return NextResponse.json({
        success: true,
        recommendations: assets
          .slice()
          .sort((a, b) => scoreOf(b) - scoreOf(a))
          .map((a) => toRecommendation(a, 'Closest available library photo')),
      })
    }

    const picks = await rankWithLlm(image_prompt.trim(), assets, topN)
    return NextResponse.json({ success: true, recommendations: picks })
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : (err as Record<string, unknown>)?.message as string | undefined ?? 'Unknown error'
    console.error('[clients/asset-library/search POST]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT
  return Math.min(20, Math.floor(limit))
}

function scoreOf(a: AnalyzedAsset): number {
  return a.vision_metadata?.quality_score ?? 0
}

function toRecommendation(a: AnalyzedAsset, reason: string): Recommendation {
  return {
    id: a.id,
    storage_url: a.storage_url ?? '',
    original_filename: a.original_filename,
    reason,
    quality_score: scoreOf(a),
    metadata: a.vision_metadata,
  }
}

// Ask GPT-4o-mini to pick the best matches. Falls back to keyword overlap
// scoring if the model is unavailable or returns an unusable response.
async function rankWithLlm(
  prompt: string,
  assets: AnalyzedAsset[],
  topN: number,
): Promise<Recommendation[]> {
  try {
    const client = getOpenAIClient()
    const candidates = assets.map((a) => ({
      id: a.id,
      filename: a.original_filename,
      scene: a.vision_metadata?.scene,
      emotion: a.vision_metadata?.emotion,
      objects: a.vision_metadata?.objects ?? [],
      ai_notes: a.vision_metadata?.ai_notes,
      quality_score: scoreOf(a),
      brand_elements: a.vision_metadata?.brand_elements ?? [],
    }))

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Given an image generation prompt and a library of analyzed photos with structured metadata, ' +
            `return the top ${topN} most relevant photos for the prompt. ` +
            'Reply JSON only in the shape {"picks":[{"id":string,"reason":string}]}. ' +
            'Order picks best-first. reason is one short sentence on why the photo fits the prompt.',
        },
        {
          role: 'user',
          content: JSON.stringify({ image_prompt: prompt, candidates }),
        },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw) as { picks?: Array<{ id?: string; reason?: string }> }
    const byId = new Map(assets.map((a) => [a.id, a]))

    const picks = (parsed.picks ?? [])
      .map((p) => {
        const asset = p.id ? byId.get(p.id) : undefined
        if (!asset) return null
        return toRecommendation(asset, p.reason?.trim() || 'Recommended by Content Engine')
      })
      .filter((r): r is Recommendation => r !== null)
      .slice(0, topN)

    if (picks.length > 0) return picks
    return keywordFallback(prompt, assets, topN)
  } catch (err: unknown) {
    console.error('[asset-library/search] LLM ranking failed, using fallback:', err)
    return keywordFallback(prompt, assets, topN)
  }
}

// Deterministic fallback: rank by noun overlap between the prompt and each
// asset's detected objects, breaking ties on quality_score.
function keywordFallback(
  prompt: string,
  assets: AnalyzedAsset[],
  topN: number,
): Recommendation[] {
  const promptWords = new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  )

  return assets
    .map((a) => {
      const objects = a.vision_metadata?.objects ?? []
      const overlap = objects.reduce((n, obj) => {
        const words = obj.toLowerCase().split(/[^a-z0-9]+/)
        return n + (words.some((w) => promptWords.has(w)) ? 1 : 0)
      }, 0)
      return { asset: a, overlap }
    })
    .sort((x, y) => y.overlap - x.overlap || scoreOf(y.asset) - scoreOf(x.asset))
    .slice(0, topN)
    .map(({ asset, overlap }) =>
      toRecommendation(
        asset,
        overlap > 0 ? `Matches ${overlap} subject(s) in the prompt` : 'Best available library photo',
      ),
    )
}
