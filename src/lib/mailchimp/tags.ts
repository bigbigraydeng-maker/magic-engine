/**
 * 给**已经在名单里**的联系人加 / 摘标签。
 *
 * ## 为什么这个文件在 2026-09-02 才出现
 *
 * 在这之前 ME 跟 Mailchimp 的连接是**单向**的：`sync.ts` 把「谁打开了邮件」读回
 * CRM，`client.ts` 的 `subscribeMember` 只能在人**第一次进名单那一刻**带一个标签。
 * 也就是说，一个人进来之后状态再怎么变，Mailchimp 那边永远不会知道 ——
 * `paid_customer` 那 19 个标签全是 2026-08-30 有人翻邮箱手工打上去的。
 *
 * 手工的代价当天就付了：9/1 那次 192 人的群发混进了 2 个已付款客户，其中一个是
 * Baker 亲口回过「your payment has been received in full」的 Nikki Smith。
 *
 * ## 一条不许破的线：只改已有的人，绝不新建
 *
 * 跟 `sync.ts` 开头那条护栏同源 —— 找不到就跳过并计数，**绝不为一个只在别处
 * 存在的邮箱凭空建联系人**。这里更狠一点的理由是：打标签会直接改变这个人收不收
 * 得到邮件。给一个来路不明的地址建人再打上 `paid_customer`，等于凭空把他从所有
 * 营销名单里踢出去，而且没有任何人会发现。
 *
 * ## PII
 *
 * 错误信息里**不回显邮箱**（同 `client.ts` 的 `safeReadTitle`：只读 title 不读
 * detail，因为 detail 常常把 email 原样吐回来）。调用方要定位是哪个人，用它自己
 * 手上那份输入，不靠我们的日志。
 */

import { createHash } from 'node:crypto'
// 复用 client.ts 已经 export 且有测试的那份 —— 两份 key 解析规则一定会漂移，
// Mailchimp 改 key 格式时只会有一个文件被改到（子牙复审 P2）。
import {
  datacenterFromKey,
  subscribeMember,
  type SubscribeMemberInput,
  type SubscribeMemberResult,
} from './client'

const API_VERSION = '3.0'
const REQUEST_TIMEOUT_MS = 20_000

/** Mailchimp 用 email 小写后的 md5 当 subscriber_hash。 */
export function subscriberHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface MailchimpTagsConfig {
  apiKey: string
  audienceId: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

// ── 查人 ────────────────────────────────────────────────────────────────────

export interface FoundMember {
  email: string
  /** subscribed / unsubscribed / cleaned / transactional / pending / archived */
  status: string
  tags: string[]
}

export type FindMemberResult =
  | { status: 'found'; member: FoundMember }
  | { status: 'not_in_audience' }
  | { status: 'error'; reason: string; retryable: boolean }

/**
 * 这个邮箱在不在名单里。
 *
 * 404 是**正常结果**不是错误 —— 名单里没有这个人是每天都会发生的事（客人用
 * 另一个邮箱付的款、供应商的地址、内部转发）。把它当 error 会让调用方分不清
 * 「没这个人」和「Mailchimp 挂了」，而这两件事的处理方式完全相反。
 */
export async function findMemberByEmail(
  cfg: MailchimpTagsConfig,
  email: string,
): Promise<FindMemberResult> {
  const clean = email.trim().toLowerCase()
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { status: 'error', reason: 'invalid_email', retryable: false }
  }

  let dc: string
  try {
    dc = datacenterFromKey(cfg.apiKey)
  } catch {
    return { status: 'error', reason: 'bad_api_key_format', retryable: false }
  }

  const url =
    `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}` +
    `/members/${subscriberHash(clean)}?fields=email_address,status,tags`

  const doFetch = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return { status: 'error', reason: timeout ? 'timeout' : 'network', retryable: true }
  }

  if (res.status === 404) return { status: 'not_in_audience' }
  if (res.status === 401) return { status: 'error', reason: 'unauthorized', retryable: false }
  // 429 是限流 —— 等一下就好，判成不可重试等于把「稍后再来」讲成「永远别来」。
  if (!res.ok) {
    return { status: 'error', reason: `http_${res.status}`, retryable: res.status >= 500 || res.status === 429 }
  }

  try {
    const json = (await res.json()) as {
      email_address?: string
      status?: string
      tags?: Array<{ name?: string }>
    }
    return {
      status: 'found',
      member: {
        email: json.email_address ?? clean,
        status: json.status ?? 'unknown',
        tags: (json.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
      },
    }
  } catch {
    return { status: 'error', reason: 'bad_json', retryable: false }
  }
}

// ── 改标签 ──────────────────────────────────────────────────────────────────

export interface ApplyTagsInput {
  /** 要加上的标签名。Mailchimp 里标签不存在会自动建。 */
  add?: string[]
  /** 要摘掉的标签名。摘一个本来就没有的标签不报错。 */
  remove?: string[]
}

export type ApplyTagsResult =
  | { status: 'applied'; added: string[]; removed: string[] }
  | { status: 'noop'; reason: 'nothing_to_do' | 'already_correct' }
  | { status: 'skipped'; reason: 'not_in_audience' }
  | { status: 'error'; reason: string; retryable: boolean }

/**
 * 给一个**已经在名单里**的人改标签。
 *
 * 先查再改，有三个理由，少一个都会出事：
 *   1. 人不在名单里就跳过 —— 绝不新建（见文件头）。
 *   2. 标签已经对了就不发写请求 —— 补历史要跑几百个人，重跑必须是幂等且便宜的。
 *   3. 拿到真实的 tags 才能算出「实际加了什么、摘了什么」，日志才不是猜的。
 */
export interface ApplyTagsOptions {
  /**
   * 只算不写 —— 补历史前的预演。
   *
   * **仍然会发那次查询**：不查就不知道人在不在名单里、标签是不是已经对了，
   * 预演出来的「会打多少人」会比真跑虚高一大截，等于没预演。省掉的只有写请求。
   */
  dryRun?: boolean
}

export async function applyMemberTags(
  cfg: MailchimpTagsConfig,
  email: string,
  input: ApplyTagsInput,
  opts: ApplyTagsOptions = {},
): Promise<ApplyTagsResult> {
  const add = (input.add ?? []).map((t) => t.trim()).filter(Boolean)
  const remove = (input.remove ?? []).map((t) => t.trim()).filter(Boolean)
  if (add.length === 0 && remove.length === 0) return { status: 'noop', reason: 'nothing_to_do' }

  const found = await findMemberByEmail(cfg, email)
  if (found.status === 'not_in_audience') return { status: 'skipped', reason: 'not_in_audience' }
  if (found.status === 'error') return found

  const have = new Set(found.member.tags)
  const toAdd = add.filter((t) => !have.has(t))
  const toRemove = remove.filter((t) => have.has(t))
  if (toAdd.length === 0 && toRemove.length === 0) return { status: 'noop', reason: 'already_correct' }

  // 预演在这里收手 —— 上面那次查询已经发生过了，所以 added/removed 是**真实**
  // 会发生的动作，不是估的。
  if (opts.dryRun) return { status: 'applied', added: toAdd, removed: toRemove }

  const body = {
    tags: [
      ...toAdd.map((name) => ({ name, status: 'active' as const })),
      ...toRemove.map((name) => ({ name, status: 'inactive' as const })),
    ],
  }

  const dc = datacenterFromKey(cfg.apiKey)
  const url =
    `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}` +
    `/members/${subscriberHash(email)}/tags`

  const doFetch = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return { status: 'error', reason: timeout ? 'timeout' : 'network', retryable: true }
  }

  // 打标签成功返回 204 No Content。
  if (res.status === 204 || res.ok) return { status: 'applied', added: toAdd, removed: toRemove }
  if (res.status === 401) return { status: 'error', reason: 'unauthorized', retryable: false }
  return { status: 'error', reason: `http_${res.status}`, retryable: res.status >= 500 || res.status === 429 }
}

// ── 进名单 + 确保标签打上（连接层的完整契约）────────────────────────────────

/**
 * 「补打标签」的结果 —— 只在人**本来就在名单里**时才有意义。
 *
 * - `applied`        ── 本来没这个标签，刚补上
 * - `already_tagged` ── 本来就有，什么都没做（幂等）
 * - `not_attempted`  ── 调用方没给标签名，没什么好打的
 * - `failed:<原因>`  ── 打了 Mailchimp 但没成（限流 / 5xx / 网络 / 授权）
 */
export type TagRepair = 'applied' | 'already_tagged' | 'not_attempted' | `failed:${string}`

/**
 * 把人放进名单，**并确保来源标签真的打上了**。
 *
 * ## 为什么需要这个包装（2026-09-06 生产实测）
 *
 * `subscribeMember` 走的是 `POST /lists/{id}/members`，标签只是这次「新建会员」
 * 请求里顺带的一个字段。人**已经在名单里**时 Mailchimp 回 400 `Member Exists`，
 * 这次请求整个不生效 —— 标签一个字都没写进去。而 `already_member` 在上游被当成
 * 成功，还会写「会员关系已确认」，所以从日志上看一切正常。
 *
 * 实测后果：CTS 的 Meta 广告线索每小时 10 条全是 `already_member`，跑了整整一
 * 个月，来源标签在他们名单里**从来没出现过** —— 广告归因证据一条都没落地。
 *
 * 这里补的那一刀走 `POST /members/{hash}/tags`（`applyMemberTags`），那是
 * Mailchimp 用来改**已有**会员标签的入口，天然幂等。
 *
 * ## 打标签失败不改变会员关系的结论
 *
 * 人确实在名单里，这件事是真的，不因为标签没打上就变假 —— 所以 status 仍是
 * `already_member`。但**失败必须说出来**：`tagRepair` 带着原因回给上游，让它
 * 进 tally、进今日待办。「拿不到 ≠ 没有」，这正是这条链路上一次栽的跟头。
 */
export async function subscribeMemberEnsuringTag(
  input: SubscribeMemberInput,
): Promise<SubscribeMemberResult & { tagRepair?: TagRepair }> {
  const res = await subscribeMember(input)
  if (res.status !== 'already_member') return res
  return { ...res, tagRepair: await repairTag(input) }
}

/** 给一个确认已在名单里的人补上来源标签。永不抛。 */
async function repairTag(input: SubscribeMemberInput): Promise<TagRepair> {
  const tag = input.tag?.trim()
  if (!tag) return 'not_attempted'

  const r = await applyMemberTags(
    {
      apiKey: input.apiKey,
      audienceId: input.audienceId,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
    },
    input.email,
    { add: [tag] },
  )

  if (r.status === 'applied') return 'applied'
  // `nothing_to_do` 上面已经挡掉（tag 非空），走到这里的 noop 只会是 already_correct。
  if (r.status === 'noop') return 'already_tagged'
  // `not_in_audience`：Mailchimp 前一秒才说这人存在，这一秒查不到。多半是刚被
  // archive/cleaned。不当成功，如实上报。
  return `failed:${r.reason}`
}
