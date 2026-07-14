// P0.1 FacebookReelAdapter — 发 9:16 Reel 到客户 FB 主页(Graph API video_reels 三步)
// 已查证 API(v25.0,2026-07-15):
//   ① start:POST graph/{page}/video_reels?upload_phase=start → { video_id, upload_url }
//   ② upload:POST rupload/{video_id},头 file_url=<Supabase URL> 让 FB **自己去拉**(ME 不下载,子牙 B8)
//   ③ finish:POST graph/{page}/video_reels?upload_phase=finish&video_id&video_state=DRAFT|PUBLISHED&description
// draft=true → DRAFT(不公开,首测验格式);false → PUBLISHED(真发,不可逆)。
// 幂等对账(魏征 B9 防"发了没记上"重发):caption 埋零宽 wo 标记,findExisting 扫最近 Reel 描述比对。

import { getFacebookPageToken } from '@/lib/social/facebook-publisher'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'

const GRAPH = 'https://graph.facebook.com/v25.0'
const RUPLOAD = 'https://rupload.facebook.com/video-upload/v25.0'

// 零宽幂等标记:wo_id 前 8 位 hex 编成不可见字符,埋 caption 末尾。ANCHOR 打头方便扫描。
const ZW0 = '​' // zero-width space = bit 0
const ZW1 = '‌' // zero-width non-joiner = bit 1
const ZW_ANCHOR = '⁣' // invisible separator = 标记起点

export function encodeIdemTag(woId: string): string {
  const hex = woId.replace(/-/g, '').slice(0, 8)
  const bits = Array.from(hex).map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('')
  return ZW_ANCHOR + Array.from(bits).map((b) => (b === '1' ? ZW1 : ZW0)).join('')
}

async function resolveToken(target: PublishTarget): Promise<{ accessToken: string; pageId: string }> {
  if (!target.fb_source_id) throw new Error('publish_target.fb_source_id 缺失(FB 页 token 来源)')
  const creds = await getFacebookPageToken(target.fb_source_id)
  if (!creds) throw new Error(`FB source 无效或未激活: ${target.fb_source_id}`)
  // 防串(魏征 B9):token 反查到的 page 必须 === 目标 page,绝不拿别客户 token 发本页
  if (target.page_id && creds.pageId !== target.page_id) {
    throw new Error(`token 页(${creds.pageId})≠ 目标页(${target.page_id})—— 防误发拦截`)
  }
  return creds
}

async function graphPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH}${path}`, { method: 'POST', body })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`FB ${path} ${res.status}: ${JSON.stringify(json)}`)
  return json
}

export const facebookReelAdapter: PublishAdapter = {
  platform: 'facebook',

  async publish({ videoUrl, caption, target, idempotencyTag, draft }) {
    const { accessToken, pageId } = await resolveToken(target)
    const description = caption + encodeIdemTag(idempotencyTag)

    // ① start
    const start = await graphPost(`/${pageId}/video_reels`, { upload_phase: 'start', access_token: accessToken })
    const videoId = String(start['video_id'] ?? '')
    if (!videoId) throw new Error(`FB start 未返回 video_id: ${JSON.stringify(start)}`)

    // ② upload:file_url 头让 FB 自己拉 Supabase 视频
    const upRes = await fetch(`${RUPLOAD}/${videoId}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, file_url: videoUrl },
    })
    const upJson = (await upRes.json().catch(() => ({}))) as Record<string, unknown>
    if (!upRes.ok || upJson['success'] !== true) {
      throw new Error(`FB upload 失败 ${upRes.status}: ${JSON.stringify(upJson)}`)
    }

    // ③ finish + publish/draft
    await graphPost(`/${pageId}/video_reels`, {
      access_token: accessToken,
      video_id: videoId,
      upload_phase: 'finish',
      video_state: draft ? 'DRAFT' : 'PUBLISHED',
      description,
    })

    // 拿 permalink(尽力,失败不阻塞——video_id 才是硬锚)
    let permalink: string | undefined
    try {
      const meta = await fetch(`${GRAPH}/${videoId}?fields=permalink_url&access_token=${accessToken}`)
      const mj = (await meta.json().catch(() => ({}))) as Record<string, unknown>
      if (typeof mj['permalink_url'] === 'string') permalink = mj['permalink_url'] as string
    } catch {
      /* permalink 非关键 */
    }

    return {
      platform: 'facebook',
      page_id: pageId,
      post_id: videoId, // Reel 的 media id 即 post 标识
      video_id: videoId,
      published_at: new Date().toISOString(),
      permalink,
    }
  },

  // 幂等对账:扫该页最近 Reel 的 description,命中零宽标记 = 已发,返回回执(不重发)
  async findExisting({ target, idempotencyTag }): Promise<PublishedRef | null> {
    const { accessToken, pageId } = await resolveToken(target)
    const tag = encodeIdemTag(idempotencyTag)
    const res = await fetch(
      `${GRAPH}/${pageId}/video_reels?fields=id,description,permalink_url,updated_time&limit=25&access_token=${accessToken}`,
    )
    const json = (await res.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>> }
    if (!res.ok || !Array.isArray(json.data)) return null
    const hit = json.data.find((r) => typeof r['description'] === 'string' && (r['description'] as string).includes(tag))
    if (!hit) return null
    return {
      platform: 'facebook',
      page_id: pageId,
      post_id: String(hit['id']),
      video_id: String(hit['id']),
      published_at: typeof hit['updated_time'] === 'string' ? (hit['updated_time'] as string) : new Date().toISOString(),
      permalink: typeof hit['permalink_url'] === 'string' ? (hit['permalink_url'] as string) : undefined,
    }
  },
}
