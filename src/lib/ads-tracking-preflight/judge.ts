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
  type BudgetFacts,
  type EvidenceValue,
  type JudgeInput,
  type KnownIssue,
  type MetaDatasetFact,
  type PostLaunchFacts,
  type PreflightGateKey,
  type TrackingGateKey,
  type TrackingGateReceipt,
} from './types'
import { summarizeOtherAccounts } from './other-accounts-text'

export const PIXEL_ALIVE_WINDOW_HOURS = 24
export const MIN_LEAD_MATCH_QUALITY = 7
export const MIN_POST_CLICKS_FOR_RATIO = 10
export const MIN_POST_LPV_RATIO = 0.5
export const MIN_POST_CLICKS_FOR_LEAD_CHECK = 50
/** 官网表单线索进 CRM：最近一条必须在这么多小时内，才算「管道现在是通的」。 */
export const CRM_FRESH_WINDOW_HOURS = 48
/** 线索时间比「现在」晚多少以内算时钟误差（5 分钟）；更晚就是未来的时间，是脏数据 / 时钟偏差，不能判绿。 */
export const CRM_CLOCK_SKEW_HOURS = 5 / 60

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

/**
 * 事件统计「读成功了却是空的」，而 Meta 说这个数据集刚触发过：两句话互相矛盾，
 * 说明这次统计读到的是空响应（瞬时故障），不是「一条事件都没有」。当「没读到」处理（灰），不当红。
 */
function statsReadLooksEmpty(d: MetaDatasetFact | undefined, now: Date): boolean {
  if (!d || d.events_7d === null || Object.keys(d.events_7d).length > 0) return false
  return d.last_fired_at !== null && ageHours(d.last_fired_at, now) <= PIXEL_ALIVE_WINDOW_HOURS
}

function pixelState(d: MetaDatasetFact | undefined, now: Date): PixelState {
  if (!d || d.events_24h === null) return 'unknown'
  if (statsReadLooksEmpty(d, now)) return 'unknown'
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
  const unknown = ds.filter(d => !d || d.events_7d === null || statsReadLooksEmpty(d, input.now)).length
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
  const official = new Set(input.meta.account_dataset_ids)
  // 官方账户的数据集读到了，才有资格核对「每一页挂的是不是官方像素」
  const officialKnown = input.meta.read && official.size > 0
  const withoutOfficial: string[] = []
  const evidence: Record<string, EvidenceValue> = {
    probes: probes.length,
    official_pixel_checked: officialKnown,
    pages_without_official_pixel: withoutOfficial,
  }

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
    // 🔴 每一页都要自己挂着官方数据集的像素：不能拿「别的页面有官方像素」替这一页顶罪
    if (officialKnown && !p.pixel_ids.some(id => official.has(id))) withoutOfficial.push(p.label)
    if (p.pixel_ids.length === 0) {
      problems.push('页面里没找到 Meta 像素标记')
    } else if (officialKnown && !p.pixel_ids.some(id => official.has(id))) {
      problems.push('页面上的像素都不是官方广告账户的数据集')
    }
    if (problems.length > 0) bad.push(`${p.label}：${problems.join('、')}`)
  }

  if (bad.length > 0) {
    return receipt(key, 'red', bad.join('；'), '修好这些落地页再开投', evidence, as_of)
  }
  if (unknown.length > 0) {
    return receipt(key, 'gray', `没连上：${unknown.join('、')}`, '确认这些落地页能访问，再重跑一次探测', evidence, as_of)
  }
  if (!officialKnown) {
    return receipt(
      key, 'yellow',
      '落地页都能打开、UTM 保留、页面里有像素标记；但官方数据集没读到，没核对这些像素是不是官方的',
      '先让「数据集对齐」那道门读到官方数据集，再重跑一次检查',
      evidence, as_of,
    )
  }
  return receipt(key, 'green', '落地页都能打开、UTM 保留、每一页都挂着官方数据集的像素', '', evidence, as_of)
}

// ─── 7. 官网线索进 CRM ──────────────────────────────────────────────────────

/**
 * 一条线索的新鲜度：最近一条在 48 小时内（容 5 分钟时钟误差）才算「现在是通的」；读不出时间 / 在未来 / 太早都不算。
 * kind：fresh 新鲜；stale 太早（超过 48 小时，数据本身没问题）；unreadable 读不出时间；future 时间在未来（这两种是数据问题）。
 */
function crmFreshness(
  latest: string | null,
  now: Date,
): { fresh: boolean; kind: 'fresh' | 'stale' | 'unreadable' | 'future'; hours: number; problem: string } {
  const age = latest === null ? null : ageHours(latest, now)
  if (age !== null && Number.isFinite(age) && age >= -CRM_CLOCK_SKEW_HOURS && age <= CRM_FRESH_WINDOW_HOURS) {
    return { fresh: true, kind: 'fresh', hours: Math.max(0, Math.round(age)), problem: '' }
  }
  if (age === null || !Number.isFinite(age)) {
    return { fresh: false, kind: 'unreadable', hours: 0, problem: '读不出最近一条的时间' }
  }
  if (age < -CRM_CLOCK_SKEW_HOURS) {
    return { fresh: false, kind: 'future', hours: 0, problem: '最近一条的时间在未来（时钟偏差或脏数据）' }
  }
  const hours = Math.round(age)
  return { fresh: false, kind: 'stale', hours, problem: `最近一条是 ${hours} 小时前，超过 ${CRM_FRESH_WINDOW_HOURS} 小时` }
}

/**
 * 近 7 天有线索：只有最近一条在 48 小时内才判绿（设计稿的标准是「试跑线索 1 小时内进 CRM」，
 * 被动地看 48 小时是它的近似）。更早的、或读不出时间的，只能说「以前通过」，不能说「现在是通的」→ 黄。
 */
function judgeCrmFreshness(
  input: JudgeInput,
  evidence: Record<string, EvidenceValue>,
  as_of: string | null,
): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.lead_reaches_crm'
  const total = input.crm.web_form_touchpoints_7d
  const f = crmFreshness(input.crm.latest_web_form_at, input.now)
  if (f.fresh) {
    return receipt(key, 'green', `官网表单线索在进 CRM：最近一条是 ${f.hours} 小时前，近 7 天共 ${total} 条`, '', evidence, as_of)
  }
  return receipt(
    key, 'yellow',
    `近 7 天 CRM 里有 ${total} 条官网表单线索，但${f.problem}，没法确认现在还是通的`,
    '请人在官网提交一次试跑线索，确认 1 小时内进 CRM；进不来就检查官网表单入库',
    evidence, as_of,
  )
}

/** 怎么用一条内部测试把「广告落地页上的表单 → CRM」这条路验通（红灯、灰灯、过期黄灯共用）。 */
const AD_LANDING_TEST_HOW =
  '先看每小时同步回执里 formEnquiries 的识别 / 建档计数；再用非本公司邮箱在广告落地页（落地页配置里的页面）上提交一条内部测试表单，' +
  '下一轮每小时同步（目前是每小时 :10）后看 CRM 里是否出现来源为网站表单的联系人'

/**
 * 回执按广告落地页给线索分过类：官网表单线索必须有从广告落地页提交的，这道门才对「广告这条路」判绿。
 * 为什么：联系页（/contact）等其它表单的线索进得来，只证明了那些表单走得通——广告点进去的是另一页、另一个表单，
 * 它们的通知邮件格式 / 解析可能不一样，不能拿联系页的线索替广告落地页作证（否则是假绿）。
 *
 * 近 7 天一条来自广告落地页的线索都没有 → **灰**（没证据，不是黄）：这道门的意义就是证明「广告点进去那一页的表单真能进 CRM」，
 * 在没证据之前显示「前置条件满足」会误导开投决定——灰是硬门灰，会挡 preconditions_met，也会出今日待办（统筹 18 号 2026-10-20 定）。
 * 有证据但过期 / 读不出时间 / 在未来 → 仍是黄（以前通过，不能说现在通）。
 * 其中「过期」（数据没问题，只是 48 小时内没有新线索）的说法是「多半在等真实线索」，并教怎么分辨是不是通路坏了（74 号 2026-10-20 要求）；
 * 读不出时间 / 在未来是数据问题，仍按「没法确认」说。
 */
function judgeAdLandingFreshness(
  input: JudgeInput,
  evidence: Record<string, EvidenceValue>,
  as_of: string | null,
): TrackingGateReceipt {
  const key: PreflightGateKey = 'tracking.lead_reaches_crm'
  const total = input.crm.web_form_touchpoints_7d
  const adCount = input.crm.ad_landing_form_touchpoints_7d ?? 0
  if (adCount === 0) {
    return receipt(
      key, 'gray',
      `官网表单线索在进 CRM（近 7 天 ${total} 条），但没有一条是从广告落地页提交的——只验证了联系页等其它表单，广告落地页上的表单没有证据证明走得通`,
      AD_LANDING_TEST_HOW,
      evidence, as_of,
    )
  }
  const f = crmFreshness(input.crm.latest_ad_landing_form_at ?? null, input.now)
  if (f.fresh) {
    return receipt(
      key, 'green',
      `广告落地页上的表单线索在进 CRM：最近一条是 ${f.hours} 小时前，近 7 天共 ${adCount} 条（官网表单线索合计 ${total} 条）`,
      '', evidence, as_of,
    )
  }
  // 太早（数据没问题，只是 48 小时内没有新线索）：开投后多半只是还没有新的真实线索，不能一上来就说成故障
  if (f.kind === 'stale') {
    const events = input.config.ga4_lead_events.length > 0 ? input.config.ga4_lead_events.join(' / ') : '留资事件'
    return receipt(
      key, 'yellow',
      `近 7 天 CRM 里有 ${adCount} 条从广告落地页提交的表单线索，最近一条是 ${f.hours} 小时前（超过 ${CRM_FRESH_WINDOW_HOURS} 小时），现在没有新线索——多半是在等真实线索进来，也可能是通路坏了`,
      `不一定是故障。先看网站统计（GA4：${events}）近 ${CRM_FRESH_WINDOW_HOURS} 小时有没有人在广告落地页提交表单：没有 → 在等真实线索，不用处理；` +
        `有提交但 CRM 里没有新线索 → 通路坏了，按下面排查：${AD_LANDING_TEST_HOW}`,
      evidence, as_of,
    )
  }
  return receipt(
    key, 'yellow',
    `近 7 天 CRM 里有 ${adCount} 条从广告落地页提交的表单线索，但${f.problem}，没法确认现在还是通的`,
    AD_LANDING_TEST_HOW,
    evidence, as_of,
  )
}

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
  // 回执按广告落地页分过类（有路径、也有条数）才分；否则和以前一样，任何官网表单线索都算数
  const adPaths = input.crm.ad_landing_paths ?? []
  const classified = adPaths.length > 0 && typeof input.crm.ad_landing_form_touchpoints_7d === 'number'
  if (classified) {
    evidence.ad_landing_paths = [...adPaths]
    evidence.ad_landing_form_touchpoints_7d = input.crm.ad_landing_form_touchpoints_7d ?? 0
    evidence.latest_ad_landing_form_at = input.crm.latest_ad_landing_form_at ?? null
  }

  if (!input.crm.read) {
    return receipt(key, 'gray', 'CRM 没读到', '确认 CRM 能读到', evidence, as_of)
  }
  evidence.crm_fresh_window_hours = CRM_FRESH_WINDOW_HOURS
  if (input.crm.web_form_touchpoints_7d >= 1) {
    return classified ? judgeAdLandingFreshness(input, evidence, as_of) : judgeCrmFreshness(input, evidence, as_of)
  }
  if (leadSignal > 0) {
    return receipt(
      key, 'red',
      `网站近 7 天有 ${leadSignal} 个留资信号，但 CRM 里 0 条官网表单线索`,
      `官网表单线索进 CRM 靠每小时的邮件同步：${AD_LANDING_TEST_HOW}`,
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
  // 🔴 令牌「有效」必须被明确验证过（token_valid 为 true）才判绿：
  //    探活没跑成、或走到配置那一步就停了（token_valid 是 null）= 有效性未知，不能因为「没发现坏」就当好
  const preflight = input.env.capi_preflight
  if (preflight === null) {
    return receipt(key, 'yellow', '令牌有，但这次没验证有效性', '重跑一次转化 API 探活来验证令牌', evidence, as_of)
  }
  if (preflight.token_valid !== true) {
    return receipt(
      key, 'yellow',
      '令牌有，但转化 API 探活没走到验证令牌那一步，有效性没验证出来',
      '先把转化 API 的配置补齐再重跑探活；或确认 Meta 令牌能读该账户',
      evidence, as_of,
    )
  }
  return receipt(key, 'green', '令牌可用、定时任务都在期', '', evidence, as_of)
}

// ─── 10. 广告账户与付款 ─────────────────────────────────────────────────────

interface CapInfo {
  cents: number
  label: string
}

/** 库里设了的日预算上限（账户级、客户级各一个）。 */
function presentCaps(b: BudgetFacts): CapInfo[] {
  const caps: CapInfo[] = []
  if (b.account_cap_cents !== null) caps.push({ cents: b.account_cap_cents, label: '账户级' })
  if (b.client_cap_cents !== null) caps.push({ cents: b.client_cap_cents, label: '客户级' })
  return caps
}

/** 账户级、客户级是同一个数（老客户回落时必然如此）就合成一条说，别把同一句话说两遍。 */
function dedupeCaps(caps: readonly CapInfo[]): CapInfo[] {
  const [first, second] = caps
  if (caps.length === 2 && first.cents === second.cents) return [{ cents: first.cents, label: '账户级与客户级' }]
  return [...caps]
}

interface Finding {
  reason: string
  how: string
}

/**
 * 广告账户与付款 + 「现在在投的预算」在不在上限内。
 *
 * 🔴 上限读库、在投预算读线上（BudgetFacts）；客户配置里写死的「计划日预算 / 官方日上限」只用来跟库对一对，
 *    读不到时绝不能拿它顶替（2026-10-21 事故：写死 NZ$101 / NZ$110 互相比，库里上限 NZ$150、在投合计 NZ$134，假绿）。
 * 🔴 这道门是硬门：硬门的红、灰会挡住计划批准，黄不挡。所以「读不到 / 没设 / 算不全」一律出**灰**，不出黄
 *    （信封里这几种都是 unavailable）；黄只留给「读全了、算得对，但还有不放心的地方」。
 * 🔴 它只核对**现在已经在投**的预算，不含本次要新开的计划预算——文案里写明；计划自己的预算由「日预算不超上限」那道门核对。
 *
 * 红：账户不正常 / 没付款方式 / 在投合计超过库里任一上限 / 账户花费上限的剩余额度不够一天的在投预算。
 * 灰：账户或付款读不到；预算没读到（库 / Meta / 令牌 / 上限配置无效）；上限都没设；多账户下这个账户自己的上限没设；有终身预算折不出日预算。
 * 黄：读全了，但账户里一个在投的都没有（合计 0，没东西可核）、客户有多个登记账户而其它账户里还有开着的预算
 *     （或其它账户没读到：客户总上限是各账户加起来比的，这里没算；其它账户都没有开着的预算时不因此出黄）、
 *     客户配置里的数字跟库 / 线上对不上。
 * 绿：以上都没有。
 */
export function judgeAccountBilling(input: Pick<JudgeInput, 'config' | 'meta' | 'budget'>): TrackingGateReceipt {
  const key: PreflightGateKey = 'env.account_billing'
  const as_of = input.meta.as_of
  const acc = input.meta.account
  const cfg = input.config
  const b = input.budget
  const evidence: Record<string, EvidenceValue> = {
    account_status: acc ? acc.status : null,
    has_funding_source: acc ? acc.has_funding_source : null,
    budget_read: b.read,
    account_cap_cents: b.account_cap_cents,
    client_cap_cents: b.client_cap_cents,
    registered_account_count: b.registered_account_count,
    live_daily_budget_cents: b.live_daily_budget_cents,
    live_lifetime_budget_count: b.live_lifetime_budget_count,
    live_entity_count: b.live_entity_count,
    other_accounts_read: b.other_accounts !== null,
    other_accounts_count: b.other_accounts === null ? null : b.other_accounts.length,
    other_live_daily_budget_cents: b.other_accounts === null ? null : b.other_accounts.reduce((sum, o) => sum + o.live_daily_budget_cents, 0),
    other_accounts_error: b.other_accounts_error,
    config_planned_daily_budget_cents: cfg.planned_daily_budget_cents,
    config_official_daily_cap_cents: cfg.official_daily_cap_cents,
  }

  if (!input.meta.read || acc === null) {
    return receipt(key, 'gray', '广告账户信息没读到', '确认 Meta 令牌能读该账户', evidence, as_of)
  }

  const currency = acc.currency ?? cfg.currency
  const live = b.live_daily_budget_cents
  const caps = presentCaps(b)
  const multiAccount = (b.registered_account_count ?? 0) >= 2

  // ── 红 ──
  const problems: string[] = []
  if (acc.status !== 1) problems.push(`账户状态码 ${acc.status ?? '未知'}，不是正常状态`)
  if (typeof acc.disable_reason === 'number' && acc.disable_reason !== 0) {
    problems.push(`账户被停用（原因码 ${acc.disable_reason}）`)
  }
  if (acc.has_funding_source === false) problems.push('账户没有付款方式')
  // 以下两条都要先读到在投合计才能比；没读到的留给下面的灰灯，不在这里凭空判红
  if (live !== null && acc.spend_cap_minor !== null && acc.spend_cap_minor > 0 && acc.spend_cap_minor - (acc.amount_spent_minor ?? 0) < live) {
    problems.push('账户花费上限的剩余额度不够一天的在投日预算')
  }
  if (live !== null) {
    // 多账户时客户总上限是各账户加起来比的，这里只有一个账户的合计——但一个账户就已经超过客户总上限，那必然是超了
    for (const cap of dedupeCaps(caps)) {
      if (live > cap.cents) {
        problems.push(`在投日预算合计 ${money(live, currency)} 超过库里的${cap.label}日上限 ${money(cap.cents, currency)}`)
      }
    }
  }
  if (problems.length > 0) {
    return receipt(key, 'red', problems.join('；'), '修好账户 / 付款 / 预算再开投；超上限的先把在投预算降到上限内（或经 PM 同意调上限）', evidence, as_of)
  }

  // ── 灰：读不到 / 没设 / 算不全（硬门灰会挡批准，绝不当成绿）──
  if (acc.has_funding_source === null) {
    return receipt(key, 'gray', '有没有付款方式没读到', '确认 Meta 能读到付款方式', evidence, as_of)
  }
  if (!b.read || live === null) {
    return receipt(
      key, 'gray',
      `预算没读到：${b.error ?? '原因不明'}`,
      '先修好读取（Meta 令牌 / 库查询 / 上限配置）再重跑一次检查；没读到之前不能说「预算在上限内」',
      evidence, as_of,
    )
  }
  const gaps: Finding[] = []
  if (caps.length === 0) {
    gaps.push({ reason: '库里该账户和该客户的日预算上限都没设，没法核对在投预算在不在上限内', how: '在后台给该账户 / 客户设日预算上限' })
  } else if (b.account_cap_cents === null && multiAccount) {
    gaps.push({
      reason: `客户登记了 ${b.registered_account_count} 个广告账户，但这个账户自己的日预算上限没设（客户总上限顶替不了账户上限）`,
      how: '在后台给这个广告账户设它自己的日预算上限',
    })
  }
  if (b.live_lifetime_budget_count > 0) {
    gaps.push({
      reason: `有 ${b.live_lifetime_budget_count} 个在投的系列 / 广告组用的是终身预算，折不出日预算，上面的合计不全，没法核对`,
      how: '确认这些终身预算的花费节奏，或改成日预算再核对',
    })
  }
  if (gaps.length > 0) {
    return receipt(key, 'gray', gaps.map(f => f.reason).join('；'), gaps.map(f => f.how).join('；'), evidence, as_of)
  }

  // ── 黄：读全了、算得对，但还有不放心的地方（不挡批准）──
  // 其它登记账户：读库里的快照算出它们开着的预算（隐藏 ≠ 没预算）；没读到 / 币种对不上就回到「只核对这一个账户」
  const others =
    multiAccount && b.other_accounts !== null
      ? summarizeOtherAccounts({ registered: b.registered_account_count ?? 0, others: b.other_accounts, live, clientCap: b.client_cap_cents, currency, money })
      : ({ kind: 'cannot_sum' } as const)
  const notes: Finding[] = []
  if (b.live_entity_count === 0) {
    notes.push({
      reason: '账户里现在一个在投的系列 / 广告组都没有（在投日预算合计 0），这道门只核对已在投的预算，没东西可核；本次要新开的计划预算由「日预算不超上限」那道门核对',
      how: '确认账户里确实没有在投的广告；如果明明有在投的却看到这一条，说明读取有问题，找开发',
    })
  }
  if (multiAccount && others.kind === 'cannot_sum') {
    notes.push({
      reason: `客户登记了 ${b.registered_account_count} 个广告账户，这里只核对这一个账户；客户总上限是各账户加起来比的，这里没算`,
      how: '动预算时由内核信封核对客户总上限；批准前如需确认，人工看各账户合计',
    })
  } else if (multiAccount && others.kind === 'open') {
    notes.push({ reason: others.reason, how: others.how })
  }
  const dbCap = b.account_cap_cents ?? b.client_cap_cents
  if (cfg.official_daily_cap_cents !== null && dbCap !== null && cfg.official_daily_cap_cents !== dbCap) {
    notes.push({
      reason: `客户配置里写的官方日上限 ${money(cfg.official_daily_cap_cents, currency)} 跟库里的 ${money(dbCap, currency)} 对不上`,
      how: '以库为准：把客户配置里的数字改对，或直接删掉（上限已经读库，不需要在配置里再写一份）',
    })
  }
  if (cfg.planned_daily_budget_cents !== null && cfg.planned_daily_budget_cents !== live) {
    notes.push({
      reason: `客户配置里写的计划日预算 ${money(cfg.planned_daily_budget_cents, currency)} 跟 Meta 现读的在投合计 ${money(live, currency)} 对不上`,
      how: '以线上为准：把客户配置里的数字改对，或直接删掉（在投预算已经现读，不需要在配置里再写一份）',
    })
  }
  // 已核对的部分照实写：多账户时客户总上限是各账户加起来比的，这里只有一个账户，所以只声明「没超账户级上限」；
  // 其它账户都没有开着的预算时，这个账户的合计就是整个客户的合计，客户级上限也可以声明
  const claimedCaps = multiAccount && others.kind !== 'none_open' ? caps.filter(c => c.label === '账户级') : caps
  const capText = dedupeCaps(claimedCaps).map(c => `${c.label}日上限 ${money(c.cents, currency)}`).join('、')
  const otherText =
    multiAccount && others.kind === 'none_open'
      ? `；另有 ${others.accounts} 个登记账户${others.hidden > 0 ? `（其中 ${others.hidden} 个已在广告健康页隐藏）` : ''}里没有开着的预算，所以这里的合计就是整个客户的在投合计`
      : ''
  const verified = `账户正常、有付款方式；本账户现在在投的日预算合计 ${money(live, currency)}，没超库里的${capText}（不含本次要新开的计划预算）${otherText}`
  if (notes.length > 0) {
    return receipt(key, 'yellow', `${verified}；但：${notes.map(f => f.reason).join('；')}`, notes.map(f => f.how).join('；'), evidence, as_of)
  }
  return receipt(key, 'green', verified, '', evidence, as_of)
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

const POST_UNREAD_HOW =
  '先看上面写的原因：令牌失效或没配 → 换令牌；接口报错 → 查 Meta 状态后重试；' +
  '提示广告系列没配或格式不对 → 改 src/lib/ads-tracking-preflight/client-config.ts 里 launch_watch 的广告系列；' +
  '修好后用管理员触发入口手动补一次读回'

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
    // 这条灰灯会变成开发欠账（receipt.ts），所以「怎么办」要让开发照着做
    return receipt(key, 'gray', reason, POST_UNREAD_HOW, evidence, f.as_of)
  }
  if (f.spend_cents <= 0) {
    return receipt(key, 'gray', '还没开始花钱，没法判断', '等有花费后再读回', evidence, f.as_of)
  }
  if (f.link_clicks === 0) {
    const status: Light = phase === 'post_t1h' ? 'yellow' : 'red'
    return receipt(key, status, '花了钱但一次点击都没有', '检查广告是否在投、落地页是否可达', evidence, f.as_of)
  }
  // 🔴 点击太少，样本小到什么都看不出来：不能因为「没发现坏」就判绿
  if (f.link_clicks < MIN_POST_CLICKS_FOR_RATIO) {
    return receipt(
      key, 'yellow',
      `样本不足：点击只有 ${f.link_clicks} 次（不足 ${MIN_POST_CLICKS_FOR_RATIO} 次），还看不出落地页浏览和留资是否正常`,
      '过几个小时再看下一份读回；点击一直上不去就检查广告是否在正常投放',
      evidence, f.as_of,
    )
  }
  if (f.link_clicks >= MIN_POST_CLICKS_FOR_RATIO && f.landing_page_views === 0) {
    return receipt(key, 'red', `点击 ${f.link_clicks} 次但落地页浏览为 0`, '检查落地页是否可达、像素是否在加载', evidence, f.as_of)
  }
  if (f.link_clicks >= MIN_POST_CLICKS_FOR_RATIO && f.landing_page_views / f.link_clicks < MIN_POST_LPV_RATIO) {
    return receipt(key, 'yellow', `落地页浏览 / 点击 = ${(f.landing_page_views / f.link_clicks).toFixed(2)}，低于 ${MIN_POST_LPV_RATIO}`, '检查落地页加载速度与跳转', evidence, f.as_of)
  }
  if (phase === 'post_t24h' && f.leads === 0) {
    if (f.link_clicks >= MIN_POST_CLICKS_FOR_LEAD_CHECK) {
      return receipt(key, 'yellow', `点击 ${f.link_clicks} 次却一条留资都没有`, '检查表单与留资事件是否还在触发', evidence, f.as_of)
    }
    return receipt(
      key, 'yellow',
      `样本不足：点击 ${f.link_clicks} 次（不足 ${MIN_POST_CLICKS_FOR_LEAD_CHECK} 次），还看不出留资事件有没有在记`,
      '等点击累计到 50 次再看；或让人在官网提交一次试跑线索',
      evidence, f.as_of,
    )
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
