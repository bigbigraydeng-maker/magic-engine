/**
 * Ads D3 自动暂停建议（云端 Inngest 消费者）。
 *
 * `google-data-pullback-daily` 每天跑完某个客户的只读诊断
 * （`src/lib/ads-strategy/portfolio/run-daily.ts`）之后发一条
 * `ads.diagnostics.completed_for_client` 事件（每客户一条，不拆两条）。
 * 本函数收到事件后：
 *
 *   1. 回库读这个客户的自动化开关（`ad_strategy_configs.autopilot_enabled` /
 *      `autopilot_dry_run`）——事件本身**不带**这两个值，故意的：客户随时
 *      能在设置页改开关，事件里带的是发事件那一刻的快照，consumer 执行时
 *      重新查一遍才是权威的当下状态。
 *   2. 回库读诊断结果（`ad_health_narratives.payload.portfolio_diagnoses`），
 *      挑出 D3（花钱没结果）命中——事件 payload**不带**诊断明细、不带客户名、
 *      不带具体数字，只有 `client_id / insight_date / diagnostic_run_id`
 *      （子牙复审：防止客户事实混进事件契约本身）。
 *   3. 每一条 D3 命中：共用账户再查一次（诊断层已经在共用账户上跳过 D3，
 *      这里是第二道防线）→ 回库核实这个广告组名下广告全挂客户登记的主页
 *      （诊断层已按主页切过，这里是第二道防线；客户没登记主页 / 读失败一律拦）
 *      → 算幂等键 → dry-run 就只记账，否则提交 Kernel
 *      → 等人批准（本函数只提交，不执行；执行发生在 PM/FDE 点「批准」时，
 *      见 `src/lib/action-submission/ads-auto-pause.ts`）。
 *
 * 🔴 **不做**（这一版明确排除，见任务范围）：D9 / Audience Network 排除、
 *    "放"类自动起草广告（D3 诊断跟 `prescription.ts` 的 fatigue 判定不是
 *    同一套系统，没有接线）、邮件收件人变更、阈值客户级覆写。
 *
 * 🔴 `retries: 0`——Inngest 的自动重试对这个函数没有意义：每一步真正的幂等
 *    防线是 Kernel 自己的 `(client_id, idempotency_key)` 唯一约束（同一广告组
 *    同一诊断日重复提交只会拿回同一个 run，不会二次执行）+ flywheel_actions
 *    的幂等键去重（防止 dry-run 记录重复写）。整条函数重放是安全的，
 *    但没有必要靠 Inngest 的自动重试机制去兜底——瞬时失败下一次诊断日报
 *    自然会再给一次机会。
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import {
  loadAdStrategyConfigWithSource,
  type AdStrategyConfig,
  type LoadedAdStrategyConfig,
} from '@/lib/ads-strategy/config'
import { findSharedAdAccounts } from '@/lib/meta/client-ad-accounts'
import type { Diagnosis, DiagnosisRun } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import { submitAdsAutoPauseCandidate } from '@/lib/action-submission/ads-auto-pause'
import { buildD3GrowthCandidate } from '@/lib/ads-strategy/portfolio/d3-growth-candidate'
import { validateGrowthActionCandidate } from '@/lib/growth'
import { ownershipOfAds, type AdsetOwnership } from '@/lib/ads-strategy/portfolio/diagnostics/ownership'
import { OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS } from '@/lib/ads-strategy/portfolio/diagnostics/thresholds'

/** 云端专属事件——本机 worker 不监听（见 client.ts 的 WORKER_OWNED_EVENTS）。 */
export const ADS_DIAGNOSTICS_COMPLETED_EVENT = 'ads.diagnostics.completed_for_client'

export const AdsDiagnosticsCompletedSchema = z.object({
  client_id: z.string().min(1),
  insight_date: z.string().min(1),
  diagnostic_run_id: z.string().min(1),
})
export type AdsDiagnosticsCompletedData = z.infer<typeof AdsDiagnosticsCompletedSchema>

export const ADS_AUTO_PAUSE_ACTION_TYPE = 'ads.auto_pause_on_d3'
export const ADS_AUTO_PAUSE_FLYWHEEL = 'ads'

/** sha256(client_id:diagnosis_code:campaign_or_adset_id:insight_date)，取前 32 位十六进制。 */
export function computeD3AutoPauseIdempotencyKey(args: {
  clientId: string
  diagnosisCode: string
  entityId: string
  insightDate: string
}): string {
  return createHash('sha256')
    .update(`${args.clientId}:${args.diagnosisCode}:${args.entityId}:${args.insightDate}`)
    .digest('hex')
    .slice(0, 32)
}

export interface D3AutoPauseDeps {
  supabase: SupabaseClient
  /** 带来源：读失败（source='fallback'）时拿到的是默认值，不是真开关——调用方必须按读失败处理。 */
  loadConfig: (clientId: string) => Promise<LoadedAdStrategyConfig>
  loadDiagnosisRun: (clientId: string, insightDate: string) => Promise<DiagnosisRun | null>
  isSharedAccount: (clientId: string, adAccountId: string) => Promise<boolean>
  /** 这个广告组是不是这个客户的（名下广告全挂客户登记的主页）。读失败 / 判不了必须返回非 own。 */
  verifyAdsetOwnership: (clientId: string, adAccountId: string, adsetId: string) => Promise<AdsetOwnershipCheck>
  submitCandidate: typeof submitAdsAutoPauseCandidate
}

export type AdsetOwnershipCheck =
  | { readonly owned: true; readonly adsChecked: number; readonly clientPageId: string }
  | {
    readonly owned: false
    /** read_failed / capture_stale = 系统没法核实（记 failed）；其余 = 核实过不是 / 客户没登记主页（记 blocked） */
    readonly verdict: Exclude<AdsetOwnership, 'own'> | 'client_page_unknown' | 'read_failed' | 'capture_stale'
    readonly detail: string
  }

async function loadDiagnosisRun(
  supabase: SupabaseClient,
  clientId: string,
  insightDate: string,
): Promise<DiagnosisRun | null> {
  const { data, error } = await supabase
    .from('ad_health_narratives')
    .select('payload')
    .eq('client_id', clientId)
    .eq('insight_date', insightDate)
    .maybeSingle()
  if (error || !data) return null
  const payload = data.payload as { portfolio_diagnoses?: DiagnosisRun } | null
  return payload?.portfolio_diagnoses ?? null
}

async function isSharedAccount(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<boolean> {
  const { shared, error } = await findSharedAdAccounts(clientId, [adAccountId])
  // 查不出来 fail closed：宁可这条命中这次不出手，也不能对共用账户误判成独占。
  if (error) return true
  return shared.has(adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId)
}

/** 近多少天的广告快照算「这个广告组名下的广告」——跟诊断 loader 读快照的窗口一致。 */
const OWNERSHIP_LOOKBACK_DAYS = 35
/** 分页读广告快照：每页 1000 行，最多 10 页；读满 10 页视为可能截断，判不了（fail closed）。 */
const OWNERSHIP_PAGE_SIZE = 1000
const OWNERSHIP_MAX_PAGES = 10
// 「广告层快照最近一轮必须抓全、且不早于多少小时前」用 OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS（跟诊断层
// scopeAccountToClient 同一把尺子，两处各写一份必然分家——见 context.ts DELIVERING_STATUSES 的教训）。

type AdPageRow = { entity_id: string; creative_page_id: string | null; capture_reason: string }

/** 这个广告组近 35 天的广告快照（按页读完；读满上限 = 可能截断 → 报错，调用方按判不了处理）。 */
async function readAdsetAdRows(
  supabase: SupabaseClient, clientId: string, adAccountId: string, adsetId: string, now: Date,
): Promise<{ rows: AdPageRow[] } | { error: string }> {
  const since = new Date(now.getTime() - OWNERSHIP_LOOKBACK_DAYS * 86_400_000).toISOString()
  const rows: AdPageRow[] = []
  for (let page = 0; page < OWNERSHIP_MAX_PAGES; page++) {
    const from = page * OWNERSHIP_PAGE_SIZE
    const res = await supabase.from('ad_entity_snapshots')
      .select('entity_id, creative_page_id, capture_reason')
      .eq('client_id', clientId).eq('ad_account_id', adAccountId).eq('level', 'ad').eq('adset_id', adsetId)
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }).order('entity_id', { ascending: true })
      .range(from, from + OWNERSHIP_PAGE_SIZE - 1)
    if (res.error) return { error: `读广告快照失败：${res.error.message}` }
    const batch = (res.data ?? []) as AdPageRow[]
    rows.push(...batch)
    if (batch.length < OWNERSHIP_PAGE_SIZE) return { rows }
  }
  return { error: `广告快照超过 ${OWNERSHIP_PAGE_SIZE * OWNERSHIP_MAX_PAGES} 行，可能没读全` }
}

/**
 * 回库核实：这个广告组是不是这个客户的（名下广告在近 35 天每一行快照里挂的都是客户登记主页）。
 * 🔴 看每一行而不是每条广告最后一行：广告换过主页，前半段的花费可能是别家的（魏征 2026-09-27）。
 * 🔴 广告层快照最近一轮没抓全 / 太旧 → 判不了（快照看不到新加进组的别家广告）。
 */
export async function verifyAdsetOwnership(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
  adsetId: string,
  now: Date = new Date(),
): Promise<AdsetOwnershipCheck> {
  const client = await supabase.from('clients').select('facebook_page_id').eq('id', clientId).maybeSingle()
  if (client.error) return { owned: false, verdict: 'read_failed', detail: `读客户登记主页失败：${client.error.message}` }
  const pageId = (client.data as { facebook_page_id: string | null } | null)?.facebook_page_id ?? null
  if (!pageId) return { owned: false, verdict: 'client_page_unknown', detail: '客户没登记 Facebook 主页，确认不了这个广告组是不是这个客户的' }

  const capture = await supabase.from('ad_snapshot_captures').select('complete, captured_at')
    .eq('client_id', clientId).eq('ad_account_id', adAccountId).eq('level', 'ad')
    .order('captured_at', { ascending: false }).limit(1).maybeSingle()
  if (capture.error) return { owned: false, verdict: 'read_failed', detail: `读广告层快照抓取记录失败：${capture.error.message}` }
  const last = capture.data as { complete: boolean; captured_at: string } | null
  const ageHours = last ? (now.getTime() - Date.parse(last.captured_at)) / 3_600_000 : Infinity
  if (!last || !last.complete || !(ageHours <= OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS)) {
    return { owned: false, verdict: 'capture_stale', detail: `广告层快照最近一轮${last ? (last.complete ? `是 ${Math.round(ageHours)} 小时前` : '没抓全') : '找不到'}，看不到这个广告组里最新的广告` }
  }

  const ads = await readAdsetAdRows(supabase, clientId, adAccountId, adsetId, now)
  if ('error' in ads) return { owned: false, verdict: 'read_failed', detail: ads.error }
  const rows = ads.rows

  const seen = rows.filter(r => r.capture_reason !== 'disappeared')
  const verdict = ownershipOfAds(seen, pageId)
  if (verdict === 'own') return { owned: true, adsChecked: new Set(seen.map(r => r.entity_id)).size, clientPageId: pageId }
  const detail = verdict === 'other_page'
    ? '这个广告组名下的广告挂在别的 Facebook 主页上，不是这个客户的'
    : verdict === 'mixed_pages'
      ? '这个广告组名下混着别的 Facebook 主页的广告（或有广告换过主页）'
      : '读不到这个广告组名下广告挂在哪个 Facebook 主页'
  return { owned: false, verdict, detail }
}

export function createD3AutoPauseDeps(): D3AutoPauseDeps {
  return {
    supabase: supabaseAdmin,
    loadConfig: loadAdStrategyConfigWithSource,
    loadDiagnosisRun: (clientId, insightDate) => loadDiagnosisRun(supabaseAdmin, clientId, insightDate),
    isSharedAccount: (clientId, adAccountId) => isSharedAccount(supabaseAdmin, clientId, adAccountId),
    verifyAdsetOwnership: async (clientId, adAccountId, adsetId) => {
      try {
        return await verifyAdsetOwnership(supabaseAdmin, clientId, adAccountId, adsetId)
      } catch (err) {
        return { owned: false, verdict: 'read_failed', detail: `核实归属出错：${err instanceof Error ? err.message : String(err)}` }
      }
    },
    submitCandidate: submitAdsAutoPauseCandidate,
  }
}

export interface D3HitOutcome {
  adset_id: string
  outcome:
    | 'dry_run_logged'
    | 'awaiting_approval'
    | 'idempotent_hit'
    | 'skipped_shared_account'
    | 'skipped_not_client_owned'
    | 'skipped_already_recorded'
    | 'skipped_config_read_failed'
    | 'kernel_denied'
    | 'kernel_dead_letter'
    | 'kernel_unexpected'
}

interface FlywheelActionRow {
  id: string
}

/** 这把幂等键之前记过账吗——防同一事件重放时把 dry-run 记录再写一遍。 */
async function findExistingRecord(
  supabase: SupabaseClient,
  clientId: string,
  idempotencyKey: string,
): Promise<FlywheelActionRow | null> {
  const { data } = await supabase
    .from('flywheel_actions')
    .select('id')
    .eq('client_id', clientId)
    .eq('flywheel', ADS_AUTO_PAUSE_FLYWHEEL)
    .eq('action_type', ADS_AUTO_PAUSE_ACTION_TYPE)
    .eq('payload->>idempotency_key', idempotencyKey)
    .maybeSingle()
  return (data as FlywheelActionRow | null) ?? null
}

async function recordFlywheelAction(
  supabase: SupabaseClient,
  clientId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: ADS_AUTO_PAUSE_FLYWHEEL,
    action_type: ADS_AUTO_PAUSE_ACTION_TYPE,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
  })
  // 🔴 写失败必须让调用方知道，不能吞——吞了就等于「暂停了但没人能在待办里看到」。
  if (error) throw new Error(`[ads-d3-auto-pause] 写 flywheel_actions 失败：${error.message}`)
}

/** 归属闸拦下：核实过不是 / 没登记主页记 blocked；系统没法核实记 failed（别让人以为「查过了、是别人的」，子牙）。 */
async function recordOwnershipBlock(
  supabase: SupabaseClient,
  args: { clientId: string; insightDate: string; diagnosisRunId: string },
  unit: Diagnosis['units'][number],
  idempotencyKey: string,
  ownership: Extract<AdsetOwnershipCheck, { owned: false }>,
): Promise<void> {
  const systemCouldNotVerify = ownership.verdict === 'read_failed' || ownership.verdict === 'capture_stale'
  await recordFlywheelAction(supabase, args.clientId, {
    status: systemCouldNotVerify ? 'failed' : 'blocked',
    idempotency_key: idempotencyKey,
    diagnosis_code: 'D3',
    diagnostic_run_id: args.diagnosisRunId,
    insight_date: args.insightDate,
    ad_account_id: unit.adAccountId,
    adset_id: unit.id,
    adset_name: unit.name,
    ownership_verdict: ownership.verdict,
    reason: `确认不了这个广告组是这个客户的，不自动出手：${ownership.detail}`,
  })
}

/** 处理一条 D3 命中。纯粹按顺序过闸，任何一步拦下都记一条对应状态的账。 */
export async function processD3Hit(
  deps: D3AutoPauseDeps,
  args: { clientId: string; insightDate: string; diagnosisRunId: string; diagnosis: Diagnosis; config: AdStrategyConfig },
): Promise<D3HitOutcome> {
  const unit = args.diagnosis.units[0]
  const adsetId = unit?.id ?? ''
  const idempotencyKey = computeD3AutoPauseIdempotencyKey({
    clientId: args.clientId,
    diagnosisCode: 'D3',
    entityId: adsetId,
    insightDate: args.insightDate,
  })

  const existing = await findExistingRecord(deps.supabase, args.clientId, idempotencyKey)
  if (existing) return { adset_id: adsetId, outcome: 'skipped_already_recorded' }

  if (!unit || unit.level !== 'adset') {
    // D3 只在 adset 级命中；这条防御性分支理论上不会触发，触发了就不出手。
    return { adset_id: adsetId, outcome: 'skipped_shared_account' }
  }

  if (await deps.isSharedAccount(args.clientId, unit.adAccountId)) {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      status: 'blocked' satisfies string,
      idempotency_key: idempotencyKey,
      diagnosis_code: 'D3',
      diagnostic_run_id: args.diagnosisRunId,
      insight_date: args.insightDate,
      ad_account_id: unit.adAccountId,
      adset_id: unit.id,
      adset_name: unit.name,
      reason: '共用账户，不自动出手（第二道防线，诊断层本来就不在共用账户上跑 D3）',
    })
    return { adset_id: unit.id, outcome: 'skipped_shared_account' }
  }

  // 第二道防线：诊断层已按创意主页切掉别人的广告组；这里出手前回库再核一次，dry-run 也要过
  // （dry-run 记账写「会提交 Kernel」必须是真的会）。
  const ownership = await deps.verifyAdsetOwnership(args.clientId, unit.adAccountId, unit.id)
  if (!ownership.owned) {
    await recordOwnershipBlock(deps.supabase, args, unit, idempotencyKey, ownership)
    return { adset_id: unit.id, outcome: 'skipped_not_client_owned' }
  }

  const candidate = buildD3GrowthCandidate({
    clientId: args.clientId,
    insightDate: args.insightDate,
    diagnosis: args.diagnosis,
    unit,
  })
  const validation = validateGrowthActionCandidate(candidate)
  if (!validation.ok) {
    // 🔴 不阻断执行——这一层只是把诊断结论按 Growth 契约的形状包一遍，
    //    校验失败说明包装本身有问题，但不代表「这条广告不该停」。
    //    真正的授权判断在 Kernel（下面的 submitCandidate）。
    console.warn(`[ads-d3-auto-pause] GrowthActionCandidate 校验未过（不阻断执行）：${validation.reason}`)
  }

  const basePayload = {
    idempotency_key: idempotencyKey,
    diagnosis_code: 'D3',
    diagnostic_run_id: args.diagnosisRunId,
    insight_date: args.insightDate,
    ad_account_id: unit.adAccountId,
    adset_id: unit.id,
    adset_name: unit.name,
    diagnosis_title: args.diagnosis.title,
    diagnosis_evidence: args.diagnosis.evidence,
    growth_candidate_valid: validation.ok,
    // 批准的人要看得见：提交时核过归属、依据几条广告（子牙 2026-09-27）
    ownership: { verdict: 'own', ads_checked: ownership.adsChecked, client_page_id: ownership.clientPageId },
  }

  const fresh = await deps.loadConfig(args.clientId)
  if (fresh.source === 'fallback') {
    // 🔴 读不出开关 = 不知道客户现在允不允许出手：不提交 Kernel（fail closed），
    //    但也不能记成 dry_run_logged——那会让人以为是客户开着演练模式。
    //    记 failed 不记 blocked：跟归属闸同一口径，「系统没法核实」≠「查过了、被拦下」。
    const error = fresh.error ?? 'unknown error'
    console.error(`[ads-d3-auto-pause] ad_strategy_configs 读失败，不出手：${args.clientId}: ${error}`)
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'failed' satisfies string,
      reason: '读不出这个客户的广告自动化开关，这次不出手（等下一次诊断日报再判）',
      config_read_error: error,
    })
    return { adset_id: unit.id, outcome: 'skipped_config_read_failed' }
  }
  if (fresh.config.autopilot_dry_run) {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'dry_run_logged' satisfies string,
      reason: '如果 autopilot_dry_run 关闭，会提交 Kernel 等人批准暂停这个广告组',
    })
    return { adset_id: unit.id, outcome: 'dry_run_logged' }
  }

  const kernel = createKernel(deps.supabase)
  const result = await deps.submitCandidate(kernel, {
    clientId: args.clientId,
    adAccountId: unit.adAccountId,
    adsetId: unit.id,
    diagnosisCode: 'D3',
    insightDate: args.insightDate,
    triggeredByRef: args.diagnosisRunId,
    rationale: args.diagnosis.title,
    evidence: {
      diagnosis: args.diagnosis.evidence,
      sample: args.diagnosis.sample,
      ownership: { verdict: 'own', ads_checked: ownership.adsChecked, client_page_id: ownership.clientPageId },
    },
  })

  if (result.ok && result.outcome === 'pending_approval') {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'awaiting_approval' satisfies string,
      reason: '花钱没结果：已提交，等你批准后才会暂停这个广告组',
      action_run_id: result.runId,
      authorization_decision_id: result.authorizationDecisionId,
    })
    return { adset_id: unit.id, outcome: 'awaiting_approval' }
  }
  if (result.ok && result.outcome === 'idempotent_hit') {
    return { adset_id: unit.id, outcome: 'idempotent_hit' }
  }
  if (!result.ok && (result.reason === 'kernel_denied' || result.reason === 'kernel_inconsistent_pending_approval')) {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'blocked' satisfies string,
      action_run_id: result.runId,
      reason: 'humanReason' in result ? result.humanReason : result.reason,
    })
    return { adset_id: unit.id, outcome: 'kernel_denied' }
  }
  if (!result.ok && result.reason === 'kernel_dead_letter') {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'failed' satisfies string,
      action_run_id: result.runId,
      reason: result.humanReason,
    })
    return { adset_id: unit.id, outcome: 'kernel_dead_letter' }
  }
  // kernel_unexpected_outcome
  await recordFlywheelAction(deps.supabase, args.clientId, {
    ...basePayload,
    status: 'failed' satisfies string,
    reason: `Kernel 返回了意料之外的结果`,
  })
  return { adset_id: unit.id, outcome: 'kernel_unexpected' }
}

export function createD3AutoPauseFunction(deps: D3AutoPauseDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ads-d3-auto-pause`,
      name: 'Ads D3: auto-pause proposal on spend-no-result hits',
      concurrency: { limit: 4, key: 'event.data.client_id' },
      retries: 0,
    },
    { event: ADS_DIAGNOSTICS_COMPLETED_EVENT },
    async ({ event, step }) => {
      const parsed = AdsDiagnosticsCompletedSchema.safeParse(event.data)
      if (!parsed.success) return { ok: false, reason: 'invalid_payload' as const }
      const d = parsed.data

      const loaded = await step.run('load-config', () => deps.loadConfig(d.client_id))
      if (loaded.source === 'fallback') {
        // 读失败时 loaded.config 是默认值（autopilot_enabled=false），照读会被记成
        // 「客户没开自动化」——方向安全但原因是错的。单独报出来，别跟 autopilot_disabled 混。
        // 回执跟单条读失败同一种（failed + config_read_error），今日待办从这里捞；
        // 只写日志的话诊断完成事件只发一次，当天这个客户的 D3 就没人知道被跳过了。
        const error = loaded.error ?? 'unknown error'
        console.error(`[ads-d3-auto-pause] ad_strategy_configs 读失败，整条跳过：${d.client_id}: ${error}`)
        await step.run('record-config-read-failure', () =>
          recordFlywheelAction(deps.supabase, d.client_id, {
            status: 'failed' satisfies string,
            diagnosis_code: 'D3',
            diagnostic_run_id: d.diagnostic_run_id,
            insight_date: d.insight_date,
            reason: '读不出这个客户的广告自动化开关，今天的「花钱没结果」一条都没判（等下一次诊断日报再判）',
            config_read_error: error,
          }),
        )
        return { ok: false, reason: 'config_read_failed' as const, error, processed: 0 }
      }
      const config = loaded.config
      if (!config.autopilot_enabled) {
        return { ok: true, skipped: 'autopilot_disabled' as const, processed: 0 }
      }

      const run = await step.run('load-diagnosis-run', () => deps.loadDiagnosisRun(d.client_id, d.insight_date))
      if (!run) return { ok: true, skipped: 'diagnosis_run_not_found' as const, processed: 0 }

      const hits = run.diagnoses.filter((x) => x.code === 'D3' && x.status === 'hit')
      if (hits.length === 0) return { ok: true, processed: 0 }

      const outcomes: D3HitOutcome[] = []
      for (const hit of hits) {
        const adsetId = hit.units[0]?.id ?? 'unknown'
        const outcome = await step.run(`process-${adsetId}`, () =>
          processD3Hit(deps, {
            clientId: d.client_id,
            insightDate: d.insight_date,
            diagnosisRunId: d.diagnostic_run_id,
            diagnosis: hit,
            config,
          }),
        )
        outcomes.push(outcome)
      }
      return { ok: true, processed: outcomes.length, outcomes }
    },
  )
}

export const adsD3AutoPause = createD3AutoPauseFunction(createD3AutoPauseDeps())
