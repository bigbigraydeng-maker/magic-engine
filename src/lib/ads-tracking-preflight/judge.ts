/**
 * 广告开投前「追踪与环境就绪」检查 —— 判定函数（平台通用）。
 *
 * 设计稿：docs/specs/2026-10-19-ads-tracking-preflight-workflow.md
 *
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 像素编号 / 域名。
 * 🔴 纯函数：不读 I/O、不读环境变量、不取 Date.now()（时间一律从入参拿）。
 * 🔴 灰（没读到 / 没证据）永不等于绿，也不等于 0。
 */

import type { Light } from '@/lib/marketing-plan/promo/gates'
import {
  HARD_GATE,
  PREFLIGHT_GATE_KEYS,
  type EvidenceValue,
  type JudgeInput,
  type KnownIssue,
  type MetaDatasetFact,
  type PostLaunchFacts,
  type PreflightGateKey,
  type TrackingGateKey,
  type TrackingGateReceipt,
} from './types'

export const PIXEL_ALIVE_WINDOW_HOURS = 24
export const MIN_LEAD_MATCH_QUALITY = 7
export const MIN_POST_CLICKS_FOR_RATIO = 10
export const MIN_POST_LPV_RATIO = 0.5
export const MIN_POST_CLICKS_FOR_LEAD_CHECK = 50

export const GATE_LABELS: Record<TrackingGateKey, string> = {
  'tracking.account_dataset_aligned': '数据集对齐（广告账户 / 官网像素 / 回传目标）',
  'tracking.pixel_alive': '像素在线',
  'tracking.lead_event_seen': '收到留资事件',
  'tracking.lead_event_quality': '留资事件匹配质量',
  'tracking.ga4_events': 'GA4 收到留资事件',
  'tracking.landing_ok': '落地页可用',
  'tracking.lead_reaches_crm': '官网线索进 CRM',
  'tracking.capi_ready': '转化回传可用',
  'env.token_and_crons': 'Meta 令牌与定时任务',
  'env.account_billing': '广告账户与付款',
  'post.t1h': '开投后 1 小时读回',
  'post.t24h': '开投后 24 小时读回',
}

// ─── 小工具 ─────────────────────────────────────────────────────────────────

function ageHours(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / 3_600_000
}

function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs))
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`
}

function leadNamesOf(input: JudgeInput): string[] {
  return input.config.lead_event_names ?? ['Lead']
}

/** 官网页面里出现过的像素编号（去重）。 */
function sitePixelIds(input: JudgeInput): string[] {
  return uniq(input.landing.probes.flatMap(p => p.pixel_ids))
}

/** 官方账户数据集 ∩ 官网像素（保持官方顺序）。 */
function commonDatasetIds(input: JudgeInput): string[] {
  const site = new Set(sitePixelIds(input))
  return input.meta.account_dataset_ids.filter(id => site.has(id))
}

/** 官网在发、且官方账户名下的数据集事实；找不到对应事实的 id 记为 undefined。 */
function datasetsInPlay(input: JudgeInput): (MetaDatasetFact | undefined)[] {
  return commonDatasetIds(input).map(id => input.meta.datasets.find(d => d.id === id))
}

/** 近 7 天 Meta 留资事件总数（忽略读不到的）。 */
function metaLeadTotal(input: JudgeInput): number {
  const names = leadNamesOf(input)
  let total = 0
  for (const d of datasetsInPlay(input)) {
    if (!d || d.events_7d === null) continue
    for (const name of names) total += d.events_7d[name] ?? 0
  }
  return total
}

function receipt(
  key: TrackingGateKey,
  status: Light,
  reason: string,
  how: string,
  evidence: Record<string, EvidenceValue>,
  as_of: string | null,
): TrackingGateReceipt {
  return { key, status, reason, how, evidence, as_of, hard: HARD_GATE[key] }
}

// ─── 1. 数据集对齐 ──────────────────────────────────────────────────────────

function judgeAccountDatasetAligned(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.account_dataset_aligned'
  const as_of = input.meta.as_of
  const official = input.meta.account_dataset_ids
  const site = sitePixelIds(input)
  const common = commonDatasetIds(input)
  const baseEvidence: Record<string, EvidenceValue> = {
    official_dataset_ids: official,
    site_pixel_ids: site,
    common_dataset_ids: common,
  }

  if (!input.meta.read) {
    return receipt(key, 'gray', '官方广告账户的数据集没读到', '确认 Meta 令牌能读该账户的数据集', baseEvidence, as_of)
  }
  if (official.length === 0) {
    return receipt(key, 'red', '官方广告账户名下没有任何数据集', '在 Meta 里给该账户建一个数据集，并把官网像素接上', baseEvidence, as_of)
  }
  if (!input.landing.probes.some(p => p.http_status !== null)) {
    return receipt(key, 'gray', '官网页面一个都没探通，没法确认像素编号', '确认官网能访问，再重跑一次探测', baseEvidence, as_of)
  }
  if (common.length === 0) {
    return receipt(
      key, 'red',
      '官网页面上的像素都不在官方广告账户的数据集里',
      '把官网的像素换成官方账户名下的数据集，或把该像素接进官方账户',
      baseEvidence, as_of,
    )
  }
  if (input.env.capi_target.status === 'unreadable') {
    return receipt(key, 'gray', 'ME 的回传目标读不出来，没法确认对齐', '检查 ME 的转化 API 配置能否读取', baseEvidence, as_of)
  }
  if (input.env.capi_target.status === 'configured' && input.env.capi_target.pixel_id !== null && common.includes(input.env.capi_target.pixel_id)) {
    return receipt(key, 'green', '官网在往官方数据集发，ME 回传目标也是它', '', baseEvidence, as_of)
  }
  const reason = input.env.capi_target.status === 'not_configured'
    ? '官网在发官方数据集，但 ME 没配回传目标'
    : '官网在发官方数据集，但 ME 的回传目标不是官网在发的官方数据集'
  return receipt(
    key, 'yellow', reason,
    '把 ME 的转化 API 回传目标（生产环境变量）改成官网在发的官方数据集。这是改生产配置，要先取得 PM 同意；改完要手动触发一次重新部署才生效。',
    baseEvidence, as_of,
  )
}

// ─── 2. 像素在线 ────────────────────────────────────────────────────────────

type PixelState = 'alive' | 'lagging' | 'dead' | 'unknown'

function pixelState(d: MetaDatasetFact | undefined, now: Date): PixelState {
  if (!d || d.events_24h === null) return 'unknown'
  const pv = d.events_24h['PageView'] ?? 0
  if (pv === 0) return 'dead'
  const firedRecently = d.last_fired_at !== null && ageHours(d.last_fired_at, now) <= PIXEL_ALIVE_WINDOW_HOURS
  return firedRecently ? 'alive' : 'lagging'
}

function judgePixelAlive(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.pixel_alive'
  const as_of = input.meta.as_of
  const ds = datasetsInPlay(input)
  const evidence: Record<string, EvidenceValue> = { datasets_in_play: ds.length }

  if (ds.length === 0) {
    return receipt(key, 'gray', '官网没往官方数据集发数据，先把数据集对上', '先解决「数据集对齐」这道门', evidence, as_of)
  }

  const states = ds.map(d => pixelState(d, input.now))
  const alive = states.filter(s => s === 'alive').length
  const lagging = states.filter(s => s === 'lagging').length
  const dead = states.filter(s => s === 'dead').length
  const unknown = states.filter(s => s === 'unknown').length
  evidence.alive = alive
  evidence.lagging = lagging
  evidence.dead = dead
  evidence.unknown = unknown

  if (alive === states.length) {
    return receipt(key, 'green', '官方数据集 24 小时内触发过，且有 PageView', '', evidence, as_of)
  }
  if (dead === states.length) {
    return receipt(key, 'red', '官方数据集 24 小时内没有 PageView', '检查官网像素是否还在加载、是否被拦截', evidence, as_of)
  }
  if (alive + lagging > 0) {
    return receipt(key, 'yellow', '部分官方数据集在线、部分已死', '逐个核对官网在发的数据集，停掉不用的', evidence, as_of)
  }
  if (dead > 0) {
    return receipt(key, 'red', '官方数据集 24 小时内没有 PageView', '检查官网像素是否还在加载、是否被拦截', evidence, as_of)
  }
  return receipt(key, 'gray', '事件统计没读到，没法判断像素是否在线', '确认 Meta 事件统计能读到', evidence, as_of)
}

// ─── 3. 收到留资事件 ────────────────────────────────────────────────────────

function judgeLeadEventSeen(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.lead_event_seen'
  const as_of = input.meta.as_of
  const names = leadNamesOf(input)
  const ds = datasetsInPlay(input)
  const evidence: Record<string, EvidenceValue> = {
    lead_events_7d: metaLeadTotal(input),
    lead_event_names: names,
  }

  if (ds.length === 0) {
    return receipt(key, 'gray', '官网没往官方数据集发数据，先把数据集对上', '先解决「数据集对齐」这道门', evidence, as_of)
  }
  const total = metaLeadTotal(input)
  if (total >= 1) {
    return receipt(key, 'green', `近 7 天收到 ${total} 条留资事件`, '', evidence, as_of)
  }
  const unknown = ds.filter(d => !d || d.events_7d === null).length
  if (unknown > 0) {
    return receipt(key, 'gray', '事件统计没读到，没法确认是否收到留资事件', '确认 Meta 事件统计能读到', evidence, as_of)
  }
  return receipt(key, 'red', '近 7 天一条留资事件都没收到', '检查官网表单提交后是否触发留资事件', evidence, as_of)
}

// ─── 4. 留资事件匹配质量 ────────────────────────────────────────────────────

function datasetMatchScore(d: MetaDatasetFact | undefined, names: readonly string[]): number | null {
  if (!d || d.match_quality === null) return null
  let best: number | null = null
  for (const name of names) {
    const v = d.match_quality[name]
    if (typeof v === 'number' && (best === null || v > best)) best = v
  }
  return best
}

function judgeLeadEventQuality(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.lead_event_quality'
  const as_of = input.meta.as_of
  const names = leadNamesOf(input)
  const scores = datasetsInPlay(input)
    .map(d => datasetMatchScore(d, names))
    .filter((s): s is number => s !== null)
  const overall = scores.length === 0 ? null : Math.min(...scores)
  const evidence: Record<string, EvidenceValue> = { lead_match_quality: overall }

  if (overall === null) {
    return receipt(key, 'gray', '没有留资事件的匹配质量分', '确认 Meta 能读到留资事件的匹配质量', evidence, as_of)
  }
  if (overall >= MIN_LEAD_MATCH_QUALITY) {
    return receipt(key, 'green', `留资事件匹配质量 ${overall}`, '', evidence, as_of)
  }
  return receipt(key, 'yellow', `留资事件匹配质量 ${overall}，低于 ${MIN_LEAD_MATCH_QUALITY}`, '补全表单字段、开启高级匹配', evidence, as_of)
}

// ─── 5. GA4 收到留资事件 ────────────────────────────────────────────────────

function judgeGa4Events(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.ga4_events'
  const as_of = input.ga4.as_of
  const names = input.config.ga4_lead_events
  // 没读到时不写任何次数：「没读到」不是 0，证据里也不能让人读成 0
  const evidence: Record<string, EvidenceValue> = {}
  if (input.ga4.read) {
    for (const name of names) evidence[`ga4_${name}`] = input.ga4.events_7d[name] ?? 0
  }

  if (!input.ga4.read) {
    const reason = input.ga4.error ? `GA4 没读到：${input.ga4.error}` : 'GA4 没读到'
    return receipt(key, 'gray', reason, '确认该客户的 Google 授权可用', evidence, as_of)
  }
  if (names.length === 0) {
    return receipt(key, 'gray', '客户配置里没有 GA4 留资事件', '在客户配置里补上 GA4 留资事件名', evidence, as_of)
  }
  const missing = names.filter(name => (input.ga4.events_7d[name] ?? 0) === 0)
  if (missing.length === 0) {
    return receipt(key, 'green', '配置里的 GA4 留资事件近 7 天都收到了', '', evidence, as_of)
  }
  if (missing.length === names.length) {
    return receipt(key, 'red', '配置里的 GA4 留资事件近 7 天一条都没收到', '检查 GA4 事件是否还在触发', evidence, as_of)
  }
  return receipt(key, 'yellow', `GA4 近 7 天没收到：${missing.join('、')}`, '检查这些 GA4 事件是否还在触发', evidence, as_of)
}

// ─── 6. 落地页可用 ──────────────────────────────────────────────────────────

function judgeLandingOk(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.landing_ok'
  const as_of = input.landing.as_of
  const probes = input.landing.probes
  const evidence: Record<string, EvidenceValue> = { probes: probes.length }

  if (probes.length === 0) {
    return receipt(key, 'gray', '客户配置里没有任何落地页', '在客户配置里补上落地页地址', evidence, as_of)
  }

  const bad: string[] = []
  const unknown: string[] = []
  for (const p of probes) {
    if (p.http_status === null) {
      unknown.push(p.label)
      continue
    }
    const problems: string[] = []
    if (p.http_status !== 200) problems.push(`HTTP ${p.http_status}`)
    if (p.utm_preserved === false) problems.push('跳转后 UTM 丢了')
    if (p.pixel_ids.length === 0) problems.push('页面里没找到 Meta 像素标记')
    if (problems.length > 0) bad.push(`${p.label}：${problems.join('、')}`)
  }

  if (bad.length > 0) {
    return receipt(key, 'red', bad.join('；'), '修好这些落地页再开投', evidence, as_of)
  }
  if (unknown.length > 0) {
    return receipt(key, 'gray', `没连上：${unknown.join('、')}`, '确认这些落地页能访问，再重跑一次探测', evidence, as_of)
  }
  return receipt(key, 'green', '落地页都能打开、UTM 保留、页面里有像素标记', '', evidence, as_of)
}

// ─── 7. 官网线索进 CRM ──────────────────────────────────────────────────────

function judgeLeadReachesCrm(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.lead_reaches_crm'
  const as_of = input.crm.as_of

  if (input.config.web_form_to_crm === false) {
    return {
      key, status: 'gray', reason: '该客户没有官网表单，本项不适用', how: '',
      evidence: {}, as_of: null, hard: false, na: true,
    }
  }

  const metaTotal = metaLeadTotal(input)
  const ga4Total = input.config.ga4_lead_events.reduce(
    (sum, name) => sum + (input.ga4.events_7d[name] ?? 0), 0,
  )
  const leadSignal = Math.max(metaTotal, ga4Total)
  const evidence: Record<string, EvidenceValue> = {
    crm_web_form_touchpoints_7d: input.crm.web_form_touchpoints_7d,
    lead_signal_7d: leadSignal,
    latest_web_form_at: input.crm.latest_web_form_at,
  }

  if (!input.crm.read) {
    return receipt(key, 'gray', 'CRM 没读到', '确认 CRM 能读到', evidence, as_of)
  }
  if (input.crm.web_form_touchpoints_7d >= 1) {
    return receipt(key, 'green', `近 7 天 CRM 里有 ${input.crm.web_form_touchpoints_7d} 条官网表单线索`, '', evidence, as_of)
  }
  if (leadSignal > 0) {
    return receipt(
      key, 'red',
      `网站近 7 天有 ${leadSignal} 个留资信号，但 CRM 里 0 条官网表单线索`,
      '检查官网表单提交后是否真的写进 CRM',
      evidence, as_of,
    )
  }
  return receipt(key, 'gray', 'CRM 没有、网站也没有留资信号，没法验证', '请人在官网提交一次试跑线索，再重跑检查', evidence, as_of)
}

// ─── 8. 转化回传可用 ────────────────────────────────────────────────────────

function judgeCapiReady(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.capi_ready'
  const as_of = input.env.as_of
  const pre = input.env.capi_preflight
  const ev = input.env.capi_events_7d
  const evidence: Record<string, EvidenceValue> = {
    capi_preflight_ok: pre ? pre.ok : null,
    capi_confirmed_7d: ev ? ev.confirmed : null,
    capi_in_doubt_7d: ev ? ev.in_doubt : null,
    capi_failed_7d: ev ? ev.failed : null,
  }

  if (pre === null) {
    return receipt(key, 'gray', '转化 API 探活没跑成', '重跑一次转化 API 探活', evidence, as_of)
  }
  if (!pre.ok) {
    const reason = pre.stage ? `转化 API 探活没通过（阶段：${pre.stage}）` : '转化 API 探活没通过'
    return receipt(key, 'red', reason, '检查转化 API 的令牌与像素配置', evidence, as_of)
  }
  if (ev === null) {
    return receipt(key, 'yellow', '探活通过，但没读到近 7 天的回传统计', '确认回传统计能读到', evidence, as_of)
  }
  if (ev.failed > 0 || ev.in_doubt > 0) {
    return receipt(key, 'yellow', `近 7 天回传有 ${ev.failed} 条失败、${ev.in_doubt} 条不确定`, '排查失败的回传事件', evidence, as_of)
  }
  return receipt(key, 'green', '转化 API 探活通过，近 7 天没有失败的回传', '', evidence, as_of)
}

// ─── 9. Meta 令牌与定时任务 ─────────────────────────────────────────────────

function judgeTokenAndCrons(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'env.token_and_crons'
  const as_of = input.env.as_of
  const problems: string[] = []

  if (!input.env.meta_token_resolved) problems.push('没有可用的 Meta 令牌')
  if (input.env.capi_preflight?.token_valid === false) problems.push('Meta 令牌已失效')
  for (const job of input.env.jobs) {
    if (job.last_finished_at === null) {
      problems.push(`${job.job} 从没跑过`)
    } else {
      const age = ageHours(job.last_finished_at, input.now)
      if (age > job.max_age_hours) {
        problems.push(`${job.job} 已 ${Math.round(age)} 小时没跑（应在 ${job.max_age_hours} 小时内）`)
      }
    }
    if (job.last_status === 'failed') problems.push(`${job.job} 最近一次是失败`)
  }

  const evidence: Record<string, EvidenceValue> = {
    meta_token_resolved: input.env.meta_token_resolved,
    jobs: input.env.jobs.length,
  }

  if (problems.length > 0) {
    return receipt(key, 'red', problems.join('；'), '修好令牌 / 定时任务再开投', evidence, as_of)
  }
  if (input.env.capi_preflight === null) {
    return receipt(key, 'yellow', '令牌有，但这次没验证有效性', '重跑一次转化 API 探活来验证令牌', evidence, as_of)
  }
  return receipt(key, 'green', '令牌可用、定时任务都在期', '', evidence, as_of)
}

// ─── 10. 广告账户与付款 ─────────────────────────────────────────────────────

function judgeAccountBilling(input: JudgeInput): TrackingGateReceipt {
  const key: PreflightGateKey = 'env.account_billing'
  const as_of = input.meta.as_of
  const acc = input.meta.account
  const cfg = input.config
  const evidence: Record<string, EvidenceValue> = {
    account_status: acc ? acc.status : null,
    has_funding_source: acc ? acc.has_funding_source : null,
    planned_daily_budget_cents: cfg.planned_daily_budget_cents,
    official_daily_cap_cents: cfg.official_daily_cap_cents,
  }

  if (!input.meta.read || acc === null) {
    return receipt(key, 'gray', '广告账户信息没读到', '确认 Meta 令牌能读该账户', evidence, as_of)
  }

  const problems: string[] = []
  if (acc.status !== 1) problems.push(`账户状态码 ${acc.status ?? '未知'}，不是正常状态`)
  if (typeof acc.disable_reason === 'number' && acc.disable_reason !== 0) {
    problems.push(`账户被停用（原因码 ${acc.disable_reason}）`)
  }
  if (acc.has_funding_source === false) problems.push('账户没有付款方式')
  if (
    acc.spend_cap_minor !== null && acc.spend_cap_minor > 0 &&
    cfg.planned_daily_budget_cents !== null &&
    acc.spend_cap_minor - (acc.amount_spent_minor ?? 0) < cfg.planned_daily_budget_cents
  ) {
    problems.push('账户花费上限的剩余额度不够一天的计划预算')
  }
  if (
    cfg.planned_daily_budget_cents !== null && cfg.official_daily_cap_cents !== null &&
    cfg.planned_daily_budget_cents > cfg.official_daily_cap_cents
  ) {
    problems.push(
      `计划日预算 ${money(cfg.planned_daily_budget_cents, cfg.currency)} 超过官方日上限 ${money(cfg.official_daily_cap_cents, cfg.currency)}`,
    )
  }

  if (problems.length > 0) {
    return receipt(key, 'red', problems.join('；'), '修好账户 / 付款 / 预算再开投', evidence, as_of)
  }
  if (acc.has_funding_source === null) {
    return receipt(key, 'gray', '有没有付款方式没读到', '确认 Meta 能读到付款方式', evidence, as_of)
  }
  if (cfg.planned_daily_budget_cents === null || cfg.official_daily_cap_cents === null) {
    return receipt(key, 'yellow', '没配置计划日预算或官方日上限，没法核对', '在客户配置里补上计划日预算和官方日上限', evidence, as_of)
  }
  return receipt(key, 'green', '账户正常、有付款方式、预算在上限内', '', evidence, as_of)
}

// ─── 汇总 ───────────────────────────────────────────────────────────────────

const JUDGES: Record<PreflightGateKey, (input: JudgeInput) => TrackingGateReceipt> = {
  'tracking.account_dataset_aligned': judgeAccountDatasetAligned,
  'tracking.pixel_alive': judgePixelAlive,
  'tracking.lead_event_seen': judgeLeadEventSeen,
  'tracking.lead_event_quality': judgeLeadEventQuality,
  'tracking.ga4_events': judgeGa4Events,
  'tracking.landing_ok': judgeLandingOk,
  'tracking.lead_reaches_crm': judgeLeadReachesCrm,
  'tracking.capi_ready': judgeCapiReady,
  'env.token_and_crons': judgeTokenAndCrons,
  'env.account_billing': judgeAccountBilling,
}

export function judgePreflightGates(input: JudgeInput): TrackingGateReceipt[] {
  const gates = PREFLIGHT_GATE_KEYS.map(key => JUDGES[key](input))
  const issues = input.config.known_issues ?? []
  return issues.length > 0 ? applyKnownIssues(gates, issues, input.now) : gates
}

// ─── 开投后读回 ─────────────────────────────────────────────────────────────

export function judgePostLaunch(phase: 'post_t1h' | 'post_t24h', f: PostLaunchFacts): TrackingGateReceipt {
  const key: TrackingGateKey = phase === 'post_t1h' ? 'post.t1h' : 'post.t24h'
  const evidence: Record<string, EvidenceValue> = {
    spend_cents: f.spend_cents,
    link_clicks: f.link_clicks,
    landing_page_views: f.landing_page_views,
    leads: f.leads,
  }

  if (!f.read) {
    const reason = f.error ? `开投后读回没读到：${f.error}` : '开投后读回没读到'
    return receipt(key, 'gray', reason, '确认 Meta 洞察能读到', evidence, f.as_of)
  }
  if (f.spend_cents <= 0) {
    return receipt(key, 'gray', '还没开始花钱，没法判断', '等有花费后再读回', evidence, f.as_of)
  }
  if (f.link_clicks === 0) {
    const status: Light = phase === 'post_t1h' ? 'yellow' : 'red'
    return receipt(key, status, '花了钱但一次点击都没有', '检查广告是否在投、落地页是否可达', evidence, f.as_of)
  }
  if (f.link_clicks >= MIN_POST_CLICKS_FOR_RATIO && f.landing_page_views === 0) {
    return receipt(key, 'red', `点击 ${f.link_clicks} 次但落地页浏览为 0`, '检查落地页是否可达、像素是否在加载', evidence, f.as_of)
  }
  if (f.link_clicks >= MIN_POST_CLICKS_FOR_RATIO && f.landing_page_views / f.link_clicks < MIN_POST_LPV_RATIO) {
    return receipt(key, 'yellow', `落地页浏览 / 点击 = ${(f.landing_page_views / f.link_clicks).toFixed(2)}，低于 ${MIN_POST_LPV_RATIO}`, '检查落地页加载速度与跳转', evidence, f.as_of)
  }
  if (phase === 'post_t24h' && f.link_clicks >= MIN_POST_CLICKS_FOR_LEAD_CHECK && f.leads === 0) {
    return receipt(key, 'yellow', `点击 ${f.link_clicks} 次却一条留资都没有`, '检查表单与留资事件是否还在触发', evidence, f.as_of)
  }
  return receipt(key, 'green', '点击、落地页浏览、留资都正常', '', evidence, f.as_of)
}

// ─── 已知问题 ───────────────────────────────────────────────────────────────

/** 已知问题没写「怎么办」时的兜底说法。 */
const DEFAULT_KNOWN_ISSUE_HOW = '按已知问题的说明处理；问题修好后，从客户配置里删掉这一条已知问题。'

export function applyKnownIssues(
  gates: TrackingGateReceipt[],
  issues: readonly KnownIssue[],
  now: Date,
): TrackingGateReceipt[] {
  const today = now.toISOString().slice(0, 10)
  return gates.map(gate => {
    if (gate.na) return gate
    const issue = issues.find(i => i.gate === gate.key && today < i.expires_on)
    if (!issue) return gate
    const suffix = `；已知问题（${issue.observed_on} 盘点）：${issue.note}`
    const status: Light = gate.status === 'green' ? 'yellow' : gate.status
    const how = gate.how === '' ? (issue.how ?? DEFAULT_KNOWN_ISSUE_HOW) : gate.how
    return { ...gate, status, reason: gate.reason + suffix, how }
  })
}

// ─── 总灯 / 前置条件 ────────────────────────────────────────────────────────

const SEVERITY: Record<Light, number> = { green: 0, yellow: 1, gray: 2, red: 3 }

export function overallLight(gates: readonly TrackingGateReceipt[]): Light {
  const applicable = gates.filter(g => !g.na)
  if (applicable.length === 0) return 'gray'
  let worst: Light = 'green'
  for (const g of applicable) {
    if (SEVERITY[g.status] > SEVERITY[worst]) worst = g.status
  }
  return worst
}

export function preconditionsMet(gates: readonly TrackingGateReceipt[]): boolean {
  return gates.every(g => {
    if (g.na) return true
    if (!g.hard) return true
    return g.status !== 'red' && g.status !== 'gray'
  })
}
