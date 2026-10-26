import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import type { AdPlay } from './ad-plays'
import { STALE_AFTER_MS } from './constants'
import { judgeEligibility, type ReadState } from './eligibility'
import { formatMinor } from './format'
import { splitBudget, type HalveFlags } from './split-budget'
import type { Basis, Field, PlanSeed, PlanSeedStep } from './types'

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

export interface BuildArgs {
  clientId: string
  plays: AdPlay[]
  period: { start_date: string; end_date: string } | null
  humanCommitted?: { byAccount: Record<string, number>; all: number }
}

type SafeResult<T> = { ok: true; value: T } | { ok: false; reason: string }

interface Candidate {
  id: string
  cap: number | null
  label: string | null
}

interface AccountData {
  id: string
  facts: AdsDraftFacts | null
  captureAt: string | null
  promotePages: ReadState<string[]>
}

interface SharedContext {
  pageId: string | null
  pageToken: ReadState<true>
  /** 页面访问令牌本身，只在内部传给 readForms，不写进种子。 */
  pageTokenValue: string | null
  scopes: ReadState<string[]>
  tokenSource: string | null
  forms: ReadState<{ id: string; active: boolean }[]>
}

interface EligibilityOutcome {
  eligible: boolean
  why_empty?: string
  basis: Basis[]
  notes: string[]
}

interface PassingStep {
  play: AdPlay
  accountId: string
  account: AccountData
  eligibility: EligibilityOutcome
  /** 这个打法下所有合格的候选账户（用来在依据里列出来）。 */
  eligibleAccounts: AccountData[]
}

interface Accumulator {
  steps: PlanSeedStep[]
  skipped: { step_key: string; why_empty: string }[]
  notes: string[]
  capturedAt: Record<string, string | null>
  currency: string | null
  done: boolean
}

const DEFAULT_TIMEOUT_MS = 8000
const SNAPSHOT_SOURCE = '广告快照'
const CAPTURE_SOURCE = 'ad_snapshot_captures'

/** 把任意异常转成中文可读的原因字符串。 */
function errorReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return '未知错误'
}

/** 包住一次依赖调用：永不抛错，失败时返回原因。 */
async function safe<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (err) {
    return { ok: false, reason: errorReason(err) }
  }
}

/** 抓取时间是否过期（读不到、解析失败、超过 6.5 小时都算过期）。 */
function isStale(captureAt: string | null, nowMs: number): boolean {
  if (captureAt === null) return true
  const parsed = Date.parse(captureAt)
  if (Number.isNaN(parsed)) return true
  return nowMs - parsed > STALE_AFTER_MS
}

/** 账户快照里的币种；读不到或为空时返回 null。 */
function currencyOfFacts(facts: AdsDraftFacts | null): string | null {
  if (facts === null) return null
  if (facts.headroom.ok !== true) return null
  const cur = facts.headroom.currency.trim()
  return cur === '' ? null : cur
}

/** 账户级可用余量：日上限 - 在投预算；读不全按 0 算。 */
function accountLevelRoom(facts: AdsDraftFacts | null): number {
  if (facts === null) return 0
  if (facts.account_cap_minor === null || facts.account_delivering_minor === null) return 0
  return Math.max(0, facts.account_cap_minor - facts.account_delivering_minor)
}

/** 客户余量与账户余量取小；读不全按 0 算（用于排序）。 */
function accountRoom(facts: AdsDraftFacts | null): number {
  if (facts === null) return 0
  const headroomClient = facts.headroom.ok ? facts.headroom.headroom_minor : null
  const acct = accountLevelRoom(facts)
  const acctKnown = facts.account_cap_minor !== null && facts.account_delivering_minor !== null
  if (headroomClient === null || !acctKnown) return 0
  return Math.min(headroomClient, acct)
}

/** 读一个账户的快照、抓取时间、可推广主页（每个账户只读一次）。 */
async function loadAccountData(
  clientId: string,
  accountId: string,
  deps: PlanSeedDeps,
): Promise<AccountData> {
  const [factsRes, captureRes, promoteRes] = await Promise.all([
    safe(() => deps.loadFacts(clientId, accountId)),
    safe(() => deps.loadCaptureAt(clientId, accountId)),
    safe(() => deps.readPromotePages(clientId, accountId)),
  ])
  const facts = factsRes.ok ? factsRes.value : null
  const captureAt = captureRes.ok ? captureRes.value : null
  const promotePages: ReadState<string[]> = promoteRes.ok
    ? promoteRes.value
    : { state: 'failed', reason: promoteRes.reason }
  return { id: accountId, facts, captureAt, promotePages }
}

/** 并发读取所有候选账户的数据。 */
async function loadAllAccounts(
  clientId: string,
  candidates: Candidate[],
  deps: PlanSeedDeps,
): Promise<AccountData[]> {
  return Promise.all(candidates.map((c) => loadAccountData(clientId, c.id, deps)))
}

/** 判断某个账户的币种是否已知。 */
function currencyKnownFor(facts: AdsDraftFacts | null): boolean {
  if (facts === null) return true
  if (facts.headroom.ok !== true) return true
  return facts.headroom.currency.trim() !== ''
}

/** 对某个打法 + 某个账户做合格性判断。 */
function evaluateEligibility(
  play: AdPlay,
  account: AccountData,
  ctx: SharedContext,
): EligibilityOutcome {
  return judgeEligibility({
    play: play.play,
    pageId: ctx.pageId,
    pageToken: ctx.pageToken,
    scopes: ctx.scopes,
    forms: ctx.forms,
    accountStatus: account.facts?.account_status ?? null,
    currencyKnown: currencyKnownFor(account.facts),
    promotePages: account.promotePages,
    tokenSource: ctx.tokenSource,
    accountId: account.id,
  })
}

/** 在合格账户里挑余量最大的（并列取候选顺序靠前的）。 */
function pickAccount(
  play: AdPlay,
  accounts: AccountData[],
  ctx: SharedContext,
): { passing: PassingStep | null; reasons: string[] } {
  const reasons: string[] = []
  const eligibleAccounts: AccountData[] = []
  let best: PassingStep | null = null
  let bestRoom = -1
  for (const account of accounts) {
    const outcome = evaluateEligibility(play, account, ctx)
    if (!outcome.eligible) {
      reasons.push(`${account.id}：${outcome.why_empty ?? '不合格'}`)
      continue
    }
    eligibleAccounts.push(account)
    const room = accountRoom(account.facts)
    if (room > bestRoom) {
      bestRoom = room
      best = { play, accountId: account.id, account, eligibility: outcome, eligibleAccounts }
    }
  }
  return { passing: best, reasons }
}

/** 生成"合格候选账户"依据列表。 */
function candidateBasis(accounts: AccountData[]): Basis[] {
  return accounts.map((a) => ({
    label: '合格候选账户',
    value: `${a.id}：可用余量 ${formatMinor(accountRoom(a.facts), currencyOfFacts(a.facts))}（读不全按 0 算）`,
    source: SNAPSHOT_SOURCE,
    as_of: a.captureAt,
  }))
}

/** 生成"余量数据抓取时间"依据。 */
function captureBasis(captureAt: string | null): Basis {
  return {
    label: '余量数据抓取时间',
    value: captureAt ?? '读不到抓取时间',
    source: CAPTURE_SOURCE,
    as_of: captureAt,
  }
}

/** 生成"是否有 ME 成功建过广告"依据（本版读不到）。 */
function meHistoryBasis(): Basis {
  return {
    label: '该账户是否有 ME 成功建过广告的记录',
    value: '本版读不到',
    source: '本版未接入',
    as_of: null,
  }
}

/** 组装 ad_account_id 字段（有值）。 */
function buildAccountField(passing: PassingStep): Field<string> {
  const basis: Basis[] = [
    ...candidateBasis(passing.eligibleAccounts),
    ...passing.eligibility.basis,
    meHistoryBasis(),
    captureBasis(passing.account.captureAt),
  ]
  const notes = ['这个数没算进该时间之后新开的广告']
  return { ok: true, value: passing.accountId, basis, notes }
}

/** 组装 page_id 字段（有值）。 */
function buildPageField(pageId: string): Field<string> {
  return {
    ok: true,
    value: pageId,
    basis: [
      {
        label: '客户主页',
        value: pageId,
        source: '客户设置（clients.facebook_page_id）',
        as_of: null,
      },
    ],
    notes: [],
  }
}

/** 收集已选账户的币种（大写去重）。 */
function collectCurrencies(passing: PassingStep[]): string[] {
  const set = new Set<string>()
  for (const p of passing) {
    const facts = p.account.facts
    if (facts !== null && facts.headroom.ok === true) {
      const cur = facts.headroom.currency.trim().toUpperCase()
      if (cur !== '') set.add(cur)
    }
  }
  return Array.from(set)
}

/** 已选账户里最小的客户余量（读不到按 0）。 */
function minClientHeadroom(passing: PassingStep[]): number {
  let min: number | null = null
  for (const p of passing) {
    const facts = p.account.facts
    if (facts !== null && facts.headroom.ok === true) {
      const h = facts.headroom.headroom_minor
      if (min === null || h < min) min = h
    }
  }
  return min ?? 0
}

/** 已选账户的账户级余量映射。 */
function accountHeadroomMap(passing: PassingStep[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const p of passing) {
    map[p.accountId] = accountLevelRoom(p.account.facts)
  }
  return map
}

/** 单个账户的保守口径标记。 */
function haveFlags(a: AccountData, nowMs: number): HalveFlags {
  return {
    stale: isStale(a.captureAt, nowMs),
    dailyUnknown: a.facts !== null && a.facts.daily === null,
  }
}

/** 客户层保守口径：所有候选账户里任一命中即命中。 */
function clientFlags(all: AccountData[], nowMs: number): HalveFlags {
  let stale = false
  let dailyUnknown = false
  for (const a of all) {
    const f = haveFlags(a, nowMs)
    if (f.stale) stale = true
    if (f.dailyUnknown) dailyUnknown = true
  }
  return { stale, dailyUnknown }
}

/** 账户层保守口径：只按已选账户逐个给出。 */
function accountFlagMap(passing: PassingStep[], nowMs: number): Record<string, HalveFlags> {
  const map: Record<string, HalveFlags> = {}
  for (const p of passing) {
    map[p.accountId] = haveFlags(p.account, nowMs)
  }
  return map
}

/** 预算字段为空时的原因（按优先级）。 */
function budgetEmptyReason(
  passing: PassingStep,
  splitWhy: string | undefined,
  multiCurrency: boolean,
): string {
  const facts = passing.account.facts
  if (facts === null) return '读不到这个账户的广告快照'
  if (facts.headroom.ok !== true) return `客户预算余量读不全：${facts.headroom.reason}`
  if (facts.account_cap_minor === null || facts.account_delivering_minor === null) {
    return '账户日上限或在投预算读不到'
  }
  if (multiCurrency) return '多币种，本版不做跨币种'
  return splitWhy ?? '预算余量不够这一步'
}

/** 组装单个通过步骤的 daily_budget_cents 字段。 */
function buildBudgetField(
  passing: PassingStep,
  budgetMinor: number | null,
  splitWhy: string | undefined,
  splitBasis: Basis[],
  multiCurrency: boolean,
): Field<number> {
  const facts = passing.account.facts
  const canValue =
    budgetMinor !== null &&
    facts !== null &&
    facts.headroom.ok === true &&
    facts.account_cap_minor !== null &&
    facts.account_delivering_minor !== null &&
    !multiCurrency
  if (canValue && budgetMinor !== null) {
    return {
      ok: true,
      value: budgetMinor,
      basis: [...splitBasis, captureBasis(passing.account.captureAt)],
      notes: [],
    }
  }
  return {
    ok: false,
    why_empty: budgetEmptyReason(passing, splitWhy, multiCurrency),
    notes: [],
  }
}

/** 组装一个完整的 PlanSeedStep。 */
function buildStep(
  passing: PassingStep,
  pageId: string,
  budget: Field<number>,
): PlanSeedStep {
  return {
    step_key: passing.play.step_key,
    play: passing.play.play,
    page_id: buildPageField(pageId),
    ad_account_id: buildAccountField(passing),
    daily_budget_cents: budget,
  }
}

/** 判断"没有合格账户"是否因为读不到（读不到≠没有）；返回原因或 null。 */
function unknownReason(
  play: AdPlay,
  accounts: AccountData[],
  ctx: SharedContext,
): string | null {
  const reasons: string[] = []
  const add = (r: string): void => {
    if (!reasons.includes(r)) reasons.push(r)
  }
  if (ctx.pageId !== null && ctx.pageId !== '' && ctx.pageToken.state === 'failed') {
    add('主页访问令牌')
  }
  if (play.play === 'lead_form_harvest' && ctx.scopes.state === 'failed') {
    add('令牌权限')
  }
  if (play.play === 'lead_form_harvest' && ctx.forms.state === 'failed') {
    add('表单列表')
  }
  if (accounts.some((a) => (a.facts?.account_status ?? null) === null)) {
    add('账户状态')
  }
  return reasons.length === 0 ? null : reasons.join('、')
}

/** 把每个打法映射到"通过 / 跳过"的结果。 */
function classifyPlays(
  plays: AdPlay[],
  accounts: AccountData[],
  ctx: SharedContext,
): {
  passing: PassingStep[]
  skipped: { step_key: string; why_empty: string }[]
  unknownDrops: { step_key: string; reason: string }[]
} {
  const passing: PassingStep[] = []
  const skipped: { step_key: string; why_empty: string }[] = []
  const unknownDrops: { step_key: string; reason: string }[] = []
  for (const play of plays) {
    const { passing: chosen, reasons } = pickAccount(play, accounts, ctx)
    if (chosen === null) {
      skipped.push({
        step_key: play.step_key,
        why_empty: `没有合格的广告账户：${reasons.join('；')}`,
      })
      const unknown = unknownReason(play, accounts, ctx)
      if (unknown !== null) {
        unknownDrops.push({ step_key: play.step_key, reason: unknown })
      }
      continue
    }
    passing.push(chosen)
  }
  return { passing, skipped, unknownDrops }
}

/** 组装所有通过步骤的预算字段（含 splitBudget 调用）。 */
async function buildBudgetFields(
  clientId: string,
  passing: PassingStep[],
  args: BuildArgs,
  deps: PlanSeedDeps,
  extra: {
    nowMs: number
    multiCurrency: boolean
    allAccounts: AccountData[]
    unknownDrops: { step_key: string; reason: string }[]
    currency: string | null
  },
): Promise<Map<string, Field<number>>> {
  const out = new Map<string, Field<number>>()
  if (passing.length === 0) return out

  const shareRes = await safe(() => deps.playbookShare(clientId))
  const share = shareRes.ok && Number.isFinite(shareRes.value) ? shareRes.value : null
  if (share === null) {
    for (const p of passing) {
      out.set(p.play.step_key, {
        ok: false,
        why_empty: '读不到剧本里的预算比例',
        notes: [],
      })
    }
    return out
  }

  const split = splitBudget({
    steps: passing.map((p) => ({ step_key: p.play.step_key, accountId: p.accountId })),
    clientHeadroomMinor: minClientHeadroom(passing),
    accountHeadroomMinor: accountHeadroomMap(passing),
    share,
    halve: {
      client: clientFlags(extra.allAccounts, extra.nowMs),
      account: accountFlagMap(passing, extra.nowMs),
    },
    currency: extra.currency,
    extraDivisor: extra.unknownDrops.length,
    humanCommitted: args.humanCommitted,
  })

  const k = extra.unknownDrops.length
  const N = passing.length + k
  const dropReasons: string[] = []
  for (const d of extra.unknownDrops) {
    if (!dropReasons.includes(d.reason)) dropReasons.push(d.reason)
  }
  const divisorBasis: Basis | null =
    k > 0
      ? {
          label: '除数说明',
          value: `本来 ${N} 步，其中 ${k} 步因为读不到${dropReasons.join('、')}被丢掉，除数仍按 ${N} 算（读不到≠没有）`,
          source: '剧本参数 + 广告快照',
          as_of: null,
        }
      : null

  const byKey = new Map(split.map((r) => [r.step_key, r]))
  for (const p of passing) {
    const r = byKey.get(p.play.step_key)
    const splitBasis = r?.basis ?? []
    if (divisorBasis !== null) splitBasis.push(divisorBasis)
    out.set(
      p.play.step_key,
      buildBudgetField(
        p,
        r?.budgetMinor ?? null,
        r?.why_empty,
        splitBasis,
        extra.multiCurrency,
      ),
    )
  }
  return out
}

/** 组装最终 PlanSeed。 */
function assemble(
  args: BuildArgs,
  acc: Accumulator,
  factsAsOf: string,
): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: factsAsOf,
    currency: acc.currency,
    period: args.period,
    captured_at: { ...acc.capturedAt },
    ad_steps: [...acc.steps],
    skipped: [...acc.skipped],
    notes: [...acc.notes],
  }
}

/** 把全部打法标记为跳过。 */
function skipAll(plays: AdPlay[], why: string): { step_key: string; why_empty: string }[] {
  return plays.map((p) => ({ step_key: p.step_key, why_empty: why }))
}

/** 读取主页与令牌，返回共享上下文的一部分。 */
async function loadPageContext(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ pageId: string | null; pageToken: ReadState<true>; pageTokenValue: string | null }> {
  const pageRes = await safe(() => deps.loadClientPageId(clientId))
  const pageId = pageRes.ok ? pageRes.value : null
  if (pageId === null || pageId === '') {
    return { pageId: null, pageToken: { state: 'failed', reason: '客户没配主页' }, pageTokenValue: null }
  }
  const tokenRes = await safe(() => deps.getPageToken(clientId, pageId))
  if (!tokenRes.ok) {
    return { pageId, pageToken: { state: 'failed', reason: tokenRes.reason }, pageTokenValue: null }
  }
  if (tokenRes.value === null || tokenRes.value === '') {
    return { pageId, pageToken: { state: 'empty' }, pageTokenValue: null }
  }
  return { pageId, pageToken: { state: 'ok', value: true }, pageTokenValue: tokenRes.value }
}

/** 读取令牌权限（只读一次）。 */
async function loadScopes(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ tokenSource: string | null; scopes: ReadState<string[]> }> {
  const res = await safe(() => deps.readScopes(clientId))
  if (!res.ok || res.value === null) {
    return { tokenSource: null, scopes: { state: 'failed', reason: '没有可用令牌' } }
  }
  return { tokenSource: res.value.source, scopes: res.value.scopes }
}

/** 读取即时表单（只读一次，且只在需要时）。 */
async function loadForms(
  plays: AdPlay[],
  pageId: string | null,
  pageToken: ReadState<true>,
  pageTokenValue: string | null,
  deps: PlanSeedDeps,
): Promise<ReadState<{ id: string; active: boolean }[]>> {
  const needsForms = plays.some((p) => p.play === 'lead_form_harvest')
  if (!needsForms || pageId === null || pageId === '' || pageToken.state !== 'ok' || pageTokenValue === null) {
    return { state: 'empty' }
  }
  const res = await safe(() => deps.readForms(pageId, pageTokenValue))
  if (!res.ok) return { state: 'failed', reason: res.reason }
  return res.value
}

/** 读取客户名下账户；失败或为空时返回原因。 */
async function loadCandidates(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ candidates: Candidate[]; why: string | null }> {
  const res = await safe(() => deps.loadOwnedAccounts(clientId))
  if (!res.ok) return { candidates: [], why: '读不到客户名下账户' }
  if (res.value === null) return { candidates: [], why: '读不到客户名下账户' }
  if (res.value.length === 0) return { candidates: [], why: '客户名下没有广告账户' }
  return { candidates: res.value, why: null }
}

/** 主工作函数：把结果写进累加器，永不抛错。 */
async function runWork(
  args: BuildArgs,
  deps: PlanSeedDeps,
  acc: Accumulator,
): Promise<void> {
  try {
    const nowMs = deps.now().getTime()
    const { candidates, why } = await loadCandidates(args.clientId, deps)
    if (why !== null) {
      acc.skipped = skipAll(args.plays, why)
      acc.done = true
      return
    }

    const { pageId, pageToken, pageTokenValue } = await loadPageContext(args.clientId, deps)
    const { tokenSource, scopes } = await loadScopes(args.clientId, deps)
    const forms = await loadForms(args.plays, pageId, pageToken, pageTokenValue, deps)
    const ctx: SharedContext = { pageId, pageToken, pageTokenValue, scopes, tokenSource, forms }

    const accounts = await loadAllAccounts(args.clientId, candidates, deps)
    for (const a of accounts) acc.capturedAt[a.id] = a.captureAt

    const { passing, skipped, unknownDrops } = classifyPlays(args.plays, accounts, ctx)
    acc.skipped = skipped

    const currencies = collectCurrencies(passing)
    const multiCurrency = currencies.length > 1
    acc.currency = currencies.length === 1 ? currencies[0] : null
    if (multiCurrency) acc.notes.push('多币种')

    const budgets = await buildBudgetFields(args.clientId, passing, args, deps, {
      nowMs,
      multiCurrency,
      allAccounts: accounts,
      unknownDrops,
      currency: acc.currency,
    })

    const steps: PlanSeedStep[] = []
    for (const p of passing) {
      const budget = budgets.get(p.play.step_key) ?? {
        ok: false,
        why_empty: '预算余量不够这一步',
        notes: [],
      }
      const pageIdValue = pageId ?? ''
      steps.push(buildStep(p, pageIdValue, budget))
    }
    acc.steps = steps
    acc.done = true
  } catch (err) {
    // 兜底：任何意外都只让剩余步骤跳过，不抛错。
    const reason = errorReason(err)
    const doneKeys = new Set(acc.steps.map((s) => s.step_key))
    const skippedKeys = new Set(acc.skipped.map((s) => s.step_key))
    for (const play of args.plays) {
      if (doneKeys.has(play.step_key) || skippedKeys.has(play.step_key)) continue
      acc.skipped.push({ step_key: play.step_key, why_empty: `取数出错：${reason}` })
    }
    acc.done = true
  }
}

/** 超时后从累加器组装：未完成的打法标记为取数超时。 */
function assembleOnTimeout(args: BuildArgs, acc: Accumulator, factsAsOf: string): PlanSeed {
  const doneKeys = new Set(acc.steps.map((s) => s.step_key))
  const skippedKeys = new Set(acc.skipped.map((s) => s.step_key))
  for (const play of args.plays) {
    if (doneKeys.has(play.step_key) || skippedKeys.has(play.step_key)) continue
    acc.skipped.push({ step_key: play.step_key, why_empty: '取数超时' })
  }
  acc.notes.push('取数超时，只返回已经算出的部分')
  return assemble(args, acc, factsAsOf)
}

/** 取当前时间的 ISO 字符串；时钟依赖抛错时退回系统时间，保证入口永不抛错。 */
function safeNowIso(deps: PlanSeedDeps): string {
  try {
    return deps.now().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** 空周期：直接返回空种子，不调用任何依赖（除 now）。 */
function emptyPeriodSeed(args: BuildArgs, deps: PlanSeedDeps): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: safeNowIso(deps),
    currency: null,
    period: null,
    captured_at: {},
    ad_steps: [],
    skipped: [],
    notes: ['目标没有周期，没法产出种子（不猜）'],
  }
}

/** 入口：永不抛错、永不 reject。 */
export async function buildPlanSeed(
  args: BuildArgs,
  deps: PlanSeedDeps,
  opts?: { timeoutMs?: number },
): Promise<PlanSeed> {
  if (args.period === null) return emptyPeriodSeed(args, deps)

  const factsAsOf = safeNowIso(deps)
  const acc: Accumulator = {
    steps: [],
    skipped: [],
    notes: [],
    capturedAt: {},
    currency: null,
    done: false,
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  try {
    const workPromise = runWork(args, deps, acc).then(() => 'done' as const)
    const winner = await Promise.race([workPromise, timeoutPromise])
    if (winner === 'timeout') {
      return assembleOnTimeout(args, acc, factsAsOf)
    }
    return assemble(args, acc, factsAsOf)
  } catch {
    // runWork 内部已兜底；这里再兜一层，保证永不 reject。
    return assembleOnTimeout(args, acc, factsAsOf)
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
