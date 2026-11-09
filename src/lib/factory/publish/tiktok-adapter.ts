import { snapshotReviewedTikTokVideo, storedTikTokSourcePath } from '@/lib/tiktok/publish-source'
import { inspectTikTokVideo } from '@/lib/tiktok/video-proof'
import { validateReview, type CreatorInfo, type PostReview } from '@/lib/tiktok/post-review'
/**
 * TikTok 发布 —— Content Posting API(直接发布)。
 *
 * 服务端成片通过已验证 URL 前缀让 TikTok 拉取。用户确认后先固化核验过的字节，
 * 防止审核预览与平台拉取之间的原始文件覆盖；副本不在 init 后删除。
 *
 * ⚠️ 应用没过 TikTok 审核之前,发出去的片子一律只有作者自己可见 —— 这是 TikTok 定的,
 * 不是我们的开关。所以「发成功了」和「别人看得到」在过审前是两件事,界面上必须说清楚。
 */

import { getValidTikTokToken } from '@/lib/tiktok/token'

const API = 'https://open.tiktokapis.com/v2'

/** 分块大小 10MB。TikTok 要求 5MB-64MB,取中间值:块太小请求次数多,太大一次失败重传的代价高。 */
export const CHUNK_SIZE = 10 * 1024 * 1024

export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' | 'FOLLOWER_OF_CREATOR' | 'MUTUAL_FOLLOW_FRIENDS'

export interface TikTokPublishResult {
  publishId: string
  /** 实际用的可见级别 —— 未过审时会被降级成「仅自己可见」,得如实回报,不能假装公开了。 */
  privacy: TikTokPrivacy
}

/**
 * 算这条片要切几块。
 *
 * TikTok 的规矩:最后一块可以比 chunk_size 大(把余数并进去),但**不能单独多出一个小尾巴块**。
 * 所以 25MB / 10MB = 2 块(第二块 15MB),不是 3 块 —— 算成 3 块会被直接拒。
 */
export function planChunks(videoSize: number, chunkSize: number = CHUNK_SIZE): {
  chunkSize: number
  totalChunks: number
} {
  if (videoSize <= 0) throw new Error('视频大小不对')
  // 小于一块的片子:整条当一块传,chunk_size 必须等于文件大小
  if (videoSize <= chunkSize) return { chunkSize: videoSize, totalChunks: 1 }
  return { chunkSize, totalChunks: Math.floor(videoSize / chunkSize) }
}

/** 第 i 块(从 0 起)覆盖的字节区间,闭区间,最后一块吃掉所有余数。 */
export function chunkRange(
  index: number,
  totalChunks: number,
  chunkSize: number,
  videoSize: number,
): { start: number; end: number } {
  const start = index * chunkSize
  const end = index === totalChunks - 1 ? videoSize - 1 : start + chunkSize - 1
  return { start, end }
}

/** 把 TikTok 的报错翻成客户能行动的话。原始报错留日志给我们排查。 */
export function humanTikTokError(raw: string): string {
  if (/存在多个 TikTok 授权/.test(raw)) return '存在多个 TikTok 授权,已暂停发布,请联系团队核实'
  if (/缺少 ffprobe/.test(raw)) return '发布服务缺少 ffprobe，请管理员配置视频核验依赖'
  if (/unaudited_client_can_only_post_to_private_accounts/i.test(raw)) {
    return 'TikTok 未审核应用只能向私密账号发片；账号本身需设为私密，同时视频选择仅自己可见。'
  }
  if (/unaudited_client/i.test(raw)) {
    return 'TikTok 应用还没过审 —— 现在只能发成「仅自己可见」，过审后才能公开'
  }
  if (/spam_risk|reached_active_user_cap/i.test(raw)) {
    return 'TikTok 说发得太频繁了 — 隔一会儿再试'
  }
  if (/url_ownership_unverified/i.test(raw)) {
    return 'TikTok 不认这个视频地址 — 联系我们处理'
  }
  if (/access_token|token|scope_not_authorized/i.test(raw)) {
    return 'TikTok 授权过期或权限不够 — 去客户设置里重新点一次「连接 TikTok」'
  }
  if (/file_format_check_failed|video_.*(too|invalid)/i.test(raw)) {
    return 'TikTok 不接受这条片的格式或时长 — 联系我们处理'
  }
  return '发到 TikTok 没成功 — 稍后再试一次；反复失败请联系我们'
}

async function post(path: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const err = json['error'] as { code?: string; message?: string } | undefined
  if (!res.ok || (err && err.code && err.code !== 'ok')) {
    throw new Error(`TikTok ${path} ${res.status}: ${err?.code ?? ''} ${err?.message ?? JSON.stringify(json)}`)
  }
  return json
}

export async function getTikTokCreatorInfo(clientId: string, existingToken?: {accessToken:string;openId:string}): Promise<CreatorInfo> {
  const token = existingToken ?? await getValidTikTokToken(clientId)
  if (!token) throw new Error('请先连接 TikTok')
  const result = await post('/post/publish/creator_info/query/', token.accessToken, {})
  const data = result.data as CreatorInfo
  if (!data || !Array.isArray(data.privacy_level_options) || !data.creator_nickname || !Number.isFinite(data.max_video_post_duration_sec)) throw new Error('账号发布信息暂不可用')
  return { ...data, accountId:token.openId }
}

/**
 * 发一条片到 TikTok。
 *
 * @param privacy 用户确认的可见级别。未过审时必须选择平台允许的私密级别，不会自动降级。
 */
export async function publishToTikTok(params: {
  clientId: string
  videoUrl: string
  caption: string
  privacy: TikTokPrivacy
  review?: PostReview
  onInitialized?: (publishId: string, accountId: string) => Promise<void>
}): Promise<TikTokPublishResult> {
  const token = await getValidTikTokToken(params.clientId)
  if (!token) throw new Error('这个客户还没连过 TikTok(access_token 取不到)')

  const creator = await getTikTokCreatorInfo(params.clientId, token)
  if (!params.review) throw new Error('请先确认 TikTok 发布设置')
  storedTikTokSourcePath(params.videoUrl, params.clientId)
  const videoProof = await inspectTikTokVideo(params.videoUrl)
  const reviewed = validateReview(params.review, {...creator,videoProof}, params.videoUrl)
  if (reviewed.privacy !== params.privacy) throw new Error('发布范围与确认记录不一致')

  const pullUrl = await snapshotReviewedTikTokVideo(params.videoUrl, params.clientId, reviewed.videoSha256)

  const init = await post('/post/publish/video/init/', token.accessToken, {
    post_info: {
      title: reviewed.caption,
      privacy_level: params.privacy,
      disable_comment: !reviewed.allowComment,
      disable_duet: !reviewed.allowDuet,
      disable_stitch: !reviewed.allowStitch,
      brand_organic_toggle: reviewed.ownBrand,
      brand_content_toggle: reviewed.brandedContent,
    },
    source_info: { source: 'PULL_FROM_URL', video_url: pullUrl },
  })

  const data = (init['data'] ?? {}) as { publish_id?: string }
  if (!data.publish_id) throw new Error('TikTok init 未返回发布编号')
  // PULL init already starts retrieval. A failed receipt write is uncertain, never retry init.
  try {
    await params.onInitialized?.(data.publish_id, token.openId)
  } catch (error) {
    console.error('[tiktok] provider receipt not persisted', { clientId:params.clientId,publishId:data.publish_id })
    throw error
  }

  return { publishId: data.publish_id, privacy: params.privacy }
}

export type TikTokPostStatus = 'processing' | 'published' | 'failed'

/**
 * 查一条片处理到哪了。
 * TikTok 收下文件不等于发出去了 —— 它还要转码审核,几十秒到几分钟。
 * 不查状态就当成功,就会出现「系统说发了、TikTok 上没有」这种最难查的情况。
 */
export async function checkTikTokStatus(
  clientId: string,
  publishId: string,
  expectedAccountId?: string,
): Promise<{ status: TikTokPostStatus; detail?: string }> {
  // 已发出的任务带着原账号:有别的授权并存时,按原账号精确取,让它能照常收尾
  const token = await getValidTikTokToken(clientId, expectedAccountId ? { accountId: expectedAccountId } : undefined)
  if (!token) throw new Error('这个客户还没连过 TikTok(access_token 取不到)')
  if (expectedAccountId && token.openId !== expectedAccountId) throw new Error('TikTok 目标账号已改变，无法核验原发布任务')
  const json = await post('/post/publish/status/fetch/', token.accessToken, { publish_id: publishId })
  const data = (json['data'] ?? {}) as { status?: string; fail_reason?: string }
  const s = data.status ?? ''
  if (s === 'PUBLISH_COMPLETE') return { status: 'published' }
  if (s === 'FAILED') return { status: 'failed', detail: data.fail_reason }
  return { status: 'processing', detail: s }
}
