/**
 * 受限自治信封的**事实来源**（spec 2026-09-24 §3 G5）。
 *
 * Kernel 刻意不认识广告表；它只拿着 `EnvelopeFactsResolver` 这个接口。
 * 这个文件是广告域的实现：把「这一次要改什么」翻成信封判据要的那几项事实。
 *
 * 🔴 **一个字都不从提交方的 input 里取事实。** input 只允许说
 *    「要动哪个实体、想改成多少」；改动前是多少、账户合计多少、日上限多少、
 *    距上次变动几小时、在不在学习期、在不在实验里 —— 全部从
 *    `ad_entity_snapshots` / `ad_strategy_configs` 读。让被约束者自报约束
 *    等于没有约束。
 *
 * 🔴 **读不到一律返回 null / unavailable，交给判据拒绝。**
 *    这里不做「读不到就当没有」的兜底：那会让一次读失败等于一次静默放行。
 *
 * 🔴 **判据要落在正确的实体上。** 这一条踩过：
 *    换素材的 input 给的是**广告** id、新建广告组给的是**广告系列** id，
 *    只按广告组级去查的话这两类永远读不到事实、永远被拒 —— 功能看着上线了其实是死的。
 *    现在逐类解析「跟钱和学习期相关的那个广告组」：
 *      · 暂停 / 砍预算 / 加预算 → input.adset_id 本身
 *      · 换素材           → 这条广告所属的广告组（换素材会重置该组的学习期）
 *      · 新建再营销广告组   → 还不存在的东西没有学习期，判据**不适用**；
 *                          实验归属看它要挂进去的那个广告系列
 *      · 挪预算           → 计划级动作，单实体判据不适用 → 走人工
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnvelopeFactsResolver } from '@/lib/kernel/deps'
import type { EnvelopeChangeKind, EnvelopeFacts, EnvelopeRequest } from '@/lib/kernel/autonomy-envelope'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import { readCircuitState } from '@/lib/ads-strategy/circuit-state'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'

/** 每个广告动作对花费的性质。信封按性质分流（暂停不走变动比例，等等）。 */
const CHANGE_KIND: Readonly<Record<string, EnvelopeChangeKind>> = {
  'ads.pause_unit': 'pause',
  'ads.pause_campaign': 'pause',
  'ads.cut_unit_budget': 'budget_change',
  'ads.cut_campaign_budget': 'budget_change',
  'ads.scale_unit_budget': 'budget_change',
  'ads.budget_move_plan': 'budget_change',
  'ads.add_retargeting_adset': 'new_spend',
  'ads.swap_creative': 'creative_only',
}

interface SnapRow {
  id: string
  ad_account_id: string
  shared_account: boolean
  level: string
  entity_id: string
  adset_id: string | null
  campaign_id: string | null
  budget_level: string | null
  daily_budget_minor: number | null
  currency: string | null
  learning_stage: string | null
  ad_studies: unknown
  effective_status: string | null
  capture_reason: string
  captured_at: string
}

const SNAP_COLUMNS =
  'id, ad_account_id, shared_account, level, entity_id, adset_id, campaign_id, budget_level, daily_budget_minor, currency, learning_stage, ad_studies, effective_status, capture_reason, captured_at'

/**
 * 只有这些投放状态算「在花钱」，用来加总账户当日预算。
 *
 * 🔴 直接从诊断层 `context.ts` import —— 卫青 WP2 复审抓出：原本在这里另写了
 *    一份，跟诊断层不一致，还把 `CAMPAIGN_PAUSED`（其实是「所属系列被暂停」的
 *    信号，没在投放）当成在投放。真实场景是账户里但凡有几个历史关停的系列，
 *    「账户当日预算合计」就会一直虚高，把以后合法的加预算动作误挡。
 *    统一到诊断层的一份，改只改一处，两边不会分家。
 */
const DELIVERING = DELIVERING_STATUSES
const CLIENT_BUDGET_FACT_FRESH_MS = 24 * 60 * 60 * 1000
const CLIENT_BUDGET_ROW_LIMIT = 20_000
const POSTGREST_PAGE_SIZE = 1_000

interface ClientBudgetRollup {
  totalCents: number
  accountTotals: Map<string, number>
  accountCaps: Map<string, number>
  capCents: number
}

/**
 * 上调预算前，按客户全部已登记账户重新核算预算配置。
 * 所有账户都必须有近 24 小时内完整的账户/系列/广告组抓取回执；快照只用于读
 * 当前设置，任一账户、币种、预算或分页无法证明完整时都拒绝上调。
 */
async function loadClientBudgetRollup(
  sb: SupabaseClient,
  clientId: string,
  targetAccountId: string,
  targetLevel: 'adset' | 'campaign',
  targetEntityId: string,
  expectedTargetBeforeCents: number,
  clientCapCents: number | null,
  now: Date,
  at: 'authorize' | 'pre_provider',
): Promise<ClientBudgetRollup | { unavailable: string }> {
  const unavailable = (why: string) => ({ unavailable: `facts:${why}` } as const)
  if (!Number.isSafeInteger(clientCapCents) || clientCapCents === null || clientCapCents <= 0) {
    return unavailable('客户日预算总上限未配置或无效')
  }

  const { data: registry, error: registryError } = await sb
    .from('client_meta_ad_accounts')
    .select('ad_account_id, daily_budget_cap_cents')
    .eq('client_id', clientId)
  if (registryError) return unavailable(`读取客户广告账户清单失败：${registryError.message}`)
  let accounts = (registry ?? []) as Array<{ ad_account_id: string; daily_budget_cap_cents: number | null }>
  if (accounts.length === 0) {
    const { data: client, error: clientError } = await sb
      .from('clients')
      .select('meta_ad_account_id')
      .eq('id', clientId)
      .maybeSingle()
    if (clientError) return unavailable(`读取客户主广告账户失败：${clientError.message}`)
    const legacyId = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
    if (!legacyId) return unavailable('客户没有已登记的 Meta 广告账户')
    accounts = [{ ad_account_id: legacyId, daily_budget_cap_cents: clientCapCents }]
  }

  const accountIds = accounts.map(a => a.ad_account_id)
  if (!accountIds.includes(targetAccountId)) return unavailable('目标广告账户不在客户已登记账户清单内')
  const registeredCaps = accounts.map(a => a.daily_budget_cap_cents)
  const perAccountCaps = accounts.length === 1 && registeredCaps[0] == null
    ? [clientCapCents]
    : registeredCaps
  if (perAccountCaps.some(c => !Number.isSafeInteger(c) || c === null || c <= 0)) {
    return unavailable('客户有广告账户没有有效的账户级日预算上限')
  }
  const capTotal = (perAccountCaps as number[]).reduce((sum, cap) => sum + cap, 0)
  if (!Number.isSafeInteger(capTotal) || capTotal > clientCapCents) {
    return unavailable('各广告账户的日预算上限合计超过客户总上限')
  }

  const since = new Date(now.getTime() - CLIENT_BUDGET_FACT_FRESH_MS).toISOString()
  const captures: Array<{ ad_account_id: string; level: string; complete: boolean; skipped_shared: boolean; captured_at: string; capture_reason: string }> = []
  for (let offset = 0; ; offset += POSTGREST_PAGE_SIZE) {
    const { data: page, error } = await sb
      .from('ad_snapshot_captures')
      .select('ad_account_id, level, captured_at, complete, skipped_shared, capture_reason')
      .eq('client_id', clientId)
      .in('ad_account_id', accountIds)
      .in('level', ['account', 'campaign', 'adset'])
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .range(offset, offset + POSTGREST_PAGE_SIZE - 1)
    if (error) return unavailable(`读取跨账户快照回执失败：${error.message}`)
    const batch = (page ?? []) as typeof captures
    captures.push(...batch)
    if (captures.length > CLIENT_BUDGET_ROW_LIMIT) return unavailable('跨账户快照回执过多，无法证明数据完整')
    if (batch.length < POSTGREST_PAGE_SIZE) break
  }

  const latestCapture = new Map<string, (typeof captures)[number]>()
  for (const row of captures) {
    const key = `${row.ad_account_id}:${row.level}`
    if (!latestCapture.has(key)) latestCapture.set(key, row)
  }
  const rounds = new Set([...latestCapture.values()].map(row => row.captured_at))
  if (rounds.size !== 1) return unavailable('客户各账户不是同一轮快照，不能证明总预算完整')
  const roundAt = [...rounds][0]
  const roundTime = Date.parse(roundAt)
  if (!Number.isFinite(roundTime) || roundTime > now.getTime() || roundTime < now.getTime() - CLIENT_BUDGET_FACT_FRESH_MS) {
    return unavailable('客户预算快照时间无效或过期')
  }
  if (at === 'pre_provider' && [...latestCapture.values()].some(row => row.capture_reason !== 'kernel_pre')) {
    return unavailable('执行前缺少客户所有账户同一轮 kernel_pre 快照')
  }
  for (const accountId of accountIds) {
    for (const level of ['account', 'campaign', 'adset']) {
      const capture = latestCapture.get(`${accountId}:${level}`)
      if (!capture || !capture.complete || capture.skipped_shared) {
        return unavailable(`广告账户 ${accountId} 的${level}快照不完整或共用，不能核算客户总预算`)
      }
    }
  }

  const snapshots: SnapRow[] = []
  for (let offset = 0; ; offset += POSTGREST_PAGE_SIZE) {
    const { data: page, error } = await sb
      .from('ad_entity_snapshots')
      .select(SNAP_COLUMNS)
      .eq('client_id', clientId)
      .in('ad_account_id', accountIds)
      .in('level', ['account', 'campaign', 'adset'])
      .eq('captured_at', roundAt)
      .order('captured_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + POSTGREST_PAGE_SIZE - 1)
    if (error) return unavailable(`读取客户跨账户预算快照失败：${error.message}`)
    const batch = (page ?? []) as SnapRow[]
    snapshots.push(...batch)
    if (snapshots.length > CLIENT_BUDGET_ROW_LIMIT) return unavailable('跨账户预算快照超过安全读取上限')
    if (batch.length < POSTGREST_PAGE_SIZE) break
  }

  const rows = snapshots
  const latest = new Map<string, SnapRow>()
  for (const row of rows) {
    const key = `${row.ad_account_id}:${row.level}:${row.entity_id}`
    if (!latest.has(key)) latest.set(key, row)
  }

  const currencies = new Set<string>()
  const accountTotals = new Map<string, number>()
  for (const accountId of accountIds) {
    const accountRows = [...latest.values()].filter(r => r.ad_account_id === accountId)
    const accountSnap = accountRows.find(r => r.level === 'account')
    if (!accountSnap || accountSnap.shared_account || typeof accountSnap.currency !== 'string' || !accountSnap.currency.trim()) {
      return unavailable(`广告账户 ${accountId} 的币种或客户归属无法确认`)
    }
    const currency = accountSnap.currency.trim().toUpperCase()
    currencies.add(currency)
    if (accountRows.some(r => (r.level === 'campaign' || r.level === 'adset') && r.currency?.trim().toUpperCase() !== currency)) {
      return unavailable(`广告账户 ${accountId} 的预算币种与账户币种不一致`)
    }

    const campaigns = accountRows.filter(r => r.level === 'campaign')
    const adsets = accountRows.filter(r => r.level === 'adset')
    const cboCampaignIds = new Set<string>()
    let total = 0
    for (const campaign of campaigns) {
      if (campaign.capture_reason === 'disappeared' || !DELIVERING.has(campaign.effective_status ?? '')) continue
      if (campaign.budget_level === 'cbo') {
        cboCampaignIds.add(campaign.entity_id)
        const amount = campaign.daily_budget_minor
        if (!Number.isSafeInteger(amount) || amount === null || amount <= 0 || campaign.currency !== currency) {
          return unavailable(`投放中的广告系列 ${campaign.entity_id} 预算或币种无法确认`)
        }
        total += amount
      } else if (campaign.budget_level !== 'abo') {
        return unavailable(`投放中的广告系列 ${campaign.entity_id} 预算层级无法确认`)
      }
    }
    for (const adset of adsets) {
      if (adset.capture_reason === 'disappeared' || !DELIVERING.has(adset.effective_status ?? '')) continue
      if (adset.campaign_id && cboCampaignIds.has(adset.campaign_id)) continue
      const amount = adset.daily_budget_minor
      if (adset.budget_level !== 'abo' || !Number.isSafeInteger(amount) || amount === null || amount <= 0 || adset.currency !== currency) {
        return unavailable(`投放中的广告组 ${adset.entity_id} 预算或币种无法确认`)
      }
      total += amount
    }
    if (!Number.isSafeInteger(total)) return unavailable(`广告账户 ${accountId} 预算合计溢出`)
    const cap = perAccountCaps[accountIds.indexOf(accountId)] as number
    if (total > cap) return unavailable(`广告账户 ${accountId} 当前预算已超过账户级上限`)
    accountTotals.set(accountId, total)
  }

  if (currencies.size !== 1) return unavailable('客户广告账户币种不一致，不能把不同币种的预算相加')
  const totalCents = [...accountTotals.values()].reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents > clientCapCents) {
    return unavailable('客户当前跨账户日预算已超过客户总上限')
  }
  if (accountTotals.get(targetAccountId) === undefined || accountTotals.get(targetAccountId) === null) {
    return unavailable('读不到目标广告账户的预算合计')
  }
  const targetRow = latest.get(`${targetAccountId}:${targetLevel}:${targetEntityId}`)
  if (!targetRow || targetRow.capture_reason === 'disappeared' || targetRow.daily_budget_minor !== expectedTargetBeforeCents) {
    return unavailable('目标预算与本次授权读取的基线不一致')
  }

  return {
    totalCents,
    accountTotals,
    accountCaps: new Map(accountIds.map((id, index) => [id, perAccountCaps[index] as number])),
    capCents: clientCapCents,
  }
}

/** Read the same complete cross-account budget facts used by the execution envelope. */
export async function readAdBudgetHeadroom(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  adsetId: string,
  beforeCents: number,
  now: Date,
): Promise<{ accountRemainingCents: number; clientRemainingCents: number } | { unavailable: string }> {
  const { data: cfg, error } = await sb
    .from('ad_strategy_configs')
    .select('daily_budget_cap_cents')
    .eq('client_id', clientId)
    .maybeSingle<{ daily_budget_cap_cents: number | null }>()
  if (error) return { unavailable: '客户日预算总上限读不到' }
  const rollup = await loadClientBudgetRollup(
    sb, clientId, accountId, 'adset', adsetId, beforeCents,
    cfg?.daily_budget_cap_cents ?? null, now, 'authorize',
  )
  if ('unavailable' in rollup) return { unavailable: rollup.unavailable }
  const accountTotal = rollup.accountTotals.get(accountId)
  const accountCap = rollup.accountCaps.get(accountId)
  if (accountTotal === undefined || accountCap === undefined) return { unavailable: '账户预算合计或上限读不到' }
  const accountRemaining = accountCap - accountTotal
  const clientRemaining = rollup.capCents - rollup.totalCents
  if (!Number.isSafeInteger(accountRemaining) || !Number.isSafeInteger(clientRemaining)) {
    return { unavailable: '预算剩余额度算不出来' }
  }
  return { accountRemainingCents: accountRemaining, clientRemainingCents: clientRemaining }
}

function studyCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}

function afterRawIsIncrease(after: unknown, before: number | null): boolean {
  return typeof after === 'number' && Number.isFinite(after) && typeof before === 'number' && after > before
}

function latestOf(rows: readonly SnapRow[]): SnapRow | null {
  let best: SnapRow | null = null
  for (const r of rows) {
    if (!best || Date.parse(r.captured_at) > Date.parse(best.captured_at)) best = r
  }
  return best
}

/**
 * 距这个实体上一次**真实设置变化**过了多少小时。
 *
 * 🔴 判据是 `capture_reason = 'changed'` —— 那是「跟上一条快照比设置真的变了」
 *    才写的一行，所以**人工在 Ads Manager 里改的也算**（§14 K12：72 小时按真实
 *    变化算，不是只算 ME 自己的动作）。`daily` 那种例行抓取不算变化。
 *    完全没有快照 = 读不到（null）；有快照但没有一条 changed = 确实从没变过。
 *
 * 🔴 **故意不认 `kernel_post`**（魏征复审查实，本窗口核过 `snapshot.ts:363-365`）：
 *    那个原因码写的时候是「该客户**所有**实体一律写一行」，不管这个实体的设置有没有变。
 *    所以它代表不了「这个实体变了」；一旦有人接上它，任何一次动作之后整个客户
 *    每个实体都会显示「刚改过」→ 自治被整体冻死 72 小时。
 *    「我们自己刚改过」改由 `hoursSinceOwnLastAction` 查内核执行记录来回答，那是按实体精确的。
 *    （`diagnostics/loader.ts:89` 认它，是同一颗地雷，已另开卡，本轮不动那边。）
 */
function hoursSinceLastRealChange(rows: readonly SnapRow[], now: Date): number | null {
  if (rows.length === 0) return null
  const changed = rows.filter(r => r.capture_reason === 'changed')
  if (changed.length === 0) return Number.MAX_SAFE_INTEGER
  const ms = now.getTime() - Date.parse(latestOf(changed)!.captured_at)
  return Number.isFinite(ms) ? ms / 3_600_000 : null
}

/**
 * 内核自己上次成功改过这个实体是多久以前（小时）。读不到任何记录返回 null。
 *
 * 🔴 **为什么不靠快照**：内核执行完一个动作后，没有任何地方会立刻补写一条
 *    `changed` 快照 —— 那要等下一次定期对账。所以同一个实体连续两次自治动作
 *    之间，快照里可能一条「刚改过」的痕迹都没有，冷却期闸读到的还是旧数字。
 *    内核自己的执行记录（`action_runs`）是唯一当场就知道「我们刚动过它」的来源。
 *
 * 🔴 **为什么撤回也算**：`rolled_back` 意味着我们确实改过设置、又改回去了 ——
 *    设置被碰过就是被碰过，学习期照样重置，不能因为最后撤回了就当没发生。
 *
 * 🔴 **为什么读失败必须报错而不是当成没动过**：把查询失败当成「从没动过」，
 *    等于一次数据库抖动就静默放行一次本该被冷却期挡下的动作 —— fail-open。
 *    调用方拿到 `ok: false` 必须拒绝，不能拿 `hours: null` 凑合。
 */
/**
 * 哪些最终状态代表「这次动作可能已经碰过 Meta 的设置」。
 *
 * 🔴 **故意宁多勿少（fail-closed）**：
 *   · `succeeded` —— 显然碰过
 *   · `dead_letter` —— 撤回之后的终态就是这个（`gateway.ts` failRun 的注释：
 *     「rollback 结果不改 run 的最终状态，永远还是 dead_letter」）。撤回意味着
 *     设置被改过又改回去，学习期照样被重置，不能当没发生
 *   · `failed` —— provider 写成功、但验证或后续步骤失败的 run 落在这里，设置已经被改过
 * 不含 `denied` / `superseded` / `queued` / `authorizing` / `authorized` /
 * `pending_approval` / `running`：这些都还没走到 apply 那一步。
 *
 * ⚠️ 代价：在 apply 之前就失败的 run 也会被算成「动过」，于是冷却期偏严、
 *    可能多拦 72 小时。偏严比偏松安全，所以先这样；要精确就得逐个查
 *    `action_run_steps` 里有没有 provider 写入回执，另开卡做。
 *
 * ❌ 不要写 `rolled_back`：`action_runs.status` 没有这个取值（见 `kernel/types.ts`
 *    的 `RunStatus` 与建表 CHECK），写了等于筛零行 —— 第一版就踩了这个坑。
 */
const TOUCHED_PROVIDER_STATUSES = ['succeeded', 'failed', 'dead_letter'] as const

/**
 * `action_runs.input` 里可能装广告实体编号的字段。八个 `ads.*` 动作的全集。
 *
 * 🔴 少一个就等于那类动作的冷却期失效：`ads.swap_creative` 的 input 只有 `ad_id`
 *    （`registry-ads.ts` 的 inputSchema），第一版只筛 adset/campaign，它永远不命中。
 */
const ENTITY_INPUT_FIELDS = ['adset_id', 'campaign_id', 'ad_id', 'audience_id'] as const

export async function hoursSinceOwnLastAction(
  sb: SupabaseClient,
  args: {
    readonly clientId: string
    /** 要查的实体编号：判据实体 + 这次 input 里原始的那些（换素材要靠原始 ad_id 才命中）。 */
    readonly entityIds: readonly string[]
    readonly now: Date
  },
): Promise<{ ok: true; hours: number | null } | { ok: false; error: string }> {
  // 🔴 **按实体在服务端精确筛，不许「拉最近 N 条再在内存里找」**：那样一旦这个客户
  //    的动作条数超过 N，目标实体最后一次动作就掉出窗口 → 返回 null（= 从没动过）
  //    → 冷却期闸静默失效。这正是同文件上面那段注释记下的 4000 行截断事故
  //    （#1994 缺陷 2）的同一种坑，不能再踩一遍。
  const ids = [...new Set(args.entityIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return { ok: false, error: '没有可查的实体编号，判不了我们自己上次动它是什么时候' }
  // 形状不认识就拒，不拼进查询：这些 id 会被拼进 PostgREST 的 or 表达式。
  // 白名单里没有逗号、点、括号、引号，所以拼不出第二个 or 子句或别的运算符（子牙复审核过）。
  // 这里**故意不用**本文件别处那个更严的纯数字判据：实体编号不全来自 input
  // （换素材那条是从快照里反查出来的所属广告组），收太严会变成误拒。
  const bad = ids.find((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))
  if (bad !== undefined) {
    return { ok: false, error: `实体编号形状不认识，不敢拿去查内核执行记录：${bad}` }
  }
  const orExpr = ids
    .flatMap((id) => ENTITY_INPUT_FIELDS.map((field) => `input->>${field}.eq.${id}`))
    .join(',')
  const { data, error } = await sb
    .from('action_runs')
    .select('finished_at')
    .eq('client_id', args.clientId)
    .like('action_key', 'ads.%')
    .in('status', [...TOUCHED_PROVIDER_STATUSES])
    .not('finished_at', 'is', null)
    .or(orExpr)
    .order('finished_at', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: '读内核执行记录失败：' + error.message }

  const rows = (data ?? []) as Array<{ finished_at: string | null }>
  const finishedAt = rows[0]?.finished_at ?? null
  if (!finishedAt) return { ok: true, hours: null }
  const ms = args.now.getTime() - Date.parse(finishedAt)
  // 🔴 有这一行、但时间读不懂 → 拒，不许跟「没有行」走同一个出口（魏征复审）：
  //    返回 hours: null 会被调用方当成「我们没动过」→ 放行，那是 fail-open。
  if (!Number.isFinite(ms)) {
    return { ok: false, error: `内核执行记录里的完成时间读不懂：${finishedAt}` }
  }
  return { ok: true, hours: ms / 3_600_000 }
}

/** 这次动作的「跟钱和学习期相关的那个实体」解析结果。 */
interface Subject {
  /** 要读事实的实体 id。 */
  entityId: string
  /** 它在快照表里的层级。 */
  level: 'adset' | 'campaign'
  /** 学习期判据适不适用（新建的东西还不存在，不适用）。 */
  learningApplicable: boolean
}

export interface AdsEnvelopeFactsDeps {
  sb: SupabaseClient
  /** 用来回答「这个动作有没有注册撤回处理函数」。 */
  capabilities: Readonly<Record<string, CapabilityImplementation>>
  now?: () => Date
}

export function createAdsEnvelopeFactsResolver(deps: AdsEnvelopeFactsDeps): EnvelopeFactsResolver {
  const now = deps.now ?? (() => new Date())

  return async ({ clientId, actionKey, input, at }) => {
    /**
     * 🔴 **所有 unavailable 的理由都带机器可读前缀**（v2.2 §6.1）：
     *    · `facts:`       读不到事实（含熔断查询自身失败）
     *    · `circuit:`     确实处于熔断中
     *    · `manual_only:` 这一类只走人工
     *
     *    下游（`pm-todo` / handoff 待办）按前缀分三种话说，不把三种混成一句「读不到」。
     *    🔴 **「真熔断了」和「查熔断这件事自己炸了」必须分得开** —— 否则哪天那条 SQL 挂了，
     *    广告自治整个哑掉，而 PM 看到的只有一堆「熔断中」，没人知道根因。
     */
    const unavailable = (why: string) => ({ unavailable: why } as const)
    const cantRead = (why: string) => unavailable(`facts:${why}`)

    const kind = CHANGE_KIND[actionKey]
    if (!kind) return cantRead(`「${actionKey}」不是已知的广告自治动作，判不了信封`)

    const adAccountId = typeof input.ad_account_id === 'string' ? input.ad_account_id : null
    if (!adAccountId) return cantRead('input 里没有 ad_account_id，读不到这个账户的预算')

    /**
     * 🔴 **熔断检查 —— 这是熔断真正生效的那一刀**（v2.2 §6.1）。
     *
     * ⚠️ **但今天这一刀永远放行，因为没有人写 trip 行**（2026-10-18 查实，别误以为这道防线在工作）：
     *    写 trip 的是韩信 step 1（设计稿 `2026-09-25-ads-impact-wp3-design-v1.md` §2.2 第 1 行
     *    「#1/#2/#4 的 trip 在这里写」），韩信属 **WP3.2，尚未开工**（ROADMAP「WP3.2 链条」那条）。
     *    现状：`circuit-detectors.ts` 五条判据零调用方、生产库 `ads_circuit_events` **0 行**、
     *    因此下面的 `readCircuitState` 恒返回 `tripped: false`，`pm-todo/ads-circuit-items.ts` 恒为空。
     *    **这不是这段代码的 bug**（读侧按 WP3.1b 的范围已交付且正确），是写侧还在 WP3.2。
     *    WP3.2 落地后这段不需要改，自然开始真拦。工作量估算见
     *    `docs/specs/2026-10-18-ads-agent-whole-design-and-code-gaps-v0.1.md` §6.5。
     *
     *    熔断不写 `ad_strategy_configs`、不改任何状态列；它就是在这里让信封事实
     *    「读不到」，于是 Kernel 两层各拒一次：
     *      · authorize 层   → `deny(outside_autonomy_envelope)`，可恢复
     *      · pre_provider 层 → `dead_letter + needs_human`，进 handoff 待办
     *
     *    所以「看板一键」「denied 恢复」「未来任何提交方」凡进 Kernel 都被罩住 ——
     *    **不需要每个调用方自己记得查熔断**，那种写法就是在 Kernel 之外造第二条授权路径。
     *
     *    🔴 两种 unavailable 用**不同前缀**，因为该做的处置完全不同：
     *      · `circuit:` 真熔断了 → PM 看「为什么熔断、要不要解除」
     *      · `facts:`   查熔断这件事自己炸了 → 是我们的 bug，要人去修那条 SQL
     */
    const circuit = await readCircuitState(deps.sb, clientId, adAccountId, now())
    if (circuit.queryError !== null) {
      return cantRead(`熔断状态查不出来（按熔断中处理）：${circuit.queryError}`)
    }
    if (circuit.tripped) {
      const howToClear = circuit.sticky
        ? '这一条必须人工解除（在 admin 解除接口），时间过期对它无效'
        : '非人工熔断 24 小时后自动失效'
      return unavailable(
        `${circuit.reason ?? 'circuit:unknown'}｜这个广告账户当前处于熔断中` +
          `（未解除 ${circuit.openTripCount} 条）。${howToClear}`,
      )
    }

    const str = (k: string): string | null =>
      typeof input[k] === 'string' && input[k] ? (input[k] as string) : null

    // 这个账户全部快照一次读出来：目标实体的事实、它的父子关系、账户合计都要用。
    // 共用账户按 §14 M9 本来就不抓广告组级 → 读到空 → 走到「读不到 → 拒绝」，符合预期。
    //
    // 🔴 **`at` 决定读哪一份快照**（WP2 遗留缺陷 #1994 缺陷 1，本轮修）：
    //    这个解析器被调两次，两次的事实来源**必须不同**，否则 pre_provider 那一层
    //    等于白跑：
    //      · `at === 'authorize'`     → 用**当下最新**快照（授权时判「这一次改动该不该放」）
    //      · `at === 'pre_provider'`  → 用 `capture_reason = 'kernel_pre'` 的那一份，
    //        即 capability 的 snapshot_pre 步在**碰 provider 之前**刚抓的那一份
    //
    //    为什么必须分开：gateway 在每次调 handler 前重算一遍信封（含重试、含
    //    `reuseLiveAuthorization` 复用的旧 allow）。如果两层读的是同一份最新快照，
    //    那「人批过之后、真动手之前，别人又改了预算」这种情况就检测不到 ——
    //    纵深防御退化成同一道闸判两遍。
    //
    //    改之前这里**根本没解构 `at`**，所以上面这段话在代码里一直没兑现（#1994）。
    let snapQuery = deps.sb
      .from('ad_entity_snapshots')
      .select(SNAP_COLUMNS)
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .in('level', ['adset', 'campaign', 'ad'])
    if (at === 'pre_provider') {
      snapQuery = snapQuery.eq('capture_reason', 'kernel_pre')
    }
    const { data, error } = await snapQuery
      .order('captured_at', { ascending: false })
      .limit(4000)
    if (error) return cantRead(`读广告设置快照失败：${error.message}`)
    const rows = (data ?? []) as SnapRow[]
    if (at === 'pre_provider' && rows.length === 0) {
      // 🔴 fail closed：pre_provider 这一层就是为了「碰 provider 之前再确认一次」，
      //    抓不到 kernel_pre 快照时**不许退回用最新快照凑合** —— 那等于这一层没跑。
      return cantRead('碰 Meta 之前那份 kernel_pre 快照读不到，不拿最新快照凑合')
    }

    // ── 解析这次动作真正该看的实体 ──────────────────────────────────────────
    let subject: Subject
    let learningTargetOverride: SnapRow | null = null
    switch (actionKey) {
      case 'ads.pause_unit':
      case 'ads.cut_unit_budget': {
        const id = str('adset_id')
        if (!id) return cantRead('input 里没有 adset_id')
        subject = { entityId: id, level: 'adset', learningApplicable: true }
        break
      }
      case 'ads.scale_unit_budget': {
        const id = str('adset_id')
        if (!id) return cantRead('input 里没有 O1 来源广告组 adset_id')
        const campaignId = str('campaign_id')
        if (campaignId) {
          if (!/^\d{1,32}$/.test(campaignId)) return cantRead('input 里的 campaign_id 格式无效')
          const sourceAdset = latestOf(rows.filter(r => r.level === 'adset' && r.entity_id === id))
          if (!sourceAdset || sourceAdset.campaign_id !== campaignId) {
            return unavailable('facts:O1 来源广告组不属于本次调整的广告系列')
          }
          learningTargetOverride = sourceAdset
          const campaign = latestOf(rows.filter(r => r.level === 'campaign' && r.entity_id === campaignId))
          if (!campaign || campaign.budget_level !== 'cbo') {
            return unavailable('facts:目标广告系列不是系列级 CBO 预算')
          }
          const latestChildren = new Map<string, SnapRow>()
          for (const child of rows.filter(r => r.level === 'adset' && r.campaign_id === campaignId)) {
            const prior = latestChildren.get(child.entity_id)
            if (!prior || Date.parse(child.captured_at) > Date.parse(prior.captured_at)) latestChildren.set(child.entity_id, child)
          }
          const deliveringChildren = [...latestChildren.values()].filter(child => DELIVERING.has(child.effective_status ?? ''))
          if (deliveringChildren.length !== 1 || deliveringChildren[0]?.entity_id !== id) {
            return unavailable('facts:O1 广告组不是该系列唯一在投广告组，不能按单组信号提高系列预算')
          }
          subject = { entityId: campaignId, level: 'campaign', learningApplicable: true }
        } else {
          subject = { entityId: id, level: 'adset', learningApplicable: true }
        }
        break
      }
      case 'ads.cut_campaign_budget': {
        const id = str('campaign_id')
        if (!id || !/^\d{1,32}$/.test(id)) return cantRead('input 里没有有效的 campaign_id')
        subject = { entityId: id, level: 'campaign', learningApplicable: true }
        break
      }
      case 'ads.pause_campaign': {
        const id = str('campaign_id')
        if (!id || !/^\d{1,32}$/.test(id)) return cantRead('input 里没有有效的 campaign_id')
        subject = { entityId: id, level: 'campaign', learningApplicable: false }
        break
      }
      case 'ads.swap_creative': {
        const adId = str('ad_id')
        if (!adId) return cantRead('input 里没有 ad_id')
        // 换素材会重置**所属广告组**的学习期，所以判据落在那个组上，不是这条广告上。
        const adRow = latestOf(rows.filter(r => r.level === 'ad' && r.entity_id === adId))
        if (!adRow) return cantRead(`快照里查不到广告 ${adId}，读不到它属于哪个广告组`)
        if (!adRow.adset_id) return cantRead(`广告 ${adId} 的快照里没有所属广告组，判不了学习期`)
        subject = { entityId: adRow.adset_id, level: 'adset', learningApplicable: true }
        break
      }
      case 'ads.add_retargeting_adset': {
        const campaignId = str('campaign_id')
        if (!campaignId) return cantRead('input 里没有 campaign_id')
        // 🔴 要新建的广告组还不存在 → 没有任何东西在学习 → 学习期判据不适用。
        //    这跟「读不到学习期」必须分开，否则这个动作永远过不了闸。
        //    实验归属看它要挂进去的那个广告系列（系列在实验里就别往里加东西）。
        subject = { entityId: campaignId, level: 'campaign', learningApplicable: false }
        break
      }
      case 'ads.budget_move_plan':
        return unavailable('manual_only:挪预算是计划级动作（先减后加、总额不变），单实体信封判据不适用，这一类走人工放行')
      default:
        return cantRead(`「${actionKey}」没有实体解析规则`)
    }

    const subjectRows = rows.filter(r => r.level === subject.level && r.entity_id === subject.entityId)
    const target = latestOf(subjectRows)
    if (!target) return cantRead(`快照里查不到 ${subject.level} ${subject.entityId}`)
    const learningTarget = learningTargetOverride ?? target
    if (actionKey === 'ads.cut_campaign_budget') {
      if (target.budget_level !== 'cbo') return unavailable('facts:目标不是系列级 CBO 预算，不执行系列预算调整')
      if (typeof target.currency !== 'string' || !target.currency.trim()) {
        return unavailable('facts:系列预算币种未知，不能与账户上限比较')
      }
    }
    if (actionKey === 'ads.scale_unit_budget' && str('campaign_id') && target.budget_level !== 'cbo') {
      return unavailable('facts:目标不是系列级 CBO 预算，不能按系列上调')
    }

    // ── 账户当日预算合计 ────────────────────────────────────────────────────
    // 🔴 Meta 有两种预算位，只加广告组级会**系统性少算**，让日上限这道闸偏松：
    //      · CBO（`budget_level='cbo'`）—— 预算在**广告系列**上，旗下广告组自己没有数字
    //      · ABO —— 预算在**每个广告组**上，系列没有
    //    所以：CBO 系列取系列的预算，ABO 系列取旗下广告组预算之和。
    //    这跟 `diagnostics/context.ts` 的 `buildUnits` 是同一套口径 ——
    //    两边算出不同的「账户花多少」会让诊断和信封各说一套。
    const latest = (level: string): Map<string, SnapRow> => {
      const m = new Map<string, SnapRow>()
      for (const r of rows) {
        if (r.level !== level) continue
        const cur = m.get(r.entity_id)
        if (!cur || Date.parse(r.captured_at) > Date.parse(cur.captured_at)) m.set(r.entity_id, r)
      }
      return m
    }
    const latestCampaigns = latest('campaign')
    const latestAdsets = latest('adset')

    let accountTotal: number | null = null
    if (latestAdsets.size > 0 || latestCampaigns.size > 0) {
      accountTotal = 0
      const cboCampaignIds = new Set<string>()
      for (const c of latestCampaigns.values()) {
        if (c.budget_level !== 'cbo') continue
        cboCampaignIds.add(c.entity_id)
        if (!DELIVERING.has(c.effective_status ?? '')) continue
        if (actionKey === 'ads.cut_campaign_budget' &&
            (typeof c.daily_budget_minor !== 'number' || !Number.isSafeInteger(c.daily_budget_minor) || c.daily_budget_minor <= 0)) {
          return unavailable(`facts:在投 CBO 系列 ${c.entity_id} 的预算缺失或无效，无法安全核算账户日预算`)
        }
        if (typeof c.daily_budget_minor === 'number') accountTotal += c.daily_budget_minor
      }
      for (const a of latestAdsets.values()) {
        // CBO 旗下的广告组不再单独计入 —— 钱在系列那一层，重复加就翻倍。
        if (a.campaign_id && cboCampaignIds.has(a.campaign_id)) continue
        if (!DELIVERING.has(a.effective_status ?? '')) continue
        if (actionKey === 'ads.cut_campaign_budget' &&
            (typeof a.daily_budget_minor !== 'number' || !Number.isSafeInteger(a.daily_budget_minor) || a.daily_budget_minor <= 0)) {
          return unavailable(`facts:在投广告组 ${a.entity_id} 的预算缺失或无效，无法安全核算账户日预算`)
        }
        if (typeof a.daily_budget_minor === 'number') accountTotal += a.daily_budget_minor
      }
    }

    const { data: cfg, error: cfgErr } = await deps.sb
      .from('ad_strategy_configs')
      .select('daily_budget_cap_cents')
      .eq('client_id', clientId)
      .maybeSingle<{ daily_budget_cap_cents: number | null }>()
    if (cfgErr) return cantRead(`读客户广告配置失败：${cfgErr.message}`)

    /**
     * 🔴 **日上限改成按账户取**（v2.1 §3.9 / §11.11，本轮交付）。
     *
     * 上面 `cfg.daily_budget_cap_cents` 是**客户级**的总闸（配置时校验
     * `sum(账户上限) ≤ 客户总闸`，见 PATCH 路由）；单账户动作要比的是
     * **这个账户自己**的日上限，不是客户总闸——CTS 两个账户各花各的，
     * 拿总闸去比单账户等于把另一账户的额度也算给了它，会晚很久才拦下超支。
     *
     * 判据（migration `20260927000003` 的表注释原文）：
     *   · 这个账户有自己的上限 → 用它
     *   · 没有，但客户绑了 **≥2 个**账户 → `unavailable('facts:账户级日上限未配置')`——
     *     多账户下不配就动，等于没有账户级保护，必须拒
     *   · 没有，且客户就这一个账户（或用老的 `clients.meta_ad_account_id` 单账户
     *     字段，压根没在 `client_meta_ad_accounts` 建过行）→ 回落客户级总闸——
     *     单账户时总闸跟账户上限本来就是同一个数，不强制每个老客户都去面板重填一遍
     */
    const { data: accountRows, error: accountRowsErr } = await deps.sb
      .from('client_meta_ad_accounts')
      .select('ad_account_id, daily_budget_cap_cents')
      .eq('client_id', clientId)
    if (accountRowsErr) return cantRead(`读账户级日上限配置失败：${accountRowsErr.message}`)

    const registeredAccounts = (accountRows ?? []) as Array<{
      ad_account_id: string
      daily_budget_cap_cents: number | null
    }>
    const thisAccountCap = registeredAccounts.find((r) => r.ad_account_id === adAccountId)?.daily_budget_cap_cents

    let dailyCapCents: number | null
    if (typeof thisAccountCap === 'number') {
      dailyCapCents = thisAccountCap
    } else if (registeredAccounts.length >= 2) {
      return unavailable('facts:账户级日上限未配置')
    } else {
      dailyCapCents = typeof cfg?.daily_budget_cap_cents === 'number' ? cfg.daily_budget_cap_cents : null
    }

    // 🔴 **冷却期单独查，不受上面那个 4000 行账户窗口限制**（#1994 缺陷 2，本轮修）。
    //
    //    原来 `hoursSinceLastChange` 是从 `subjectRows`（账户窗口里筛出来的）算的。
    //    大账户下这个窗口会截断：目标实体那条 `capture_reason='changed'` 的快照
    //    掉到窗口外 → `hoursSinceLastRealChange` 看到「有快照但没有一条 changed」
    //    → 返回 `Number.MAX_SAFE_INTEGER`（= 从没变过）→ **72 小时冷却闸直接失效**。
    //
    //    这是 fail-**open**：窗口越窄、账户越大，闸越松，而且完全静默。
    //    改成只查这一个实体的快照、按时间倒序取够用的条数 —— 结果集天然小，
    //    不跟整个账户的行数挂钩。
    const { data: cooldownRows, error: cooldownErr } = await deps.sb
      .from('ad_entity_snapshots')
      .select(SNAP_COLUMNS)
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .eq('level', subject.level)
      .eq('entity_id', subject.entityId)
      .order('captured_at', { ascending: false })
      .limit(200)
    if (cooldownErr) return cantRead(`读这个单位的变动历史失败：${cooldownErr.message}`)
    const snapshotCooldownHours = hoursSinceLastRealChange((cooldownRows ?? []) as SnapRow[], now())

    // 🔴 **两个来源各看见一半，取更近的那个**：
    //    · 快照（`changed` / `kernel_post`）看见「设置真的变了」，包括人在 Ads Manager 里改的
    //    · 内核执行记录（`action_runs`）看见「我们自己刚动过」，哪怕还没轮到下一次对账
    //    只用一个都会漏：只靠快照会漏掉内核刚改完、还没对账的那一段；只靠执行记录
    //    会漏掉人工在 Ads Manager 里改的。取小时数更小的那个（= 更近）才不会漏。
    //    两个都是 null 时保持 null（下游语义不变）；只有一个有数就用那个。
    // 要查的实体编号：判据实体 + 这次 input 里原始的那几个。换素材的 input 只有
    // `ad_id`，而判据实体是它所属的广告组 —— 只拿判据实体去查，那类动作永远不命中。
    const ownEntityIds = [
      subject.entityId,
      ...ENTITY_INPUT_FIELDS.map((field) => str(field)).filter((v): v is string => typeof v === 'string' && v.length > 0),
    ]
    const ownAction = await hoursSinceOwnLastAction(deps.sb, {
      clientId,
      entityIds: ownEntityIds,
      now: now(),
    })
    if (!ownAction.ok) return cantRead(ownAction.error)
    // 🔴 **快照是 null 时保持 null**（子牙复审）：null 的意思是「这个实体一条快照都没有」，
    //    下游（`autonomy-envelope.ts`）据此直接拒。让一条很旧的执行记录把 null 变成数字
    //    等于把「读不到」改写成「很久没动过」——方向是从偏严变偏松，不许。
    //    执行记录只用来覆盖 `MAX_SAFE_INTEGER`（= 有快照但没有一条真改动）这一种。
    const cooldownHours = snapshotCooldownHours === null
      ? null
      : ownAction.hours === null
        ? snapshotCooldownHours
        : Math.min(snapshotCooldownHours, ownAction.hours)

    // 新建的单位改动前没有预算（0）；其余类型必须真读到，读不到就是 null → 拒绝。
    const beforeCents = kind === 'new_spend'
      ? 0
      : typeof target.daily_budget_minor === 'number' ? target.daily_budget_minor : null

    // O1 carries the exact budget that was shown for human approval. Pin it to
    // both the authorization snapshot and the pre-provider snapshot so a later
    // change cannot reuse an old approved `after_cents` against a new baseline.
    if (actionKey === 'ads.scale_unit_budget') {
      const approvedBefore = input.before_cents
      if (!Number.isSafeInteger(approvedBefore) || approvedBefore !== beforeCents) {
        return unavailable('获批时的预算已变化；请重新提交并重新审批')
      }
    }

    const afterRaw = input.after_cents
    const afterCents =
      kind === 'pause' ? 0
      : kind === 'creative_only' ? (beforeCents ?? 0)          // 不碰钱，等于没变
      : typeof afterRaw === 'number' ? afterRaw
      : Number.NaN                                              // 该带却没带 → 纯函数判成无效金额

    // 只有加预算需要跨客户的硬上限判定。逐账户现有判据仍由下面的单账户
    // facts 提供；如果客户任一账户或完整抓取证据读不全，增加动作一律拒绝。
    let clientDailyTotalBeforeCents: number | null = null
    let clientDailyCapCents: number | null = null
    if (actionKey === 'ads.scale_unit_budget' && afterRawIsIncrease(afterCents, beforeCents)) {
      const rollup = await loadClientBudgetRollup(
        deps.sb,
        clientId,
        adAccountId,
        str('campaign_id') ? 'campaign' : 'adset',
        subject.entityId,
        beforeCents ?? Number.NaN,
        typeof cfg?.daily_budget_cap_cents === 'number' ? cfg.daily_budget_cap_cents : null,
        now(),
        at,
      )
      if ('unavailable' in rollup) return unavailable(rollup.unavailable)
      clientDailyTotalBeforeCents = rollup.totalCents
      clientDailyCapCents = rollup.capCents
      accountTotal = rollup.accountTotals.get(adAccountId) ?? null
    }

    if (actionKey === 'ads.cut_campaign_budget') {
      if (!Number.isSafeInteger(beforeCents) || beforeCents === null || beforeCents <= 0 ||
          !Number.isSafeInteger(afterCents) || afterCents < 0) {
        return unavailable('facts:系列预算或目标金额无效，无法安全判断减预算')
      }
      if (afterCents > beforeCents) {
        return unavailable('facts:减系列预算目标高于当前预算，禁止借减预算动作加钱')
      }
      const budgetRows = rows.filter(r =>
        ((r.level === 'campaign' && r.budget_level === 'cbo') || r.level === 'adset') &&
        typeof r.daily_budget_minor === 'number',
      )
      if (budgetRows.some(r => r.currency !== target.currency)) {
        return unavailable('facts:账户预算币种不一致，不能合计账户日预算')
      }
    }

    const request: EnvelopeRequest = { kind, afterCents }
    const facts: EnvelopeFacts = {
      beforeCents,
      accountDailyTotalBeforeCents: accountTotal,
      clientDailyTotalBeforeCents,
      dailyCapCents,
      clientDailyCapCents,
      hoursSinceLastChange: cooldownHours,
      learningPhaseApplicable: subject.learningApplicable,
      learningStage: learningTarget.learning_stage,
      adStudyCount: studyCount(learningTarget.ad_studies),
      hasRollbackHandler: typeof deps.capabilities[actionKey]?.rollback === 'function',
    }

    return { request, facts }
  }
}
