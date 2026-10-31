/**
 * 环境读取器：把「转化 API 目标 / 只读探活 / 近 7 天回传 / 令牌是否解析到 / 定时任务新鲜度」
 * 读成 EnvFacts。只读，不写任何东西。
 *
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 像素编号 / 域名。
 * 🔴 灰（没读到）永不等于绿，也不等于 0：读不到就记 null / false，并留一条已清洗的错误。
 * 🔴 绝不把令牌、像素值、探活 detail 里的其它字段带进 facts。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { pixelEnvVar } from '@/lib/meta/capi/config'
import type { CronJobFact, EnvFacts } from './types'
import { retryOnce, type Sleep } from './retry'
import { sanitizeError } from './sanitize'

/** 默认要盯的定时任务：两个同步任务，各 3 小时。 */
export const REQUIRED_JOBS: readonly { job: string; max_age_hours: number }[] = [
  { job: 'meta-leads-sync', max_age_hours: 3 },
  { job: 'messenger-sync-hourly', max_age_hours: 3 },
]

export interface EnvReadDeps {
  supabase: SupabaseClient
  env: Record<string, string | undefined>
  capiPreflight(clientId: string): Promise<{ ok: boolean; detail: Record<string, unknown> }>
  resolveMetaToken(clientId: string): Promise<string | null>
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

export interface EnvReadInput {
  clientId: string
  now: Date
  requiredJobs?: readonly { job: string; max_age_hours: number }[]
}

export interface EnvReadResult {
  facts: EnvFacts
  errors: string[]
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const PIXEL_VALUE_RE = /^\d{6,20}$/

type CapiTarget = EnvFacts['capi_target']
type CapiPreflight = EnvFacts['capi_preflight']
type CapiEvents = EnvFacts['capi_events_7d']
type ConversionStage = EnvFacts['conversion_stage']

interface ClientEnvRead {
  target: CapiTarget
  conversion_stage: ConversionStage
}

const UNREAD_CLIENT: ClientEnvRead = {
  target: { status: 'unreadable', pixel_id: null },
  conversion_stage: null,
}

// ─── 1. capi_target ─────────────────────────────────────────────────────────

function conversionStageOf(value: unknown): ConversionStage {
  return value === 'live' || value === 'dry_run' ? value : null
}

async function readClientEnv(
  clientId: string,
  deps: EnvReadDeps,
  errors: string[],
): Promise<ClientEnvRead> {
  const { data, error } = await retryOnce(
    async () => {
      const r = await deps.supabase
        .from('clients')
        .select('domain, conversion_stage')
        .eq('id', clientId)
        .maybeSingle()
      return { data: r.data, error: r.error ? { message: r.error.message } : null }
    },
    { sleep: deps.sleep, retryResult: r => r.error !== null },
  )

  if (error) {
    errors.push(sanitizeError(error.message))
    return UNREAD_CLIENT
  }
  if (!data) return UNREAD_CLIENT

  const row = data as { domain: unknown; conversion_stage: unknown }
  const conversion_stage = conversionStageOf(row.conversion_stage)
  const domain = row.domain
  if (typeof domain !== 'string' || domain.trim() === '') {
    return { target: UNREAD_CLIENT.target, conversion_stage }
  }

  const raw = deps.env[pixelEnvVar(domain)]
  if (raw === undefined || raw === '') {
    return { target: { status: 'not_configured', pixel_id: null }, conversion_stage }
  }

  const trimmed = raw.trim()
  if (PIXEL_VALUE_RE.test(trimmed)) {
    return { target: { status: 'configured', pixel_id: trimmed }, conversion_stage }
  }
  // 值不是纯数字（比如把令牌填错了位置）：判为不可读，且绝不把这个值带出去。
  return { target: UNREAD_CLIENT.target, conversion_stage }
}

// ─── 2. capi_preflight ──────────────────────────────────────────────────────

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asBooleanOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * 转化 API 探活自己把网络层的失败也包成了「ok: false」的返回值（不抛错），
 * 所以光靠「抛错就重试」永远触发不了——要看返回值：令牌那一步或像素那一步「根本没拿到回应」
 * （只有 token_error / pixel_error，没有 token_valid / pixel_visible）才算瞬时故障。
 * 配置阶段的失败、令牌失效、看不到像素，都是永久性的，不重试。
 */
function isTransientPreflight(r: { ok: boolean; detail: Record<string, unknown> }): boolean {
  if (r.ok) return false
  const d = r.detail ?? {}
  if (d.stage === 'config') return false
  const tokenStepNoResponse = typeof d.token_error === 'string' && typeof d.token_valid !== 'boolean'
  const pixelStepNoResponse = typeof d.pixel_error === 'string' && typeof d.pixel_visible !== 'boolean'
  return tokenStepNoResponse || pixelStepNoResponse
}

async function readCapiPreflight(
  clientId: string,
  deps: EnvReadDeps,
  errors: string[],
): Promise<CapiPreflight> {
  try {
    const r = await retryOnce(() => deps.capiPreflight(clientId), { sleep: deps.sleep, retryResult: isTransientPreflight })
    const detail = r.detail ?? {}
    return {
      ok: r.ok,
      stage: asStringOrNull(detail.stage),
      token_valid: asBooleanOrNull(detail.token_valid),
      pixel_visible: asBooleanOrNull(detail.pixel_visible),
    }
  } catch (err) {
    errors.push(sanitizeError(err))
    return null
  }
}

// ─── 3. capi_events_7d ──────────────────────────────────────────────────────

async function readCapiEvents(
  clientId: string,
  now: Date,
  deps: EnvReadDeps,
  errors: string[],
): Promise<CapiEvents> {
  const sinceIso = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString()

  const { data, error } = await retryOnce(
    async () => {
      const r = await deps.supabase
        .from('me_conversion_writebacks')
        .select('status, me_sale_outcomes!inner(client_id)')
        .eq('destination', 'meta_capi')
        .eq('me_sale_outcomes.client_id', clientId)
        .gte('created_at', sinceIso)
      return { data: r.data, error: r.error ? { message: r.error.message } : null }
    },
    { sleep: deps.sleep, retryResult: r => r.error !== null },
  )

  if (error) {
    errors.push(sanitizeError(error.message))
    return null
  }

  const counts = { confirmed: 0, in_doubt: 0, failed: 0 }
  const rows = Array.isArray(data) ? data : []
  for (const row of rows) {
    const status = (row as { status: unknown }).status
    if (status === 'confirmed') counts.confirmed += 1
    else if (status === 'in_doubt') counts.in_doubt += 1
    else if (status === 'failed' || status === 'failed_permanent') counts.failed += 1
  }
  return counts
}

// ─── 4. meta_token_resolved ─────────────────────────────────────────────────

async function readMetaTokenResolved(
  clientId: string,
  deps: EnvReadDeps,
  errors: string[],
): Promise<boolean> {
  try {
    const token = await retryOnce(() => deps.resolveMetaToken(clientId), { sleep: deps.sleep })
    return Boolean(token)
  } catch (err) {
    errors.push(sanitizeError(err))
    return false
  }
}

// ─── 5. jobs ────────────────────────────────────────────────────────────────

async function readOneJob(
  job: { job: string; max_age_hours: number },
  deps: EnvReadDeps,
  errors: string[],
): Promise<CronJobFact> {
  const empty: CronJobFact = {
    job: job.job,
    max_age_hours: job.max_age_hours,
    last_finished_at: null,
    last_status: null,
  }

  const { data, error } = await retryOnce(
    async () => {
      const r = await deps.supabase
        .from('cron_run_logs')
        .select('status, finished_at, started_at')
        .eq('job_name', job.job)
        .neq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
      return { data: r.data, error: r.error ? { message: r.error.message } : null }
    },
    { sleep: deps.sleep, retryResult: r => r.error !== null },
  )

  if (error) {
    errors.push(sanitizeError(error.message))
    return empty
  }

  const rows = Array.isArray(data) ? data : []
  const row = rows[0] as { status?: unknown; finished_at?: unknown } | undefined
  if (!row) return empty

  return {
    job: job.job,
    max_age_hours: job.max_age_hours,
    last_finished_at: asStringOrNull(row.finished_at),
    last_status: asStringOrNull(row.status),
  }
}

/** 任何一个子读取意外抛错（比如网络层）都只降级它自己，并留一条已清洗的错误。 */
async function guarded<T>(read: () => Promise<T>, fallback: T, errors: string[]): Promise<T> {
  try {
    return await read()
  } catch (err) {
    errors.push(sanitizeError(err))
    return fallback
  }
}

async function readJobs(
  requiredJobs: readonly { job: string; max_age_hours: number }[],
  deps: EnvReadDeps,
  errors: string[],
): Promise<CronJobFact[]> {
  const out: CronJobFact[] = []
  for (const job of requiredJobs) {
    const empty: CronJobFact = { job: job.job, max_age_hours: job.max_age_hours, last_finished_at: null, last_status: null }
    out.push(await guarded(() => readOneJob(job, deps, errors), empty, errors))
  }
  return out
}

// ─── 编排 ───────────────────────────────────────────────────────────────────

export async function readEnvFacts(
  input: EnvReadInput,
  deps: EnvReadDeps,
): Promise<EnvReadResult> {
  const { clientId, now } = input
  const requiredJobs = input.requiredJobs ?? REQUIRED_JOBS
  const errors: string[] = []

  const clientEnv = await guarded(() => readClientEnv(clientId, deps, errors), UNREAD_CLIENT, errors)
  const capi_preflight = await readCapiPreflight(clientId, deps, errors)
  const capi_events_7d = await guarded(() => readCapiEvents(clientId, now, deps, errors), null, errors)
  const meta_token_resolved = await readMetaTokenResolved(clientId, deps, errors)
  const jobs = await readJobs(requiredJobs, deps, errors)

  return {
    facts: {
      capi_target: clientEnv.target,
      capi_preflight,
      capi_events_7d,
      meta_token_resolved,
      conversion_stage: clientEnv.conversion_stage,
      jobs,
      as_of: now.toISOString(),
    },
    errors,
  }
}
