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
 *      这里是第二道防线）→ 算幂等键 → dry-run 就只记账，否则提交 Kernel
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
import { loadAdStrategyConfigWithSource, type AdStrategyConfig } from '@/lib/ads-strategy/config'
import { findSharedAdAccounts } from '@/lib/meta/client-ad-accounts'
import type { Diagnosis, DiagnosisRun } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import { submitAdsAutoPauseCandidate } from '@/lib/action-submission/ads-auto-pause'
import { buildD3GrowthCandidate } from '@/lib/ads-strategy/portfolio/d3-growth-candidate'
import { validateGrowthActionCandidate } from '@/lib/growth'

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
  loadConfig: (clientId: string) => Promise<AdStrategyConfig>
  loadDiagnosisRun: (clientId: string, insightDate: string) => Promise<DiagnosisRun | null>
  isSharedAccount: (clientId: string, adAccountId: string) => Promise<boolean>
  submitCandidate: typeof submitAdsAutoPauseCandidate
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

export function createD3AutoPauseDeps(): D3AutoPauseDeps {
  return {
    supabase: supabaseAdmin,
    loadConfig: (clientId) => loadAdStrategyConfigWithSource(clientId).then((r) => r.config),
    loadDiagnosisRun: (clientId, insightDate) => loadDiagnosisRun(supabaseAdmin, clientId, insightDate),
    isSharedAccount: (clientId, adAccountId) => isSharedAccount(supabaseAdmin, clientId, adAccountId),
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
    | 'skipped_already_recorded'
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
  }

  const freshConfig = await deps.loadConfig(args.clientId)
  if (freshConfig.autopilot_dry_run) {
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
    evidence: { diagnosis: args.diagnosis.evidence, sample: args.diagnosis.sample },
  })

  if (result.ok && result.outcome === 'pending_approval') {
    await recordFlywheelAction(deps.supabase, args.clientId, {
      ...basePayload,
      status: 'awaiting_approval' satisfies string,
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

      const config = await step.run('load-config', () => deps.loadConfig(d.client_id))
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
