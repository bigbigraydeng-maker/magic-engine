/**
 * TikTok 发布 —— Content Posting API(直接发布)。
 *
 * 为什么是分块直传,不是给个链接让 TikTok 自己来拉:
 * TikTok 的「拉取链接」模式要求先在开发者后台**验证域名归属**。我们的成片放在存储服务上,
 * 域名不是我们的,验证不了。所以只能自己把文件推过去(init 拿上传地址 → 分块 PUT → 轮询状态)。
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

/**
 * 发一条片到 TikTok。
 *
 * @param privacy 想要的可见级别。未过审时 TikTok 会强制降级,返回值里回报的是**实际**级别。
 */
export async function publishToTikTok(params: {
  clientId: string
  videoUrl: string
  caption: string
  privacy: TikTokPrivacy
}): Promise<TikTokPublishResult> {
  const token = await getValidTikTokToken(params.clientId)
  if (!token) throw new Error('这个客户还没连过 TikTok(access_token 取不到)')

  // 先摸一下文件多大 —— init 必须先报准确的字节数,报错了整个上传作废
  const head = await fetch(params.videoUrl, { method: 'HEAD' })
  const videoSize = Number(head.headers.get('content-length') ?? 0)
  if (!Number.isFinite(videoSize) || videoSize <= 0) {
    throw new Error(`取不到成片大小(${head.status}) —— 无法上传`)
  }
  const { chunkSize, totalChunks } = planChunks(videoSize)

  const init = await post('/post/publish/video/init/', token.accessToken, {
    post_info: {
      title: params.caption,
      privacy_level: params.privacy,
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  })

  const data = (init['data'] ?? {}) as { publish_id?: string; upload_url?: string }
  if (!data.publish_id || !data.upload_url) {
    throw new Error(`TikTok init 没给上传地址: ${JSON.stringify(init)}`)
  }

  // 分块推过去。逐块从存储按 Range 取、立刻转发,不把整条片读进内存 ——
  // 一次性读进来正是之前把做片进程撑爆的原因(160MB 录像静默 OOM)。
  for (let i = 0; i < totalChunks; i++) {
    const { start, end } = chunkRange(i, totalChunks, chunkSize, videoSize)
    const part = await fetch(params.videoUrl, { headers: { Range: `bytes=${start}-${end}` } })
    if (!part.ok || !part.body) throw new Error(`取第 ${i + 1} 块失败 ${part.status}`)
    const buf = Buffer.from(await part.arrayBuffer())
    const up = await fetch(data.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(buf.length),
        'Content-Range': `bytes ${start}-${end}/${videoSize}`,
      },
      body: buf,
    })
    // 201 = 收完最后一块;206 = 收下了还等后面的。其它都算失败。
    if (up.status !== 201 && up.status !== 206 && up.status !== 200) {
      throw new Error(`上传第 ${i + 1}/${totalChunks} 块失败 ${up.status}: ${await up.text().catch(() => '')}`)
    }
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
): Promise<{ status: TikTokPostStatus; detail?: string }> {
  const token = await getValidTikTokToken(clientId)
  if (!token) throw new Error('这个客户还没连过 TikTok(access_token 取不到)')
  const json = await post('/post/publish/status/fetch/', token.accessToken, { publish_id: publishId })
  const data = (json['data'] ?? {}) as { status?: string; fail_reason?: string }
  const s = data.status ?? ''
  if (s === 'PUBLISH_COMPLETE') return { status: 'published' }
  if (s === 'FAILED') return { status: 'failed', detail: data.fail_reason }
  return { status: 'processing', detail: s }
}
