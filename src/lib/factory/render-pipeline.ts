// 🔴 已退役(2026-09-02，render.yaml 同一条注释)：跟 render-assemble.ts 同一条旧
// ffmpeg 拼片管线，已停机不再被任何 worker 调用。留仓库不删，不要当活代码维护——
// 出片现在走 Creatomate 链(scene-assets.ts)。
//
// 做片编排 — 把一条排队任务跑成成片素材：分镜 → 逐段出画面+配音 → 交给拼接。
// 由后台 worker 调用（i2v 慢，跑 15-30 分钟，不能塞进普通请求）。
// 拼接(ffmpeg)是容器里单独一步(assembleJob，见 render-assemble)，本文件只管到「待拼接」。

import { supabaseAdmin } from '@/lib/supabase'
import { planScenes, type Scene } from './scene-plan'
import { generateBrollClip } from './broll-clip'
import { generateVoiceover } from '@/lib/audio/minimax-voice'

export interface SceneAsset {
  index: number
  voText: string
  captionText: string
  clipUrl: string
  voUrl: string
}

async function patchJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw error
}

/** 读该客户在 factory_config.render.voice_id 里配的克隆声音。没配就报错(别静默用错音)。 */
function resolveVoiceId(factoryConfig: unknown): string {
  const v = (factoryConfig as { render?: { voice_id?: string } } | null)?.render?.voice_id
  if (!v || typeof v !== 'string') {
    throw new Error('该客户未配置配音声音（clients.factory_config.render.voice_id）')
  }
  return v
}

/**
 * 跑一条任务的「生成」阶段：分镜 → 逐段画面+配音 → 落库，状态推到 assembling。
 * 返回各段素材（供拼接步用）。任何失败标 failed + 记 error。
 */
export async function runRenderGeneration(jobId: string): Promise<{ scenes: SceneAsset[] }> {
  const { data: job, error: jErr } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id, status')
    .eq('id', jobId)
    .single()
  if (jErr || !job) throw new Error(`render job not found: ${jobId}`)

  try {
    await patchJob(jobId, { status: 'planning', error: null })

    // 1) 取选题稿 + 客户配置
    const { data: post, error: pErr } = await supabaseAdmin
      .from('content_posts')
      .select('id, title, script')
      .eq('client_id', job.client_id)
      .eq('id', job.content_post_id)
      .single()
    if (pErr || !post) throw new Error('选题内容未找到')
    if (!post.script?.trim()) throw new Error('选题没有逐字稿，无法做片')

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('factory_config')
      .eq('id', job.client_id)
      .single()
    const voiceId = resolveVoiceId(client?.factory_config)

    // 2) 分镜
    const { scenes } = await planScenes({
      clientId: job.client_id as string,
      title: post.title ?? '',
      script: post.script,
    })
    await patchJob(jobId, { status: 'rendering', scenes })

    // 3) 逐段出画面 + 配音（每段画面和配音并行；段间串行，控成本/并发）
    const assets: SceneAsset[] = []
    let cost = 0
    for (const s of scenes as Scene[]) {
      const [clip, vo] = await Promise.all([
        generateBrollClip({
          clientId: job.client_id as string,
          imagePrompt: s.imagePrompt,
          motionPrompt: s.motionPrompt,
          folder: `render/${jobId}`,
        }),
        generateVoiceover({
          clientId: job.client_id as string,
          text: s.voText,
          voiceId,
          folder: `render/${jobId}`,
        }),
      ])
      cost += (clip.costUsd ?? 0) + (vo.costUsd ?? 0)
      assets.push({
        index: s.index,
        voText: s.voText,
        captionText: s.captionText,
        clipUrl: clip.clipUrl,
        voUrl: vo.audioUrl,
      })
    }

    // 4) 落库，交给拼接步
    await patchJob(jobId, {
      status: 'assembling',
      clip_urls: assets.map((a) => a.clipUrl),
      vo_urls: assets.map((a) => a.voUrl),
      cost_usd: cost,
    })

    return { scenes: assets }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await patchJob(jobId, { status: 'failed', error: message }).catch(() => {})
    throw e
  }
}
