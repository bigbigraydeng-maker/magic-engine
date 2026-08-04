// 讲课片发布执行 —— 由后台 cron 调用，不在网页请求里跑。
//
// 为什么必须放后台:发布要等 Facebook 把几十 MB 视频从我们的存储拉过去，
// 这一步可能好几分钟；塞在网页请求里会被网关掐断
// (真实事故 2026-08-04:PM 点按钮拿到 HTTP 502,那不是我们的报错,是超时)。

import { supabaseAdmin } from '@/lib/supabase'
import { facebookReelAdapter } from './publish/facebook-reel-adapter'
import type { PublishTarget } from './types'
import { loadLecturePost, recordPublished, setPublishRequest } from './lecture-post'

/** 把接口报错翻成客户能行动的话(原始报错留日志给我们排查)。 */
export function humanPublishError(raw: string): string {
  if (raw.includes('页名')) return '发布被拦住了：目标主页跟这个客户对不上 — 联系我们确认发到哪个主页'
  if (/META_SYSTEM_USER_TOKEN|access_token|token/i.test(raw)) return 'Facebook 授权没配好 — 联系我们处理'
  if (/permission|OAuth|#200|#10/i.test(raw)) return 'Facebook 权限不够（可能没开发视频的权限）— 联系我们处理'
  if (/file_url|upload/i.test(raw)) return 'Facebook 拉取视频失败 — 稍后再试一次；反复失败联系我们'
  return '发布没成功 — 稍后再试一次；反复失败请联系我们'
}

export interface PublishOutcome {
  postId: string
  ok: boolean
  draft?: boolean
  error?: string
}

/** 处理一条待发布请求。成功失败都回写，绝不静默。 */
export async function runOneLecturePublish(params: {
  clientId: string
  postId: string
}): Promise<PublishOutcome> {
  const { clientId, postId } = params
  const loaded = await loadLecturePost(clientId, postId)
  if (!loaded) return { postId, ok: false, error: '未找到该讲' }

  await setPublishRequest({
    clientId, postId,
    request: { platform: 'facebook', status: 'sending', requestedAt: loaded.publishRequest?.requestedAt ?? new Date().toISOString(), startedAt: new Date().toISOString() },
  })

  try {
    if (!loaded.post.source_video_url) throw new Error('还没有成片')
    const { data: client } = await supabaseAdmin
      .from('clients').select('factory_config').eq('id', clientId).single()
    const target = (client?.factory_config as { publish_target?: PublishTarget } | null)?.publish_target
    if (!target?.page_id) throw new Error('没配 publish_target.page_id')

    // 安全阀:没显式开 FACTORY_PUBLISH_LIVE 就只发草稿(主页后台可见、公众看不到)
    const draft = process.env.FACTORY_PUBLISH_LIVE !== 'true'
    const ref = await facebookReelAdapter.publish({
      videoUrl: loaded.post.source_video_url,
      caption: loaded.lecture.ctaVariants?.fbTiktok ?? loaded.lecture.title,
      target,
      idempotencyTag: postId,
      draft,
    })

    await recordPublished({
      clientId, postId,
      entry: {
        platform: 'facebook',
        pageId: ref.page_id ?? target.page_id,
        videoId: ref.video_id ?? ref.post_id ?? '',
        permalink: ref.permalink,
        draft,
        at: new Date().toISOString(),
      },
    })
    await setPublishRequest({ clientId, postId, request: null })   // 发完清掉请求
    return { postId, ok: true, draft }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    console.error(`[lecture-publish] ${postId} 失败:`, raw)
    await setPublishRequest({
      clientId, postId,
      request: {
        platform: 'facebook',
        status: 'failed',
        requestedAt: loaded.publishRequest?.requestedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: humanPublishError(raw),
      },
    }).catch(() => { /* 回写失败也别把异常吞了 */ })
    return { postId, ok: false, error: humanPublishError(raw) }
  }
}

/** 扫出所有待发布的讲课片(pending)，逐条发。一次最多 3 条，防单次 cron 超时。 */
export async function runLecturePublishSweep(): Promise<{ handled: PublishOutcome[] }> {
  const { data } = await supabaseAdmin
    .from('content_posts')
    .select('id, client_id, generation_context_snapshot')
    .eq('format', '讲课式')
    .not('generation_context_snapshot->lecture_publish_request', 'is', null)
    .limit(20)

  const pending = (data ?? []).filter((p) => {
    const req = (p.generation_context_snapshot as { lecture_publish_request?: { status?: string } } | null)?.lecture_publish_request
    return req?.status === 'pending'
  }).slice(0, 3)

  const handled: PublishOutcome[] = []
  for (const p of pending) {
    handled.push(await runOneLecturePublish({ clientId: p.client_id as string, postId: p.id as string }))
  }
  return { handled }
}
