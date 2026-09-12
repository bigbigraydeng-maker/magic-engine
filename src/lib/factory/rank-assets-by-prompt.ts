// 按一句画面描述,从一批已分析素材里挑最匹配的几张。
//
// 抽出这份逻辑之前,`asset-library/search` 路由(人工选图界面)和 Creatomate
// 出片管线(scene-assets.ts,自动选图)各写一份的话,任何一处改排序规则都会
// 悄悄跟另一处岔开——两个调用方现在共用同一份判断(设计复审 ⚠️ 提出的要求)。
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { canBackRealPrice, normaliseSource, type AssetSource } from '@/lib/assets/provenance'

export interface VisionMetadata {
  objects?: string[]
  scene?: string
  emotion?: string
  has_people?: boolean
  brand_elements?: string[]
  quality_score?: number
  ai_notes?: string
}

export interface RankableAsset {
  id: string
  storage_url: string | null
  original_filename: string | null
  /** 数据库读出来的原始形状,不假设一定符合 VisionMetadata(同 client-asset-pool.ts
   *  的教训:quality_score 是 jsonb 里的键,老数据/坏数据可能什么都没有)。 */
  vision_metadata: unknown
  source: unknown
}

export interface AssetPick {
  id: string
  storageUrl: string
  reason: string
  qualityScore: number
  metadata: VisionMetadata | null
  source: AssetSource
}

function visionOf(a: RankableAsset): VisionMetadata {
  return (a.vision_metadata ?? {}) as VisionMetadata
}

function scoreOf(a: RankableAsset): number {
  return visionOf(a).quality_score ?? 0
}

function toPick(a: RankableAsset, reason: string): AssetPick {
  return {
    id: a.id,
    storageUrl: a.storage_url ?? '',
    reason,
    qualityScore: scoreOf(a),
    metadata: a.vision_metadata ? visionOf(a) : null,
    source: normaliseSource(a.source),
  }
}

/**
 * 按 prompt 排序一批素材,返回 topN。
 *
 * `requireVerified: true` 时只保留能打真实价格的来源(`client_verified`/`fde_shot`,
 * 见 provenance.ts::canBackRealPrice)——出片自动选图管线必须开这个,不然免登录
 * 上传链接传进来的网图/AI 图会被自动当"客户真实照片"塞进无人审核的成片
 * (设计复审 ❌ 指出的红线风险)。人工选图界面(FDE 自己挑)不受此限,人能看见
 * 也能选未核实的图,所以那条调用路径保持 `requireVerified` 默认 false。
 */
export async function rankAssetsByPrompt(
  prompt: string,
  assets: RankableAsset[],
  topN: number,
  opts: { requireVerified?: boolean } = {},
): Promise<AssetPick[]> {
  const pool = opts.requireVerified
    ? assets.filter((a) => canBackRealPrice(a.source as string | null | undefined))
    : assets
  if (pool.length === 0) return []

  // 素材少的时候不必烧一次 LLM 调用,全给,按质量分排。
  if (pool.length <= topN) {
    return pool
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .map((a) => toPick(a, 'Closest available library photo'))
  }

  try {
    return await rankWithLlm(prompt, pool, topN)
  } catch (err: unknown) {
    console.error('[rank-assets-by-prompt] LLM ranking failed, using fallback:', err)
    return keywordFallback(prompt, pool, topN)
  }
}

// 让 GPT-4o-mini 挑最匹配的几张。模型不可用/返回不可用结果时降级关键词重叠打分。
async function rankWithLlm(prompt: string, assets: RankableAsset[], topN: number): Promise<AssetPick[]> {
  const client = getOpenAIClient()
  const candidates = assets.map((a) => ({
    id: a.id,
    filename: a.original_filename,
    scene: visionOf(a).scene,
    emotion: visionOf(a).emotion,
    objects: visionOf(a).objects ?? [],
    ai_notes: visionOf(a).ai_notes,
    quality_score: scoreOf(a),
    brand_elements: visionOf(a).brand_elements ?? [],
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
      { role: 'user', content: JSON.stringify({ image_prompt: prompt, candidates }) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(raw) as { picks?: Array<{ id?: string; reason?: string }> }
  const byId = new Map(assets.map((a) => [a.id, a]))

  const picks = (parsed.picks ?? [])
    .map((p) => {
      const asset = p.id ? byId.get(p.id) : undefined
      if (!asset) return null
      return toPick(asset, p.reason?.trim() || 'Recommended by Content Engine')
    })
    .filter((r): r is AssetPick => r !== null)
    .slice(0, topN)

  if (picks.length > 0) return picks
  return keywordFallback(prompt, assets, topN)
}

// 确定性兜底：按 prompt 与素材 objects 的名词重叠数排序，重叠数打平再按质量分。
function keywordFallback(prompt: string, assets: RankableAsset[], topN: number): AssetPick[] {
  const promptWords = new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  )

  return assets
    .map((a) => {
      const objects = visionOf(a).objects ?? []
      const overlap = objects.reduce((n, obj) => {
        const words = obj.toLowerCase().split(/[^a-z0-9]+/)
        return n + (words.some((w) => promptWords.has(w)) ? 1 : 0)
      }, 0)
      return { asset: a, overlap }
    })
    .sort((x, y) => y.overlap - x.overlap || scoreOf(y.asset) - scoreOf(x.asset))
    .slice(0, topN)
    .map(({ asset, overlap }) =>
      toPick(asset, overlap > 0 ? `Matches ${overlap} subject(s) in the prompt` : 'Best available library photo'),
    )
}
