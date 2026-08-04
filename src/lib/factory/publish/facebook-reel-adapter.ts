// P0.1 FacebookReelAdapter — 发 9:16 Reel 到客户 FB 主页(Graph API video_reels 三步)
// 已查证 API(v25.0,2026-07-15):
//   ① start:POST graph/{page}/video_reels?upload_phase=start → { video_id, upload_url }
//   ② upload:POST rupload/{video_id},头 file_url=<Supabase URL> 让 FB **自己去拉**(ME 不下载,子牙 B8)
//   ③ finish:POST graph/{page}/video_reels?upload_phase=finish&video_id&video_state=DRAFT|PUBLISHED&description
// draft=true → DRAFT(不公开,首测验格式);false → PUBLISHED(真发,不可逆)。
// 幂等对账(魏征 B9 防"发了没记上"重发):caption 埋零宽 wo 标记,findExisting 扫最近 Reel 描述比对。

import { getStoredPageToken } from '@/lib/meta/token-manager'
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

// 品牌名归一(去 Pty Ltd/空格/符号/大小写)用于防误发页名匹配
function normBrand(s: string): string {
  return s.toLowerCase().replace(/pty\.?\s*ltd\.?/g, '').replace(/[^a-z0-9]/g, '')
}

// 取该页的 page token + 页名。
//
// 两条来源,顺序有讲究(2026-08-04 修正):
// ① 库里存的页 token —— 客户在设置页点过「连接 Meta」,那是有角色的人亲自授的权。
// ② env 里的全局 system user token —— 老路,只在「那个身份恰好在这个页上有角色」时才成立。
//    Magic Lab Class 发讲课片失败就是撞在这:全局 token 换不出 MagicLab Academy 的页 token。
// 先库后 env:已经按老路配好的客户(CTS)一行不用改,新客户点一下按钮就通。
//
// 页名同时做防误发第三重断言(魏征 B9):页名必须 ~ 该客户品牌,否则绝不发(防把 A 客户片发到 B 页)。
async function resolveToken(target: PublishTarget): Promise<{ accessToken: string; pageId: string; pageName: string }> {
  if (!target.page_id) throw new Error('publish_target.page_id 缺失')

  let accessToken: string | null = null
  if (target.client_id) {
    accessToken = await getStoredPageToken(target.client_id, target.page_id).catch(() => null)
  }

  if (!accessToken) {
    const sysToken = process.env.META_SYSTEM_USER_TOKEN
    if (!sysToken) throw new Error('这个主页还没连过 Meta,env META_SYSTEM_USER_TOKEN 也没配')
    const res = await fetch(`${GRAPH}/${target.page_id}?fields=access_token&access_token=${sysToken}`)
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || typeof j['access_token'] !== 'string') {
      throw new Error(`取页 token 失败 ${res.status}: ${JSON.stringify(j)}`)
    }
    accessToken = j['access_token'] as string
  }

  // 页名单独取:库里存的就是页 token,拿它问自己是谁最直接,两条来源共用同一段校验。
  const nameRes = await fetch(`${GRAPH}/${target.page_id}?fields=name&access_token=${accessToken}`)
  const nameJson = (await nameRes.json().catch(() => ({}))) as Record<string, unknown>
  if (!nameRes.ok) throw new Error(`取页名失败 ${nameRes.status}: ${JSON.stringify(nameJson)}`)
  const pageName = typeof nameJson['name'] === 'string' ? (nameJson['name'] as string) : ''

  assertBrandMatches(pageName, target.expect_brand)
  return { accessToken, pageId: target.page_id, pageName }
}

/** 防误发:页名对不上客户品牌就绝不发(单独抽出来是为了能直接测)。 */
export function assertBrandMatches(pageName: string, expectBrand?: string): void {
  if (!expectBrand || !pageName) return
  const a = normBrand(pageName)
  const b = normBrand(expectBrand)
  if (a && b && !a.includes(b) && !b.includes(a)) {
    throw new Error(`页名(${pageName})与客户品牌(${expectBrand})不符 —— 防误发拦截`)
  }
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

  async publish({ videoUrl, caption, target, idempotencyTag, draft, onStarted }) {
    const { accessToken, pageId } = await resolveToken(target)
    const description = caption + encodeIdemTag(idempotencyTag)

    // ① start
    const start = await graphPost(`/${pageId}/video_reels`, { upload_phase: 'start', access_token: accessToken })
    const videoId = String(start['video_id'] ?? '')
    if (!videoId) throw new Error(`FB start 未返回 video_id: ${JSON.stringify(start)}`)
    // 本地幂等锚(魏征 B9):上传/finish 之前先把 video_id 落回 ME 库。中途崩后重来靠它判断,不盲目重发。
    if (onStarted) await onStarted(videoId)

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

/**
 * 把已经躺在主页后台的草稿正式发出去 —— 不重新上传。
 *
 * 为什么要单独一条路:审片通过后「真发」如果走重新上传,主页上会同时留着一条草稿和一条正式的,
 * 等于每条片都要人去删一次。同一个 finish 接口再喊一次、把状态改成 PUBLISHED 就够了。
 */
export async function promoteReelToPublished(params: {
  target: PublishTarget
  videoId: string
}): Promise<PublishedRef> {
  const { accessToken, pageId } = await resolveToken(params.target)
  await graphPost(`/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id: params.videoId,
    video_state: 'PUBLISHED',
    access_token: accessToken,
  })
  const info = await fetch(
    `${GRAPH}/${params.videoId}?fields=permalink_url&access_token=${accessToken}`,
  )
  const j = (await info.json().catch(() => ({}))) as Record<string, unknown>
  return {
    platform: 'facebook',
    page_id: pageId,
    post_id: params.videoId,
    video_id: params.videoId,
    published_at: new Date().toISOString(),
    permalink: typeof j['permalink_url'] === 'string' ? (j['permalink_url'] as string) : undefined,
  }
}
