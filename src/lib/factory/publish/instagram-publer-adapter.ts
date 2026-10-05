// P0.1 PublerInstagramAdapter — 发 9:16 Reel 到客户 Instagram(Publer 排期工具,非 Meta 原生)
// 为什么走 Publer:客户 IG 账号是 Publer 代管的,ME 拿不到 IG 直连 token;Publer 已有排期能力。
// 架构规矩:本文件绝不 import @/lib/publer/*,直接 fetch Publer REST(和 FB adapter 直连 Graph 同理)。
//
// 硬规矩(全部 fail closed):
//   ① 默认草稿:draft=true → state='draft',绝不公开;只有 draft=false 才 state='scheduled'(now+3min)。
//   ② 绝不编回执:任何失败/未知账号/错 provider/任务失败/超时 → throw,绝不返回 ref。
//   ③ API key / workspace id 绝不进 Error 或日志。
//   ④ env 在调用内读,不在模块顶层(测试可注入,也避免构建期炸)。
//   ⑤ 每个请求带 User-Agent: Mozilla/5.0(Publer 在 Cloudflare 后面,默认 UA 会被 403)。

import { encodeIdemTag, normBrand } from './facebook-reel-adapter'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'

const PUBLER_BASE = 'https://app.publer.com/api/v1'
const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 45
const SCHEDULE_DELAY_MS = 3 * 60 * 1000
const LOOKUP_PAGES = 3 // 对账每个状态最多翻几页(新帖排在前面;翻太深没意义)

/** 账号类错误(授权失效/账号找不到/provider 不符)—— 单独一类,调用方可据此提示"去重连"。 */
export class PublerAccountError extends Error {
  readonly kind = 'account' as const
  constructor(message: string) {
    super(message)
    this.name = 'PublerAccountError'
  }
}

export function isPublerAccountError(e: unknown): e is PublerAccountError {
  return e instanceof PublerAccountError
}

/**
 * Publer **明确拒绝**了这次请求(4xx / 任务失败 / 失败清单非空)—— 帖子确定没建出来,重试是安全的。
 * 区别于超时 / 网络断 / 5xx:那些「不知道建没建出来」,调用方必须先对账、不能直接重发(防重复帖)。
 */
export class PublerRejectedError extends Error {
  readonly kind = 'rejected' as const
  constructor(message: string) {
    super(message)
    this.name = 'PublerRejectedError'
  }
}

/**
 * Instagram 的防串客户核对(比 Facebook 那条严):
 * 品牌名和账号名都必须能比对(归一化后非空)、且互相包含(较短的一边至少 4 个字符,防「cts」放行「ctsfurniture」)。
 * 缺任何一边 / 比不了(如纯中文品牌归一化后为空)一律不发 —— 宁可让人去配,不能凭空放行把片存进别家客户的账号。
 */
export function assertInstagramBrand(accountName: string, expectBrand?: string): void {
  const a = normBrand(accountName)
  const b = normBrand(expectBrand ?? '')
  if (!a || !b) {
    throw new PublerAccountError('Publer 账号名或客户品牌名无法比对(缺失或不含英文字母/数字),为防发错客户不发')
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 4 || !long.includes(short)) {
    throw new PublerAccountError(`Publer 账号名(${accountName})与客户品牌(${expectBrand})不符 —— 防误发拦截`)
  }
}

export function isPublerRejectedError(e: unknown): e is PublerRejectedError {
  return e instanceof PublerRejectedError
}

export interface InstagramReelBodyInput {
  state: 'draft' | 'scheduled'
  accountId: string
  mediaId: string
  text: string
  firstComment?: string
  scheduledAt?: string
}

/**
 * 拼 Publer 排期请求体。排期/首评/reel 的形状沿用 Dropbox 里 publer_reel.py 的 Facebook 调用(那条在生产跑通过);
 * instagram 网络节点是同形状换 provider —— ⚠️ Instagram 这一版**没有在真接口上验证过**,
 * 首次真连只许走草稿(见 cron 的 FACTORY_INSTAGRAM_LIVE 闸)。草稿(state=draft)按 Publer 文档不带时间。
 * scheduled 必须带 scheduledAt;draft 绝不带。
 */
export function buildInstagramReelBody(input: InstagramReelBodyInput): Record<string, unknown> {
  if (input.state === 'scheduled' && !input.scheduledAt) {
    throw new Error('state=scheduled 必须提供 scheduledAt')
  }

  const account: Record<string, unknown> = { id: input.accountId }
  if (input.state === 'scheduled' && input.scheduledAt) {
    account['scheduled_at'] = input.scheduledAt
  }
  const comment = input.firstComment?.trim()
  if (comment) {
    account['comments'] = [{ text: comment, delay: { duration: 1, unit: 'Minute' } }]
  }

  return {
    bulk: {
      state: input.state,
      posts: [
        {
          networks: {
            instagram: {
              type: 'video',
              text: input.text,
              media: [{ id: input.mediaId, type: 'video' }],
              details: { type: 'reel', feed: true },
            },
          },
          accounts: [account],
        },
      ],
    },
  }
}

/** 任务失败信息:null = 没失败。数组取 message 拼接,对象直接 JSON 截断。 */
export function jobFailureMessage(status: unknown): string | null {
  if (!status || typeof status !== 'object') return null
  const payload = (status as Record<string, unknown>)['payload']
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const failures = (payload as Record<string, unknown>)['failures']
  if (!failures) return null

  if (Array.isArray(failures)) {
    if (failures.length === 0) return null
    const messages = failures
      .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>)['message'] : undefined))
      .filter((m): m is string => typeof m === 'string' && m.length > 0)
    return messages.length > 0 ? messages.join('; ') : JSON.stringify(failures).slice(0, 200)
  }

  if (typeof failures === 'object') {
    if (Object.keys(failures as Record<string, unknown>).length === 0) return null
    return JSON.stringify(failures).slice(0, 200)
  }

  return null
}

/** Publer 列表响应三种形状:裸数组 / {posts:[]} / {data:[]}。只留纯对象。 */
export function normalizePostList(raw: unknown): Array<Record<string, unknown>> {
  let list: unknown
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    list = Array.isArray(obj['posts']) ? obj['posts'] : Array.isArray(obj['data']) ? obj['data'] : []
  } else {
    list = []
  }
  if (!Array.isArray(list)) return []
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
}

export interface PublerInstagramDeps {
  /** 只给本地试跑用(指向假 Publer 服务);生产不传,走官方地址 */
  baseUrl?: string
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

interface PublerEnv {
  apiKey: string
  workspaceId: string
}

/** env 在调用内读(规矩④):缺任一 → PublerAccountError,消息里绝不带值。 */
function readEnv(): PublerEnv {
  const apiKey = process.env.PUBLER_API_KEY
  const workspaceId = process.env.PUBLER_WORKSPACE_ID
  if (!apiKey || !workspaceId) {
    throw new PublerAccountError('Publer 未配置(PUBLER_API_KEY / PUBLER_WORKSPACE_ID 缺失)')
  }
  return { apiKey, workspaceId }
}

export function createPublerInstagramAdapter(deps: PublerInstagramDeps = {}): PublishAdapter {
  const fetchFn = deps.fetchFn ?? fetch
  const baseUrl = deps.baseUrl ?? PUBLER_BASE
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => new Date())

  // 唯一出口:所有 Publer 请求都过这里,统一头 + 统一错误分类(规矩③⑤)。
  async function publerRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const env = readEnv()
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
      Authorization: `Bearer-API ${env.apiKey}`,
      'Publer-Workspace-Id': env.workspaceId,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new PublerAccountError(`Publer 授权失效或被拦截(HTTP ${res.status})`)
      }
      const text = await res.text().catch(() => '')
      const message = `Publer ${method} ${path} ${res.status}: ${text.slice(0, 200)}`
      // 4xx = Publer 明确说不行(请求没被受理);5xx = 不知道有没有受理,保持普通错误让调用方对账
      if (res.status >= 400 && res.status < 500) throw new PublerRejectedError(message)
      throw new Error(message)
    }
    return res.json().catch(() => ({}))
  }

  // 轮询任务:complete/completed → 返回;failed/error → throw;超 45 次 → 超时。
  async function pollJob(jobId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const status = await publerRequest('GET', `/job_status/${jobId}`)
      const s = status && typeof status === 'object' ? (status as Record<string, unknown>)['status'] : undefined
      if (s === 'complete' || s === 'completed') return status as Record<string, unknown>
      if (s === 'failed' || s === 'error') {
        throw new PublerRejectedError(`Publer 任务失败(${jobId})`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error('Publer 任务超时')
  }

  // 账号校验:必须存在、provider 必须是 instagram、页名必须 ~ 客户品牌(防误发)。
  async function resolveAccount(target: PublishTarget): Promise<Record<string, unknown>> {
    const raw = await publerRequest('GET', '/accounts')
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['accounts'])
        ? ((raw as Record<string, unknown>)['accounts'] as unknown[])
        : []
    const account = list.find(
      (a): a is Record<string, unknown> =>
        !!a && typeof a === 'object' && (a as Record<string, unknown>)['id'] === target.publer_account_id,
    )
    if (!account) {
      throw new PublerAccountError('Publer 里找不到这个 Instagram 账号(可能已掉线或被移除)')
    }
    if (account['provider'] !== 'instagram') {
      throw new PublerAccountError(`Publer 账号 provider 不是 instagram(${String(account['provider'])})`)
    }
    const name = typeof account['name'] === 'string' ? (account['name'] as string) : ''
    assertInstagramBrand(name, target.expect_brand)
    return account
  }

  // 上传视频拿 media id:POST /media/from-url → job → payload[0].id。
  async function uploadMedia(videoUrl: string, idempotencyTag: string): Promise<string> {
    const created = await publerRequest('POST', '/media/from-url', {
      media: [{ url: videoUrl, name: `me-factory-${idempotencyTag}` }],
      type: 'single',
      in_library: true,
    })
    const jobId = created && typeof created === 'object' ? (created as Record<string, unknown>)['job_id'] : undefined
    if (typeof jobId !== 'string' || !jobId) throw new Error('Publer 上传未返回 job_id')

    const status = await pollJob(jobId)
    const payload = status['payload']
    const first = Array.isArray(payload) ? payload[0] : undefined
    const mediaId = first && typeof first === 'object' ? (first as Record<string, unknown>)['id'] : undefined
    if (typeof mediaId !== 'string' || !mediaId) throw new Error('Publer 上传未返回 media id')
    return mediaId
  }

  // 排期/草稿:POST /posts/schedule → job → 失败信息非空则 throw。
  async function schedulePost(body: Record<string, unknown>): Promise<string> {
    const created = await publerRequest('POST', '/posts/schedule', body)
    const jobId = created && typeof created === 'object' ? (created as Record<string, unknown>)['job_id'] : undefined
    if (typeof jobId !== 'string' || !jobId) throw new Error('Publer 排期未返回 job_id')

    const status = await pollJob(jobId)
    const failure = jobFailureMessage(status)
    if (failure) throw new PublerRejectedError(`Publer 拒绝发布: ${failure}`)
    return jobId
  }

  // 找已发帖:三个 state 各扫前 3 页,靠零宽标记命中;命中时把「在哪个 state 下找到的」一起带出来
  // (状态以列表筛选条件为准,不信帖子对象自带的 state 字段)。非 OK 响应必须 throw(fail closed)。
  async function lookupPost(
    accountId: string,
    idempotencyTag: string,
  ): Promise<{ post: Record<string, unknown>; state: 'draft' | 'scheduled' | 'published' } | null> {
    const tag = encodeIdemTag(idempotencyTag)
    for (const state of ['draft', 'scheduled', 'published'] as const) {
      for (let page = 0; page < LOOKUP_PAGES; page++) {
        const raw = await publerRequest(
          'GET',
          `/posts?account_ids[]=${encodeURIComponent(accountId)}&state=${state}&page=${page}`,
        )
        const list = normalizePostList(raw)
        const hit = list.find((p) => typeof p['text'] === 'string' && (p['text'] as string).includes(tag))
        if (hit) return { post: hit, state }
        if (list.length === 0) break // 这个 state 翻到头了
      }
    }
    return null
  }

  function toRef(args: {
    accountId: string
    mediaId: string
    jobId: string
    found: Record<string, unknown> | null
    draft: boolean
    scheduledAt?: string
  }): PublishedRef {
    const foundId = args.found && typeof args.found['id'] === 'string' ? (args.found['id'] as string) : undefined
    const link = args.found && typeof args.found['post_link'] === 'string' ? (args.found['post_link'] as string) : undefined
    return {
      platform: 'publer',
      page_id: args.accountId,
      post_id: foundId ?? args.jobId,
      video_id: args.mediaId,
      published_at: now().toISOString(),
      ...(link && link.startsWith('https://') ? { permalink: link } : {}),
      provider_state: args.draft ? 'draft' : 'scheduled',
      ...(!args.draft && args.scheduledAt ? { scheduled_at: args.scheduledAt } : {}),
    }
  }

  return {
    platform: 'publer',

    async publish({ videoUrl, caption, firstComment, target, idempotencyTag, draft, onStarted }) {
      // ① 目标校验:平台/账号/provider 任一不符 → 账号错误,绝不猜。
      if (target.platform !== 'publer') throw new PublerAccountError('publish_target.platform 不是 publer')
      if (!target.publer_account_id) throw new PublerAccountError('publish_target.publer_account_id 缺失')
      if (target.publer_provider && target.publer_provider !== 'instagram') {
        throw new PublerAccountError(`publish_target.publer_provider 不是 instagram(${target.publer_provider})`)
      }

      // ② 账号必须真实存在且是 IG(顺带做防误发页名断言)。
      await resolveAccount(target)

      // ③ 上传拿 media id。
      const mediaId = await uploadMedia(videoUrl, idempotencyTag)

      // ④ 本地幂等锚(魏征 B9):建帖之前先把 media id 落回 ME 库,中途崩后重来靠它判断。
      if (onStarted) await onStarted(mediaId)

      // ⑤ caption 埋零宽标记,供 findExisting 对账。
      // 标记前加换行:caption 以 #话题 结尾时,零宽字符不会被并进话题词里
      const text = `${caption}\n${encodeIdemTag(idempotencyTag)}`
      const scheduledAt = draft ? undefined : new Date(now().getTime() + SCHEDULE_DELAY_MS).toISOString()
      const body = buildInstagramReelBody({
        state: draft ? 'draft' : 'scheduled',
        accountId: target.publer_account_id,
        mediaId,
        text,
        firstComment,
        scheduledAt,
      })

      // ⑥ 排期/草稿;任务失败 → throw,绝不返回 ref。
      const jobId = await schedulePost(body)

      // ⑦ 尽力找已建帖拿真 id/permalink;失败不阻塞(回执锚是 jobId)。
      let found: Record<string, unknown> | null = null
      let readBackOk = false
      try {
        found = (await lookupPost(target.publer_account_id, idempotencyTag))?.post ?? null
        readBackOk = true
      } catch {
        /* 尽力而为,失败不阻塞 */
      }

      const ref = toRef({ accountId: target.publer_account_id, mediaId, jobId, found, draft, scheduledAt })
      // 读回成功却没找到我们埋的标记:Publer/Instagram 可能吞了零宽字符,下一次对账会漏掉这条 → 标出来让人看
      return readBackOk && found === null ? { ...ref, idempotency_unverified: true } : ref
    },

    // 幂等对账:三个 state 扫一遍。非 OK 响应 throw(fail closed,调用方不能盲发)。
    async findExisting({ target, idempotencyTag }): Promise<PublishedRef | null> {
      if (!target.publer_account_id) throw new PublerAccountError('publish_target.publer_account_id 缺失')
      const hit = await lookupPost(target.publer_account_id, idempotencyTag)
      if (!hit) return null
      const { post: found, state } = hit
      const id = typeof found['id'] === 'string' ? (found['id'] as string) : undefined
      // 命中了标记却没有 id:说明确实发过、只是读不全 —— 不能当「没发过」放行重发。
      if (!id) throw new Error('Publer 对账命中了已有帖子但读不到 id,保守不重发')
      const link = typeof found['post_link'] === 'string' ? (found['post_link'] as string) : undefined
      return {
        platform: 'publer',
        page_id: target.publer_account_id,
        post_id: id,
        published_at: now().toISOString(),
        ...(link && link.startsWith('https://') ? { permalink: link } : {}),
        provider_state: state === 'draft' ? 'draft' : 'scheduled',
        // 排期/已发的帖子带着 Publer 记的发布时间,事件契约要用(草稿没有)
        ...(state !== 'draft' && typeof found['scheduled_at'] === 'string'
          ? { scheduled_at: found['scheduled_at'] as string }
          : {}),
      }
    },
  }
}

export const publerInstagramAdapter: PublishAdapter = createPublerInstagramAdapter()
