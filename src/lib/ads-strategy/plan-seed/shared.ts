import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import type { AdPlay } from './ad-plays'
import { STALE_AFTER_MS } from './constants'
import type { ReadState } from './eligibility'
import type { Basis, PlanSeedStep } from './types'

export interface PlanSeedDeps {
  now(): Date
  loadOwnedAccounts(clientId: string): Promise<{ id: string; cap: number | null; label: string | null }[] | null>
  loadFacts(clientId: string, adAccountId: string): Promise<AdsDraftFacts>
  loadCaptureAt(clientId: string, adAccountId: string): Promise<string | null>
  loadClientPageId(clientId: string): Promise<string | null>
  getPageToken(clientId: string, pageId: string): Promise<string | null>
  readForms(pageId: string, pageToken: string): Promise<ReadState<{ id: string; active: boolean }[]>>
  readScopes(clientId: string): Promise<{ source: string; scopes: ReadState<string[]> } | null>
  readPromotePages(clientId: string, adAccountId: string): Promise<ReadState<string[]>>
  playbookShare(clientId: string): Promise<number>
}

export type SafeResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface Candidate {
  id: string
  cap: number | null
  label: string | null
}

export interface AccountData {
  id: string
  facts: AdsDraftFacts | null
  captureAt: string | null
  promotePages: ReadState<string[]>
}

export interface SharedContext {
  pageId: string | null
  pageToken: ReadState<true>
  /** 页面访问令牌本身，只在内部传给 readForms，不写进种子。 */
  pageTokenValue: string | null
  scopes: ReadState<string[]>
  tokenSource: string | null
  forms: ReadState<{ id: string; active: boolean }[]>
}

export interface EligibilityOutcome {
  eligible: boolean
  why_empty?: string
  basis: Basis[]
  notes: string[]
}

export interface PassingStep {
  play: AdPlay
  accountId: string
  account: AccountData
  eligibility: EligibilityOutcome
  /** 这个打法下所有合格的候选账户（用来在依据里列出来）。 */
  eligibleAccounts: AccountData[]
}

export interface Accumulator {
  steps: PlanSeedStep[]
  skipped: { step_key: string; why_empty: string }[]
  notes: string[]
  capturedAt: Record<string, string | null>
  currency: string | null
  done: boolean
}

/** 把任意异常转成中文可读的原因字符串。 */
export function errorReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return '未知错误'
}

/** 包住一次依赖调用：永不抛错，失败时返回原因。 */
export async function safe<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (err) {
    return { ok: false, reason: errorReason(err) }
  }
}

/** 抓取时间是否过期（读不到、解析失败、超过 6.5 小时都算过期）。 */
export function isStale(captureAt: string | null, nowMs: number): boolean {
  if (captureAt === null) return true
  const parsed = Date.parse(captureAt)
  if (Number.isNaN(parsed)) return true
  return nowMs - parsed > STALE_AFTER_MS
}
