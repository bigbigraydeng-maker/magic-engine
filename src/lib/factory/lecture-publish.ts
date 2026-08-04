// 讲课片发布执行 —— 由后台 cron 调用，不在网页请求里跑。
//
// 为什么必须放后台:发布要等 Facebook 把几十 MB 视频从我们的存储拉过去，
// 这一步可能好几分钟；塞在网页请求里会被网关掐断
// (真实事故 2026-08-04:PM 点按钮拿到 HTTP 502,那不是我们的报错,是超时)。

import { supabaseAdmin } from '@/lib/supabase'
import { facebookReelAdapter, promoteReelToPublished } from './publish/facebook-reel-adapter'
import type { PublishTarget } from './types'
import { loadLecturePost, recordPublished, setPublishRequest } from './lecture-post'

/** 把接口报错翻成客户能行动的话(原始报错留日志给我们排查)。 */
export function humanPublishError(raw: string): string {
  if (raw.includes('页名')) return '发布被拦住了：目标主页跟这个客户对不上 — 联系我们确认发到哪个主页'
  // 这条要说清「去哪点什么」——只说「授权没配好」是个死胡同,人拿到了也不知道下一步做什么
  if (/还没连过 Meta|no_page_token/i.test(raw)) {
    return '这个主页还没连过 Facebook — 去客户设置里点一次「连接 Meta」，用能管理这个主页的账号授权，之后不用再管'
  }
  if (/permission|OAuth|#200|#10|pages_manage_posts/i.test(raw)) {
    return 'Facebook 说权限不够（发主页内容的权限没给）— 去客户设置里重新点一次「连接 Meta」，授权页面上的勾要全部保留'
  }
  if (/META_SYSTEM_USER_TOKEN|access_token|token/i.test(raw)) return 'Facebook 授权没配好 — 联系我们处理'
  if (/file_url|upload/i.test(raw)) return 'Facebook 拉取视频失败 — 稍后再试一次；反复失败联系我们'
  return '发布没成功 — 稍后再试一次；反复失败请联系我们'
}

export interface PublishOutcome {
  postId: string
  ok: boolean
  draft?: boolean
  error?: string
  /** 这一轮什么都没发——之前已经发过了。留在运行记录里,重复触发看得见。 */
  alreadyPublished?: boolean
}

/** 处理一条待发布请求。成功失败都回写，绝不静默。 */
export async function runOneLecturePublish(params: {
  clientId: string
  postId: string
}): Promise<PublishOutcome> {
  const { clientId, postId } = params
  const loaded = await loadLecturePost(clientId, postId)
  if (!loaded) return { postId, ok: false, error: '未找到该讲' }

  // 这一条要真发还是只发草稿。每条片自己带(审片通过是针对这一条的决定),
  // 全局环境开关只当兜底默认值——它一开会把所有客户都变成真发,不该拿它当日常开关。
  const live = loaded.publishRequest?.live === true || process.env.FACTORY_PUBLISH_LIVE === 'true'
  const draft = !live

  // 🔴 本地防重发闸。发布是不可逆的对外动作,「宁可漏发一次让人再点,也不能重复发」。
  // 真实事故(2026-08-04):同一条讲课片被连发三次——上游读到过期状态就会反复触发,
  // 而这里当时对「已经发过了」毫无察觉,来一次发一次。
  // 注意只在「已经是要的那个状态」时才拦:草稿→公开是一次正当的状态推进,不能被当成重发挡掉。
  const already = loaded.published.find((p) => p.platform === 'facebook')
  if (already && already.draft === draft) {
    await setPublishRequest({ clientId, postId, request: null })
    return { postId, ok: true, draft: already.draft, alreadyPublished: true }
  }

  await setPublishRequest({
    clientId, postId,
    request: { platform: 'facebook', status: 'sending', requestedAt: loaded.publishRequest?.requestedAt ?? new Date().toISOString(), startedAt: new Date().toISOString() },
  })

  try {
    if (!loaded.post.source_video_url) throw new Error('还没有成片')
    const { data: client } = await supabaseAdmin
      .from('clients').select('factory_config').eq('id', clientId).single()
    const stored = (client?.factory_config as { publish_target?: PublishTarget } | null)?.publish_target
    if (!stored?.page_id) throw new Error('没配 publish_target.page_id')
    // client_id 不存在配置里,发的时候补上——adapter 靠它去取「连接 Meta」存下的页 token
    const target: PublishTarget = { ...stored, client_id: clientId }

    // 第二道闸:问平台侧「这条片我是不是已经发过了」。本地回执万一没写成(写库失败、
    // 被旧快照覆盖),就靠这一问兜住,绝不重复上传一遍。查不动不算「没发过」——
    // 查询本身出错时保持保守,直接报错让人再点,而不是闷头再发一次。
    const existing = await facebookReelAdapter.findExisting({ target, idempotencyTag: postId })

    // 主页上已经有这条片了。要真发就把那条草稿直接转正,**绝不重新上传** ——
    // 重传会在主页上留下一草稿一正式两条,每条片都要人去删一次。
    if (existing && live) {
      const promoted = await promoteReelToPublished({
        target,
        videoId: existing.video_id ?? existing.post_id,
      })
      await recordPublished({
        clientId, postId,
        entry: {
          platform: 'facebook',
          pageId: promoted.page_id ?? target.page_id,
          videoId: promoted.video_id ?? promoted.post_id,
          permalink: promoted.permalink,
          draft: false,
          at: promoted.published_at,
        },
      })
      await setPublishRequest({ clientId, postId, request: null })
      return { postId, ok: true, draft: false }
    }

    // 已经有了、而且只要草稿 → 什么都不做,只把回执补回来
    if (existing) {
      await recordPublished({
        clientId, postId,
        entry: {
          platform: 'facebook',
          pageId: existing.page_id ?? target.page_id,
          videoId: existing.video_id ?? existing.post_id ?? '',
          permalink: existing.permalink,
          draft: true,
          at: existing.published_at ?? new Date().toISOString(),
        },
      })
      await setPublishRequest({ clientId, postId, request: null })
      return { postId, ok: true, draft: true, alreadyPublished: true }
    }

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

/**
 * 卡在「发送中」多久算死掉、可以重来。
 * 发布慢是常态(Facebook 自己去拉几十 MB)，但超过这个时间基本是进程被掐了——
 * 不重试的话这条片会永远停在「发送中」，页面上看起来像还在跑，其实没人管它。
 */
const STALE_SENDING_MS = 20 * 60 * 1000

interface SweepRow {
  id: string
  client_id: string
  generation_context_snapshot: {
    lecture_publish_request?: { status?: string; startedAt?: string } | null
  } | null
}

/**
 * 挑出这一轮该发的片(纯逻辑，好测)。
 * ①pending = 客户刚点了发布 ②sending 但卡太久 = 上一轮被掐断，重来一次。
 */
export function selectPendingPublishes(
  rows: SweepRow[],
  nowMs: number,
  max: number,
): SweepRow[] {
  return rows.filter((p) => {
    const req = p.generation_context_snapshot?.lecture_publish_request
    if (req?.status === 'pending') return true
    if (req?.status === 'sending') {
      const started = req.startedAt ? Date.parse(req.startedAt) : NaN
      // 时间读不出来也当卡死处理——宁可重发一次(有幂等标记兜着)，也不要永远挂在那
      return !Number.isFinite(started) || nowMs - started > STALE_SENDING_MS
    }
    return false
  }).slice(0, Math.max(0, max))
}

/**
 * 扫出待发布的讲课片，逐条发。
 * max 默认 1 —— 这个扫描是搭在 factory-publish-worker 那条 cron 上跑的(它每 10 分钟一轮、
 * 密钥已经配好)，跟工单发布共用同一个 300 秒预算，所以一轮只发一条，别把预算吃光。
 */
export async function runLecturePublishSweep(
  opts: { max?: number } = {},
): Promise<{ handled: PublishOutcome[] }> {
  const { data } = await supabaseAdmin
    .from('content_posts')
    .select('id, client_id, generation_context_snapshot')
    .eq('format', '讲课式')
    .not('generation_context_snapshot->lecture_publish_request', 'is', null)
    .limit(20)

  const due = selectPendingPublishes((data ?? []) as SweepRow[], Date.now(), opts.max ?? 1)

  const handled: PublishOutcome[] = []
  for (const p of due) {
    handled.push(await runOneLecturePublish({ clientId: p.client_id, postId: p.id }))
  }
  return { handled }
}
