// 场景素材准备（spec §4.3a）——不是新生成逻辑，是把 render-pipeline.ts/broll-clip.ts
// 已有的无状态函数按新顺序编排一次，喂给 Creatomate 当 modifications 的数据源。
// Creatomate 只取代 render-assemble.ts 的 ffmpeg 拼接，不取代这一层。
//
// 2026-09 真实照片接线（子牙+魏征设计复审通过后落地）：每个镜头先按 imagePrompt
// 去客户真实素材池里找匹配的真实照片(只认 client_verified/fde_shot 来源，见
// client-asset-pool.ts::RankableAssetRow 的 requireVerified 说明)，命中就直接
// 用那张真实照片，不再现画/不再重画——画面的"动"来自 Creatomate 模板本身给该
// 图片槽位配置好的入场/推拉动画（填槽不造槽，spec §1/§2），ME 这边不实现 Ken
// Burns。⚠️ 这一步只保证"喂进去的是真照片"，不保证"模板真的给这个槽位配了动画"
// ——后者是模板作者在 Creatomate 编辑器里的人工职责，必须过 CLAUDE.md 既有的
// "出片前分镜自检表"逐镜确认，不能假设"能配=已配"（子牙设计复审 ⚠️ 明确指出
// 这是设计缺口，不是代码能自动验证的东西）。
// 素材库里没有匹配的真实照片（已知空白，如西藏/长江三峡）才回退到原有的
// AI 现画（generateImage）+ classifyRenderMode 判断 i2v 还是静图这条路径。
import { planScenes, type Scene } from '@/lib/factory/scene-plan'
import { classifyRenderMode } from '@/lib/factory/shot-guards'
import { imageToClip } from '@/lib/factory/broll-clip'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { generateVoiceover } from '@/lib/audio/minimax-voice'
import { loadRankableClientAssets } from '@/lib/factory/client-asset-pool'
import { rankAssetsByPrompt } from '@/lib/factory/rank-assets-by-prompt'
import { supabaseAdmin } from '@/lib/supabase'

export interface PreparedScene {
  index: number
  captionText: string
  visualUrl: string
  visualType: 'image' | 'video'
  voUrl: string
  costUsd: number
  /** 'real_photo' = 素材库里的真实照片；'ai_generated' = 素材库没匹配，回退现画。
   *  供出片记录/人工分镜自检表用——不是代码能替代人工确认动态效果的手段。 */
  visualSource: 'real_photo' | 'ai_generated'
}

/** 复用 render-pipeline.ts 同款读法（clients.factory_config.render.voice_id），刻意不 import
 *  render-pipeline.ts 本身——那个文件保持不动、不被这条新路径依赖（spec §4.1 的边界）。 */
function resolveVoiceId(factoryConfig: unknown): string {
  const v = (factoryConfig as { render?: { voice_id?: string } } | null)?.render?.voice_id
  if (!v || typeof v !== 'string') {
    throw new Error('该客户未配置配音声音（clients.factory_config.render.voice_id）')
  }
  return v
}

/** 素材池行形状够用就行，避免整个模块 import RankableAssetRow 只为传参。 */
type RealPhotoPool = Awaited<ReturnType<typeof loadRankableClientAssets>>

async function pickRealPhoto(
  scene: Scene,
  pool: RealPhotoPool,
): Promise<{ url: string; costUsd: number } | null> {
  if (pool.length === 0) return null
  // requireConfidentMatch：选不准（跟 prompt 一个关键词都对不上）宁可返回没有匹配,
  // 走回下面的 AI 现画兜底,也不要把猜错的真实照片当"匹配成功"直接发布
  // （2026-09-14 实测：素材库有对的故宫/兵马俑照片,排序器还是选了文不对题的）。
  const [pick] = await rankAssetsByPrompt(scene.imagePrompt, pool, 1, {
    requireVerified: true,
    requireConfidentMatch: true,
  })
  if (!pick || !pick.storageUrl) return null
  return { url: pick.storageUrl, costUsd: 0 }
}

async function prepareOneScene(
  clientId: string,
  jobId: string,
  voiceId: string,
  scene: Scene,
  realPhotoPool: RealPhotoPool,
): Promise<PreparedScene> {
  const folder = `render/${jobId}`

  const [visual, vo] = await Promise.all([
    (async (): Promise<{ url: string; type: 'image' | 'video'; costUsd: number; source: 'real_photo' | 'ai_generated' }> => {
      // 真实照片优先（三层架构冻结决策：有真实素材直接用，不够才走图生）。命中
      // 就直接喂真图给 Creatomate，不再现画/不再走 imageToClip 重画——真图的
      // "动"由 Creatomate 模板本身的槽位动画负责，见文件头注。
      const realPhoto = await pickRealPhoto(scene, realPhotoPool)
      if (realPhoto) {
        return { url: realPhoto.url, type: 'image', costUsd: realPhoto.costUsd, source: 'real_photo' }
      }

      // 素材库没有匹配的真实照片（已知空白地标）——回退到原有 AI 现画路径。
      const decision = classifyRenderMode(scene.imagePrompt)
      const { b64 } = await generateImage({ prompt: scene.imagePrompt, aspect_ratio: '9:16' })
      const img = await uploadFromBase64({ base64: b64, clientId, assetType: 'image', folder })

      if (decision.mode === 'real_pixel') {
        return { url: img.storage_url, type: 'image', costUsd: 0, source: 'ai_generated' }
      }
      const clip = await imageToClip({
        clientId,
        imageUrl: img.storage_url,
        motionPrompt: scene.motionPrompt,
        folder,
      })
      return { url: clip.clipUrl, type: 'video', costUsd: clip.costUsd, source: 'ai_generated' }
    })(),
    generateVoiceover({ clientId, text: scene.voText, voiceId, folder }),
  ])

  return {
    index: scene.index,
    captionText: scene.captionText,
    visualUrl: visual.url,
    visualType: visual.type,
    voUrl: vo.audioUrl,
    costUsd: visual.costUsd + (vo.costUsd ?? 0),
    visualSource: visual.source,
  }
}

/** 分镜 → 逐镜出画面（真实照片优先，没有匹配才现画，按 classifyRenderMode 判断走
 *  i2v 还是真实像素）+ 配音。段间串行，控成本/并发（对齐 render-pipeline.ts 现有
 *  节奏，不是新规矩）。
 *
 *  projectId/listingId：出片对象楼盘/房源隔离，透传给 client-asset-pool.ts（同一
 *  套隔离口径）。CTS 是旅游客户，两者都传 null——显式传，不是漏传（子牙设计
 *  复审 ❌ 指出：这条共享链路此前完全没接这两个参数，Roman 那类地产客户接入
 *  时会跨房源串真实照片）。 */
export async function prepareSceneAssets(params: {
  clientId: string
  jobId: string
  title: string
  script: string
  factoryConfig: unknown
  projectId?: string | null
  listingId?: string | null
}): Promise<PreparedScene[]> {
  const { clientId, jobId, title, script, factoryConfig, projectId = null, listingId = null } = params
  const voiceId = resolveVoiceId(factoryConfig)
  const { scenes } = await planScenes({ clientId, title, script })
  const realPhotoPool = await loadRankableClientAssets(clientId, supabaseAdmin, projectId, listingId)

  const prepared: PreparedScene[] = []
  for (const scene of scenes) {
    prepared.push(await prepareOneScene(clientId, jobId, voiceId, scene, realPhotoPool))
  }
  return prepared
}
