/**
 * Instagram 发布回执 + 扫描决策 —— 纯函数模块，不做任何 I/O。
 *
 * 为什么单独一个模块：Facebook Reel 发布后，第二步会通过 Publer 把同一条
 * Reel 交叉发布到 Instagram。这一步把机器可读的回执写进 work order 的
 * `output` JSON 的 `instagram_publish` 键下。回执的状态机、失败分类、退避
 * 策略、以及"现在该不该处理这个 work order"的决策，全部集中在这里，方便
 * 单测覆盖，不依赖数据库或网络。
 *
 * 🔴 下游必须依赖的语义：
 *  - `no_publish` / `authorization` 由 `provider_state` 派生：Publer 接受为
 *    *草稿* 不等于已公开，所以草稿态必须 `no_publish=true` 且
 *    `authorization='DRAFT_ONLY'`，与 instagram-publish-event.ts 的规则一致。
 *  - `attempts` 只统计 `failure_kind === 'other'` 的失败；账号类失败不计入，
 *    因为账号问题需要人工介入，重试次数没有意义。
 *  - 所有函数都接收 `now: Date`，绝不自己调用 `new Date()`，保证可测。
 */

export const INSTAGRAM_RECEIPT_KEY = 'instagram_publish' as const

/** 认领/创建阶段超过这个时长视为卡死，可以重新处理或对账。 */
export const STALE_CLAIM_MS = 15 * 60 * 1000

/**
 * 只跟发「Facebook 刚发出的」片:超过这个时长的旧片不再自动交叉发布(主流程与待办共用这一个口径)。
 * 为什么要有:第一次给客户配上 Instagram 时,库里躺着一堆更早已发布的 Facebook 片 ——
 * 不设上限,它们会在开关打开的那一轮被当成新片批量排期出去。
 */
export const MAX_FB_AGE_MS = 48 * 60 * 60 * 1000

/** 'other' 类失败最多重试次数，超过后需要人工。 */
export const MAX_OTHER_ATTEMPTS = 3

/**
 * 账号类失败的固定重试间隔（分钟）。
 * 取 50 而不是 60:发布任务每小时第 5 分钟跑一次,失败回执写在那一轮之后几分钟,
 * 写 60 会让下一轮还差几分钟、被推迟到再下一轮(实际每 2 小时才试一次)。
 */
export const ACCOUNT_RETRY_MINUTES = 50

/** 'other' 类失败的退避基数（分钟），按 2^attempts 指数增长。 */
export const OTHER_BACKOFF_MINUTES = 10

export type InstagramReceiptStatus =
  | 'claiming'
  | 'creating'
  | 'draft'
  | 'scheduled'
  | 'failed'

export type InstagramFailureKind = 'account' | 'other'

export interface InstagramPublishReceipt {
  schema_version: 1
  status: InstagramReceiptStatus
  work_order_id: string
  client_id: string
  publer_account_id: string
  request_id: string
  /** 只统计 'other' 类失败次数。 */
  attempts: number
  media_id?: string
  post_id?: string
  provider_state?: 'draft' | 'scheduled'
  scheduled_at?: string
  permalink?: string
  first_comment_requested: boolean
  /** 只有 Publer 草稿存在时为 true。 */
  no_publish: boolean
  authorization: 'DRAFT_ONLY' | 'AUTHORIZED'
  cost_usd: 0
  /** 简短、已由调用方脱敏的错误信息。 */
  error?: string
  failure_kind?: InstagramFailureKind
  /** null 表示不自动重试（需要人工）。 */
  next_retry_at?: string | null
  /** 建帖后读回没找到幂等标记:防重复发布的对账可能失效(首次真连草稿验证要看这一项) */
  idempotency_unverified?: boolean
  event_ids?: string[]
  created_at: string
  updated_at: string
}

const VALID_STATUSES: readonly InstagramReceiptStatus[] = [
  'claiming',
  'creating',
  'draft',
  'scheduled',
  'failed',
]

/** 把 unknown 收窄成普通对象（非数组、非 null）。 */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function isStatus(value: unknown): value is InstagramReceiptStatus {
  return (
    typeof value === 'string' &&
    (VALID_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * 从 work order 的 `output` JSON 中读取回执。
 * 只校验必需字段，可选字段信任调用方写入的内容（写入路径已由 builder 保证）。
 */
export function readReceipt(output: unknown): InstagramPublishReceipt | null {
  const root = asPlainObject(output)
  if (root === null) return null
  const raw = asPlainObject(root[INSTAGRAM_RECEIPT_KEY])
  if (raw === null) return null
  if (raw.schema_version !== 1) return null
  if (!isStatus(raw.status)) return null
  if (typeof raw.work_order_id !== 'string') return null
  if (typeof raw.client_id !== 'string') return null
  if (typeof raw.publer_account_id !== 'string') return null
  if (typeof raw.request_id !== 'string') return null
  if (typeof raw.created_at !== 'string') return null
  if (typeof raw.updated_at !== 'string') return null
  if (typeof raw.attempts !== 'number') return null
  if (typeof raw.first_comment_requested !== 'boolean') return null
  if (typeof raw.no_publish !== 'boolean') return null
  return copyReceipt(raw, raw.status)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 逐字段拷出回执(不做整体类型断言):必需字段上面已校验,可选字段按类型各自收窄。 */
function copyReceipt(raw: Record<string, unknown>, status: InstagramReceiptStatus): InstagramPublishReceipt {
  const out: InstagramPublishReceipt = {
    schema_version: 1,
    status,
    work_order_id: String(raw.work_order_id),
    client_id: String(raw.client_id),
    publer_account_id: String(raw.publer_account_id),
    request_id: String(raw.request_id),
    attempts: Number(raw.attempts),
    first_comment_requested: raw.first_comment_requested === true,
    no_publish: raw.no_publish === true,
    authorization: raw.authorization === 'AUTHORIZED' ? 'AUTHORIZED' : 'DRAFT_ONLY',
    cost_usd: 0,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  }
  const mediaId = optionalString(raw.media_id)
  if (mediaId !== undefined) out.media_id = mediaId
  const postId = optionalString(raw.post_id)
  if (postId !== undefined) out.post_id = postId
  if (raw.provider_state === 'draft' || raw.provider_state === 'scheduled') out.provider_state = raw.provider_state
  const scheduledAt = optionalString(raw.scheduled_at)
  if (scheduledAt !== undefined) out.scheduled_at = scheduledAt
  const permalink = optionalString(raw.permalink)
  if (permalink !== undefined) out.permalink = permalink
  const error = optionalString(raw.error)
  if (error !== undefined) out.error = error
  if (raw.failure_kind === 'account' || raw.failure_kind === 'other') out.failure_kind = raw.failure_kind
  if (raw.next_retry_at === null) out.next_retry_at = null
  else {
    const retryAt = optionalString(raw.next_retry_at)
    if (retryAt !== undefined) out.next_retry_at = retryAt
  }
  if (raw.idempotency_unverified === true) out.idempotency_unverified = true
  if (Array.isArray(raw.event_ids)) out.event_ids = raw.event_ids.filter((x): x is string => typeof x === 'string')
  return out
}

/**
 * 返回一个 NEW 对象：浅拷贝 `output`（非对象视为 `{}`），把回执写到键下。
 * 兄弟键全部保留，绝不修改入参。
 */
export function withReceipt(
  output: unknown,
  receipt: InstagramPublishReceipt,
): Record<string, unknown> {
  const base = asPlainObject(output) ?? {}
  return { ...base, [INSTAGRAM_RECEIPT_KEY]: receipt }
}

export interface NewClaimArgs {
  workOrderId: string
  clientId: string
  publerAccountId: string
  requestId: string
  live: boolean
  firstCommentRequested: boolean
  now: Date
  prev?: InstagramPublishReceipt | null
}

/**
 * 新建认领回执。`attempts` 从 prev 继承（无则 0），但错误/退避/事件 id 一律
 * 不继承 —— 新一次尝试是干净的开始。
 */
export function newClaim(args: NewClaimArgs): InstagramPublishReceipt {
  const prev = args.prev ?? null
  const nowIso = args.now.toISOString()
  const receipt: InstagramPublishReceipt = {
    schema_version: 1,
    status: 'claiming',
    work_order_id: args.workOrderId,
    client_id: args.clientId,
    publer_account_id: args.publerAccountId,
    request_id: args.requestId,
    attempts: prev?.attempts ?? 0,
    first_comment_requested: args.firstCommentRequested,
    no_publish: !args.live,
    authorization: args.live ? 'AUTHORIZED' : 'DRAFT_ONLY',
    cost_usd: 0,
    created_at: prev?.created_at ?? nowIso,
    updated_at: nowIso,
  }
  if (prev?.media_id !== undefined) {
    receipt.media_id = prev.media_id
  }
  return receipt
}

/** 标记为正在创建媒体。 */
export function markCreating(
  r: InstagramPublishReceipt,
  mediaId: string,
  now: Date,
): InstagramPublishReceipt {
  return {
    ...r,
    status: 'creating',
    media_id: mediaId,
    updated_at: now.toISOString(),
  }
}

export interface MarkSubmittedArgs {
  postId: string
  providerState: 'draft' | 'scheduled'
  scheduledAt?: string
  permalink?: string
  idempotencyUnverified?: boolean
}

/**
 * 标记 Publer 已接受提交。`no_publish` / `authorization` 由 providerState
 * 派生，与 instagram-publish-event.ts 的规则保持一致。
 */
export function markSubmitted(
  r: InstagramPublishReceipt,
  args: MarkSubmittedArgs,
  now: Date,
): InstagramPublishReceipt {
  const isDraft = args.providerState === 'draft'
  const next: InstagramPublishReceipt = {
    ...r,
    status: args.providerState,
    post_id: args.postId,
    provider_state: args.providerState,
    no_publish: isDraft,
    authorization: isDraft ? 'DRAFT_ONLY' : 'AUTHORIZED',
    updated_at: now.toISOString(),
  }
  if (args.scheduledAt !== undefined) next.scheduled_at = args.scheduledAt
  if (args.permalink !== undefined) next.permalink = args.permalink
  if (args.idempotencyUnverified === true) next.idempotency_unverified = true
  delete next.error
  delete next.failure_kind
  delete next.next_retry_at
  return next
}

export interface MarkFailedArgs {
  error: string
  kind: InstagramFailureKind
}

const EMPTY_ERROR = '发布失败(原因未记录)'

function sanitizeError(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return EMPTY_ERROR
  return trimmed.slice(0, 200)
}

/**
 * 标记失败。账号类失败不计入 attempts（需要人工重连），固定 60 分钟后重试；
 * 'other' 类失败 attempts+1，退避 10 * 2^old 分钟，达到上限后 next_retry_at
 * 置 null 表示需要人工。
 */
export function markFailed(
  r: InstagramPublishReceipt,
  args: MarkFailedArgs,
  now: Date,
): InstagramPublishReceipt {
  const error = sanitizeError(args.error)
  const updatedAt = now.toISOString()
  if (args.kind === 'account') {
    const retryAt = new Date(
      now.getTime() + ACCOUNT_RETRY_MINUTES * 60 * 1000,
    ).toISOString()
    return {
      ...r,
      status: 'failed',
      error,
      failure_kind: 'account',
      next_retry_at: retryAt,
      updated_at: updatedAt,
    }
  }
  const oldAttempts = r.attempts
  const newAttempts = oldAttempts + 1
  const nextRetryAt =
    newAttempts >= MAX_OTHER_ATTEMPTS
      ? null
      : new Date(
          now.getTime() +
            OTHER_BACKOFF_MINUTES * 2 ** oldAttempts * 60 * 1000,
        ).toISOString()
  return {
    ...r,
    status: 'failed',
    error,
    failure_kind: 'other',
    attempts: newAttempts,
    next_retry_at: nextRetryAt,
    updated_at: updatedAt,
  }
}

/**
 * 是否需要人工介入：账号类失败（需要人重连账号），或已到终态（next_retry_at
 * 为 null，自动重试已放弃）。
 */
export function needsHuman(r: InstagramPublishReceipt): boolean {
  if (r.status !== 'failed') return false
  if (r.failure_kind === 'account') return true
  return r.next_retry_at === null
}

export type FacebookVideoState = 'DRAFT' | 'PUBLISHED' | undefined | null

export type SweepDecision =
  | { action: 'run' }
  | { action: 'reconcile' }
  | { action: 'skip'; reason: string }

export interface DecideSweepArgs {
  receipt: InstagramPublishReceipt | null
  fbVideoState: FacebookVideoState
  live: boolean
  now: Date
}

/** 解析时间戳；无法解析时返回 Infinity（视为"足够旧"）。 */
function parseAge(iso: string, now: Date): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return now.getTime() - t
}

/** 解析重试时间；无法解析时视为"已到期"。 */
function isRetryDue(iso: string, now: Date): boolean {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return true
  return t <= now.getTime()
}

/**
 * 扫描决策：现在该不该处理这个 work order？
 * 规则顺序很重要 —— 先保证"Instagram 不能先于 Facebook 上线"，再处理回执状态。
 */
export function decideSweep(args: DecideSweepArgs): SweepDecision {
  const { receipt, fbVideoState, live, now } = args

  // 1. live 但 FB 还没 PUBLISHED：Instagram 绝不能先上线。
  if (live && fbVideoState !== 'PUBLISHED') {
    return { action: 'skip', reason: 'fb_not_live' }
  }

  // 2. FB 状态未知：绝不交叉发布来源不明的 work order。
  if (fbVideoState !== 'DRAFT' && fbVideoState !== 'PUBLISHED') {
    return { action: 'skip', reason: 'fb_state_unknown' }
  }

  // 3. 没有回执：可以跑。
  if (receipt === null) {
    return { action: 'run' }
  }

  // 4. 已经完成（草稿或已排期）：跳过。
  if (receipt.status === 'draft' || receipt.status === 'scheduled') {
    return { action: 'skip', reason: 'already_done' }
  }

  // 5. claiming：卡死则重跑，否则视为在途。
  if (receipt.status === 'claiming') {
    const age = parseAge(receipt.updated_at, now)
    if (age >= STALE_CLAIM_MS) return { action: 'run' }
    return { action: 'skip', reason: 'in_flight' }
  }

  // 6. creating：卡死则对账（绝不盲目重建），否则视为在途。
  if (receipt.status === 'creating') {
    const age = parseAge(receipt.updated_at, now)
    if (age >= STALE_CLAIM_MS) return { action: 'reconcile' }
    return { action: 'skip', reason: 'in_flight' }
  }

  // 7. failed：终态跳过，未到期跳过，否则重跑。
  if (receipt.next_retry_at === null) {
    return { action: 'skip', reason: 'terminal' }
  }
  if (receipt.next_retry_at !== undefined) {
    if (!isRetryDue(receipt.next_retry_at, now)) {
      return { action: 'skip', reason: 'backoff' }
    }
  }
  return { action: 'run' }
}
