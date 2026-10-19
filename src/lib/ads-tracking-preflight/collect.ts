/**
 * 开投前追踪检查 —— 把各个读取器串起来（平台通用）。
 *
 * 两种用法，读的是同一批函数：
 *   · Inngest 函数每一步调一个 collectXxx（步骤各自重试、失败各自留痕）；
 *   · runClientPreflight 一口气跑完整条链路（本机试跑、集成测试用）。
 *
 * 顺序是有讲究的：先探落地页，再读 Meta——页面上出现了哪些像素编号，
 * 决定了只去读哪几个数据集的事件统计（不用把账户名下所有数据集都扫一遍）。
 *
 * 🔴 只读：不写 Meta / GA4 / 官网，不发布，不扣费。
 * 🔴 每个收集函数永不 reject：读不到就带着已清洗的原因返回，门会判成灰，绝不当成绿或 0。
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 像素编号 / 域名。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readCrmFacts } from './crm-reader'
import { readEnvFacts, type EnvReadDeps } from './env-reader'
import { readGa4Facts, type Ga4ReadDeps } from './ga4-reader'
import { judgePostLaunch, judgePreflightGates } from './judge'
import { probeLanding } from './landing-probe'
import { readMetaFacts } from './meta-reader'
import { readPostLaunchFacts } from './post-launch'
import { buildClientReceipt, type ItemLinks } from './receipt'
import { retryOnce, type Sleep } from './retry'
import { sanitizeError } from './sanitize'
import type {
  CrmFacts,
  EnvFacts,
  Ga4Facts,
  LandingFacts,
  LandingProbeFact,
  MetaFacts,
  PostLaunchFacts,
  TrackingClientConfig,
  TrackingClientReceipt,
  TrackingReadError,
  TrackingReadSource,
  TrackingTrigger,
} from './types'

export interface CollectDeps {
  now: Date
  fetcher: typeof fetch
  supabase: SupabaseClient
  env: Record<string, string | undefined>
  /** 只返回「有没有、是什么」；令牌只在读取器内部用，绝不进回执。 */
  resolveMetaToken(clientId: string): Promise<string | null>
  capiPreflight: EnvReadDeps['capiPreflight']
  ga4: Ga4ReadDeps
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

export interface Collected<T> {
  facts: T
  errors: TrackingReadError[]
}

function tag(source: TrackingReadSource, errors: readonly string[]): TrackingReadError[] {
  return errors.map(error => ({ source, error }))
}

// ─── 分步收集 ───────────────────────────────────────────────────────────────

/** 按配置顺序逐个探落地页。 */
export async function collectLandingFacts(cfg: TrackingClientConfig, deps: CollectDeps): Promise<Collected<LandingFacts>> {
  const probes: LandingProbeFact[] = []
  for (const target of cfg.landing_targets) {
    probes.push(await probeLanding(target, { siteUrl: cfg.site_url, fetcher: deps.fetcher, sleep: deps.sleep }))
  }
  const errors = probes.filter(p => p.error !== null).map(p => `${p.label}：${p.error}`)
  return { facts: { probes, as_of: deps.now.toISOString() }, errors: tag('landing', errors) }
}

/** 读官方账户的数据集 / 事件统计 / 匹配质量 / 账户状态。没有令牌就一个请求都不发。 */
export async function collectMetaFacts(
  clientId: string,
  cfg: TrackingClientConfig,
  focusPixelIds: readonly string[],
  deps: CollectDeps,
): Promise<Collected<MetaFacts>> {
  const unread = (message: string): Collected<MetaFacts> => ({
    facts: { read: false, as_of: deps.now.toISOString(), account_dataset_ids: [], datasets: [], account: null },
    errors: tag('meta', [message]),
  })

  let token: string | null
  try {
    token = await retryOnce(() => deps.resolveMetaToken(clientId), { sleep: deps.sleep })
  } catch (err) {
    return unread(`找 Meta 令牌时出错：${sanitizeError(err)}`)
  }
  if (!token) return unread('没有可用的 Meta 令牌，Meta 相关的检查都没法读')

  const out = await readMetaFacts({ adAccountId: cfg.ad_account_id, focusPixelIds, token, fetcher: deps.fetcher, now: deps.now, sleep: deps.sleep })
  return { facts: out.facts, errors: tag('meta', out.errors) }
}

export async function collectGa4Facts(clientId: string, cfg: TrackingClientConfig, deps: CollectDeps): Promise<Collected<Ga4Facts>> {
  const out = await readGa4Facts(
    { clientId, eventNames: cfg.ga4_lead_events, now: deps.now },
    { ...deps.ga4, sleep: deps.ga4.sleep ?? deps.sleep },
  )
  return { facts: out.facts, errors: tag('ga4', out.errors) }
}

/** 该客户没有官网表单时不查库（那道门判「不适用」，用不上这份事实）。 */
export async function collectCrmFacts(clientId: string, cfg: TrackingClientConfig, deps: CollectDeps): Promise<Collected<CrmFacts>> {
  if (!cfg.web_form_to_crm) {
    return {
      facts: { read: true, error: null, web_form_touchpoints_7d: 0, latest_web_form_at: null, as_of: deps.now.toISOString() },
      errors: [],
    }
  }
  const out = await readCrmFacts(deps.supabase, clientId, deps.now, deps.sleep)
  return { facts: out.facts, errors: tag('crm', out.errors) }
}

export async function collectEnvFacts(clientId: string, deps: CollectDeps): Promise<Collected<EnvFacts>> {
  const out = await readEnvFacts(
    { clientId, now: deps.now },
    { supabase: deps.supabase, env: deps.env, capiPreflight: deps.capiPreflight, resolveMetaToken: deps.resolveMetaToken, sleep: deps.sleep },
  )
  return { facts: out.facts, errors: tag('env', out.errors) }
}

// ─── 红灯直达链接 ───────────────────────────────────────────────────────────

const EVENTS_MANAGER = 'https://business.facebook.com/events_manager2'

/** 每道门的红灯待办直达哪里；没有专属地方的退到推广计划页。 */
export function buildItemLinks(
  clientId: string,
  cfg: TrackingClientConfig,
  ctx: { appBase: string; datasetId: string | null },
): ItemLinks {
  const id = encodeURIComponent(clientId)
  const fallback = `${ctx.appBase}/dashboard/clients/${id}/promo-plan`
  const events = ctx.datasetId ? `${EVENTS_MANAGER}/list/dataset/${ctx.datasetId}` : EVENTS_MANAGER
  const accountDigits = cfg.ad_account_id.replace(/^act_/, '')
  return {
    fallback,
    byGate: {
      'tracking.account_dataset_aligned': events,
      'tracking.pixel_alive': events,
      'tracking.lead_event_seen': events,
      'tracking.lead_event_quality': events,
      'tracking.capi_ready': events,
      'tracking.ga4_events': 'https://analytics.google.com/analytics/web/',
      'tracking.landing_ok': cfg.landing_targets[0]?.url ?? fallback,
      'tracking.lead_reaches_crm': `${ctx.appBase}/dashboard/clients/${id}/crm`,
      'env.token_and_crons': `${ctx.appBase}/dashboard/admin/cron-health`,
      'env.account_billing': `https://business.facebook.com/billing_hub/payment_settings?asset_id=${accountDigits}`,
    },
  }
}

/** 链接用哪个数据集：官网在发的官方数据集优先，其次官方账户的第一个，都没有就 null。 */
function pickDatasetId(meta: MetaFacts, landing: LandingFacts): string | null {
  const site = new Set(landing.probes.flatMap(p => p.pixel_ids))
  return meta.account_dataset_ids.find(id => site.has(id)) ?? meta.account_dataset_ids[0] ?? null
}

// ─── 出回执 ─────────────────────────────────────────────────────────────────

export interface PreflightAssembly {
  requestId: string
  clientId: string
  cfg: TrackingClientConfig
  trigger: TrackingTrigger
  appBase: string
  now: Date
  landing: Collected<LandingFacts>
  meta: Collected<MetaFacts>
  ga4: Collected<Ga4Facts>
  crm: Collected<CrmFacts>
  env: Collected<EnvFacts>
}

/** 纯函数：把收集到的事实判成十道门，再包成一个客户的回执。 */
export function assemblePreflightReceipt(a: PreflightAssembly): TrackingClientReceipt {
  const gates = judgePreflightGates({
    config: a.cfg,
    now: a.now,
    meta: a.meta.facts,
    landing: a.landing.facts,
    ga4: a.ga4.facts,
    crm: a.crm.facts,
    env: a.env.facts,
  })
  return buildClientReceipt({
    requestId: a.requestId,
    clientId: a.clientId,
    checkedAt: a.now.toISOString(),
    trigger: a.trigger,
    phase: 'preflight',
    gates,
    readErrors: [...a.landing.errors, ...a.meta.errors, ...a.ga4.errors, ...a.crm.errors, ...a.env.errors],
    links: buildItemLinks(a.clientId, a.cfg, { appBase: a.appBase, datasetId: pickDatasetId(a.meta.facts, a.landing.facts) }),
  })
}

/** 一口气跑完整条链路（顺序：落地页 → Meta → GA4 → CRM → 环境）。 */
export async function runClientPreflight(args: {
  clientId: string
  cfg: TrackingClientConfig
  requestId: string
  trigger: TrackingTrigger
  appBase: string
  deps: CollectDeps
}): Promise<TrackingClientReceipt> {
  const { clientId, cfg, deps } = args
  const landing = await collectLandingFacts(cfg, deps)
  const focus = Array.from(new Set(landing.facts.probes.flatMap(p => p.pixel_ids)))
  const meta = await collectMetaFacts(clientId, cfg, focus, deps)
  const ga4 = await collectGa4Facts(clientId, cfg, deps)
  const crm = await collectCrmFacts(clientId, cfg, deps)
  const env = await collectEnvFacts(clientId, deps)
  return assemblePreflightReceipt({
    requestId: args.requestId,
    clientId,
    cfg,
    trigger: args.trigger,
    appBase: args.appBase,
    now: deps.now,
    landing,
    meta,
    ga4,
    crm,
    env,
  })
}

// ─── 开投后读回 ─────────────────────────────────────────────────────────────

/**
 * 读自开投时刻起、本次投放的广告系列（客户配置里的编号或名字关键词对得上的那些）的洞察。
 * 🔴 没配系列（没有盯盘窗口，或窗口里编号和名字关键词都没写）就拒绝，绝不退回整个账户的口径。
 * 没有令牌就一个请求都不发。
 */
export async function collectPostLaunchFacts(
  clientId: string,
  cfg: TrackingClientConfig,
  launchedAt: string,
  deps: CollectDeps,
): Promise<Collected<PostLaunchFacts>> {
  const unread = (message: string): Collected<PostLaunchFacts> => ({
    facts: {
      read: false, error: message, as_of: deps.now.toISOString(),
      spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0,
    },
    errors: tag('insights', [message]),
  })

  let token: string | null
  try {
    token = await retryOnce(() => deps.resolveMetaToken(clientId), { sleep: deps.sleep })
  } catch (err) {
    return unread(`找 Meta 令牌时出错：${sanitizeError(err)}`)
  }
  if (!token) return unread('没有可用的 Meta 令牌，开投后的数据没法读')

  const out = await readPostLaunchFacts({
    adAccountId: cfg.ad_account_id,
    token,
    fetcher: deps.fetcher,
    now: deps.now,
    launchedAt,
    sleep: deps.sleep,
    campaignIds: cfg.launch_watch?.campaign_ids,
    campaignNameContains: cfg.launch_watch?.campaign_name_contains,
  })
  return { facts: out.facts, errors: tag('insights', out.errors) }
}

/** 纯函数：把开投后读回的数字判成一道门，再包成回执。 */
export function assemblePostLaunchReceipt(a: {
  requestId: string
  clientId: string
  cfg: TrackingClientConfig
  phase: 'post_t1h' | 'post_t24h'
  appBase: string
  now: Date
  /** 开投时刻（ISO）：写进回执，供「自动补排」判断 T+24h 什么时候到 */
  launchedAt: string
  insights: Collected<PostLaunchFacts>
}): TrackingClientReceipt {
  return buildClientReceipt({
    requestId: a.requestId,
    clientId: a.clientId,
    checkedAt: a.now.toISOString(),
    trigger: 'postlaunch',
    phase: a.phase,
    launchedAt: a.launchedAt,
    gates: [judgePostLaunch(a.phase, a.insights.facts)],
    readErrors: a.insights.errors,
    links: buildItemLinks(a.clientId, a.cfg, { appBase: a.appBase, datasetId: null }),
  })
}
