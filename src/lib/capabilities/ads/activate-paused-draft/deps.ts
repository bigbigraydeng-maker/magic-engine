/**
 * 「开启暂停广告」执行体的依赖契约与输入解析。
 *
 * 为什么单独一个文件：
 *   执行体要读库、读 Meta、读授权记录 —— 这些全是副作用。把它们收进一个
 *   `ActivateDeps` 接口，执行体本身就能纯函数式测试（注入假 deps）。
 *
 * 🔴 为什么解析要「严格」而不是「尽力而为」：
 *   这个动作会真花钱。runInput 是 Kernel 从上游传下来的 JSON，字段可能缺、
 *   可能是错的类型。任何一处没解析出来，宁可当场报错点名哪个字段，也不要
 *   带着 undefined 往下走 —— 那会变成「拿 undefined 去开广告」。
 *
 * 🔴 为什么账户号要归一化：
 *   Meta 返回的 account_id 常带 `act_` 前缀，注册表里存的可能不带。比较归属
 *   之前一律先去掉前缀、trim，否则会把同一个账户判成两个。
 */

import type { MetaFingerprint, MetaFingerprintRaw } from '@/lib/ads-strategy/meta-fingerprint'
import type { RawMetaAdCreative, RawMetaAdSet } from '@/lib/ads-strategy/meta-readback-adapter'
import type { BudgetAccountFact } from '@/lib/ads-strategy/activation-budget'
import type { KillState } from '@/lib/ads-strategy/activation-kill'

/** 统一的「成功或失败」返回。失败带一句给人看的中文原因。 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** 去掉 act_ 前缀、trim。账户号比较一律先归一化。 */
export function normalizeAccountId(id: string): string {
  const trimmed = id.trim()
  return trimmed.toLowerCase().startsWith('act_') ? trimmed.slice(4) : trimmed
}

/** Kernel 传进来的 runInput，解析后的强类型。 */
export interface ActivateInput {
  draftActionId: string
  draftHash: string
  adAccountId: string // 已归一化
  campaignId: string
  adSetId: string
  adIds: string[]
  dailyBudgetCents: number // 正整数
  currency: string
  capCentsSnapshot: number // 正整数
  metaFingerprint: MetaFingerprint // 严格校验后的强类型
}

/** 非空字符串（trim 后）。 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** 正整数。 */
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** 普通对象（非 null、非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 严格解析指纹：campaign / adSet 非空字符串，ads 是「键值都是字符串」的非空对象。 */
function parseFingerprint(v: unknown): Result<MetaFingerprint> {
  if (!isRecord(v)) return { ok: false, error: 'meta_fingerprint 不是对象' }
  if (!isNonEmptyString(v.campaign)) {
    return { ok: false, error: 'meta_fingerprint.campaign 不是非空字符串' }
  }
  if (!isNonEmptyString(v.adSet)) {
    return { ok: false, error: 'meta_fingerprint.adSet 不是非空字符串' }
  }
  if (!isRecord(v.ads)) {
    return { ok: false, error: 'meta_fingerprint.ads 不是对象' }
  }
  const ads: Record<string, string> = {}
  for (const [key, value] of Object.entries(v.ads)) {
    if (typeof value !== 'string') {
      return { ok: false, error: `meta_fingerprint.ads['${key}'] 不是字符串` }
    }
    ads[key] = value
  }
  if (Object.keys(ads).length === 0) {
    return { ok: false, error: 'meta_fingerprint.ads 是空的' }
  }
  return { ok: true, value: { campaign: v.campaign, adSet: v.adSet, ads } }
}

/** 严格解析 runInput：字段缺失/类型不对/ads 为空 → { ok:false, error } 并点名哪个字段。 */
export function parseActivateInput(
  runInput: Readonly<Record<string, unknown>>,
): Result<ActivateInput> {
  const draftActionId = runInput.draft_action_id
  if (!isNonEmptyString(draftActionId)) {
    return { ok: false, error: 'draft_action_id 不是非空字符串' }
  }
  const draftHash = runInput.draft_hash
  if (!isNonEmptyString(draftHash)) {
    return { ok: false, error: 'draft_hash 不是非空字符串' }
  }
  const adAccountId = runInput.ad_account_id
  if (!isNonEmptyString(adAccountId)) {
    return { ok: false, error: 'ad_account_id 不是非空字符串' }
  }
  const campaignId = runInput.campaign_id
  if (!isNonEmptyString(campaignId)) {
    return { ok: false, error: 'campaign_id 不是非空字符串' }
  }
  const adSetId = runInput.ad_set_id
  if (!isNonEmptyString(adSetId)) {
    return { ok: false, error: 'ad_set_id 不是非空字符串' }
  }
  const currency = runInput.currency
  if (!isNonEmptyString(currency)) {
    return { ok: false, error: 'currency 不是非空字符串' }
  }

  const rawAdIds = runInput.ad_ids
  if (!Array.isArray(rawAdIds)) {
    return { ok: false, error: 'ad_ids 不是数组' }
  }
  const adIds: string[] = []
  for (const raw of rawAdIds) {
    if (!isNonEmptyString(raw)) {
      return { ok: false, error: 'ad_ids 里有不是非空字符串的元素' }
    }
    adIds.push(raw)
  }
  if (adIds.length === 0) {
    return { ok: false, error: 'ad_ids 是空的' }
  }

  const dailyBudgetCents = runInput.daily_budget_cents
  if (!isPositiveInt(dailyBudgetCents)) {
    return { ok: false, error: 'daily_budget_cents 不是正整数' }
  }
  const capCentsSnapshot = runInput.cap_cents_snapshot
  if (!isPositiveInt(capCentsSnapshot)) {
    return { ok: false, error: 'cap_cents_snapshot 不是正整数' }
  }

  const fingerprint = parseFingerprint(runInput.meta_fingerprint)
  if (!fingerprint.ok) return fingerprint

  return {
    ok: true,
    value: {
      draftActionId,
      draftHash,
      adAccountId: normalizeAccountId(adAccountId),
      campaignId,
      adSetId,
      adIds,
      dailyBudgetCents,
      currency,
      capCentsSnapshot,
      metaFingerprint: fingerprint.value,
    },
  }
}

/** Meta 上某一层对象的现场状态。 */
export interface LiveObject {
  id: string
  accountId: string | null // Meta 返回的 account_id（可能带 act_）；读不到是 null
  status: string | null // 配置状态 ACTIVE/PAUSED/…；读不到是 null
}

/** 开启前从 Meta 现场读回的整套草案状态（由真实读取层产生，预检只消费它）。 */
export interface LiveDraftState {
  campaign: LiveObject
  adSet: LiveObject & { endTimeMs: number | null; dailyBudgetCents: number | null }
  ads: LiveObject[]
  siblingAdSetIds: string[] // 该系列下**全部**广告组 id
  siblingAdIds: string[] // 该广告组下**全部**广告 id
  fingerprintRaw: MetaFingerprintRaw // 供 computeMetaFingerprint
  adSetReadback: RawMetaAdSet // 供 checkLaunch
  adsReadback: RawMetaAdCreative[] // 供 checkLaunch 与红线重扫（texts 为买家可见文字）
}

export interface BudgetFacts {
  accounts: BudgetAccountFact[]
  clientCapCents: number | null
}

export interface ActivateDeps {
  now(): number
  readKillState(clientId: string): Promise<KillState>
  /** 读本 run 当前指向的那条授权记录的签批人邮箱（authorization_decisions.decided_by_user）。 */
  readDecisionApprover(decisionId: string): Promise<Result<{ email: string | null }>>
  isApprover(email: string | null | undefined): boolean
  listRegisteredAccounts(clientId: string): Promise<{ ids: string[]; error?: string }>
  /** 读草案账本记录当前的状态（flywheel_actions.payload.status）。 */
  readDraftStatus(clientId: string, draftActionId: string): Promise<Result<{ status: string | null }>>
  readLiveState(clientId: string, input: ActivateInput): Promise<Result<LiveDraftState>>
  loadRedlines(clientId: string): Promise<string[] | null> // null = 读不到
  loadBudgetFacts(
    clientId: string,
    registeredAccountIds: readonly string[],
  ): Promise<Result<BudgetFacts>>
}
