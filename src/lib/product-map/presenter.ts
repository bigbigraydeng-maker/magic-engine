/**
 * ME2 Product Map 控制台的**塑形层**(PR3)——纯函数,零 IO、零 React。
 *
 * 存在理由:分组/统计/判定都是有语义的(「什么叫被卡住」「什么叫数据可信」),
 * 塞进 JSX 就只能靠人眼复核;放这里才能被测试和变异探针盯住。
 *
 * 🔴 依赖方向(子牙设计审 M1):本文件**不 import `@/lib/product-map-sync`** ——
 *    sync 层已经 import 本目录,反向引用就是目录成环。它只声明自己需要的
 *    输入端口(camelCase),DB 行形状(snake_case)由 page 层负责映射进来。
 *    本文件也**不从 product-map/index.ts 导出**,消费方直接从 './presenter' 引。
 *
 * 🔴 id 绝不出渲染层(板桥设计审 M8):组件 id 里带真实供应商名
 *    (dataforseo / publer / openai),而 CLAUDE.md 禁止 UI 出现真实供应商名。
 *    对外只给不可读的 `key`(index 派生),测试断言输出不含这些字样。
 */

import type {
  BusinessLane,
  ComponentDependency,
  ComponentType,
  DapeStage,
  Maturity,
  OperationalStatus,
  ProductMapComponent,
} from './types'
import { maturityRank } from './types'
import { DEPTH_EDGE_TYPES, layerByDepth } from './graph'
import type { ProductMapSnapshot } from './index'

// ---------------------------------------------------------------------------
// 输入端口(page 层负责把 DB 行映射成这些形状)
// ---------------------------------------------------------------------------

/** 载入结果轴:互斥且穷尽。与「数据健康」是两回事,不许混(子牙 M2)。 */
export const LOAD_OUTCOME = ['ok', 'not_provisioned', 'sync_error', 'never_synced'] as const
export type LoadOutcome = (typeof LOAD_OUTCOME)[number]

/** 数据健康轴。unknown = 同步开着但没有可判断的全量轮(如只跑过 targeted)。 */
export const CONSOLE_HEALTH = ['fresh', 'stale', 'partial', 'run_error', 'unknown'] as const
export type ConsoleHealth = (typeof CONSOLE_HEALTH)[number]

export interface SyncRunView {
  readonly status: 'ok' | 'partial' | 'error'
  /** full = 全量对账;targeted = webhook 单号刷新(不许冒充「刚全量核对过」)。 */
  readonly mode: 'full' | 'targeted'
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly errorMessage: string | null
  readonly failedItems: readonly string[]
  readonly truncations: readonly string[]
  readonly skippedStale: number
}

export interface UnclassifiedItemView {
  readonly kind: 'pr' | 'issue'
  readonly number: number
  readonly title: string
  readonly url: string
  readonly firstSeenAt: string
}

export interface PrFactView {
  readonly number: number
  readonly state: 'open' | 'merged' | 'closed'
  readonly isDraft: boolean
  readonly unresolvedThreads: number | null
  readonly title: string
}

export interface IssueFactView {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly title: string
}

export interface PresenterInput {
  readonly snapshot: ProductMapSnapshot
  readonly loadOutcome: LoadOutcome
  /** sync_error 时的错误摘要(page 层已截断,不带 stack)。 */
  readonly loadErrorSummary?: string
  readonly latestRun: SyncRunView | null
  /** 最近一次**全量**轮的开始时间(targeted 不算)。 */
  readonly lastFullRunAt: string | null
  readonly prFacts: readonly PrFactView[]
  readonly issueFacts: readonly IssueFactView[]
  readonly unclassified: readonly UnclassifiedItemView[]
  /** 快照里最旧一行的观测时间(鲜度取 min,不是 max)。 */
  readonly oldestObservedAt: string | null
  /** 判定 stale 用;测试注入。 */
  readonly now: Date
}

// ---------------------------------------------------------------------------
// 人话映射(单一真值源:组件不许自己造词)
// ---------------------------------------------------------------------------

/**
 * 建到哪一步 —— 不叫「成熟度」(中文里读作质量评价,不是进度)。
 * 🔴 M3 不能写「接上线了」:中文读作「已经上线」,和后半句「还没真跑」自相矛盾,
 *    对 legacy 件更是彻底反的(板桥二轮 2)。
 */
export const MATURITY_LABEL: Readonly<Record<Maturity, string>> = {
  M0_REGISTERED: '只登记了名字',
  M1_CONTRACT_FROZEN: '定好了怎么做',
  M2_IMPLEMENTED: '代码写完了',
  M3_INTEGRATED: '装上了,还没真用过',
  M4_PRODUCTION_VALIDATED: '真客户身上跑过',
  M5_OPERATING_AND_LEARNING: '在持续出结果',
}

/** legacy 件不显示 M 档 —— 它不参与「生产真跑过」的评分,显示档位必被误读。 */
export const LEGACY_MATURITY_LABEL = '老系统 · 已接进新体系'

/**
 * 药丸文字必须和统计卡的三堆用**同一套词**(板桥二轮 4):
 * 两套词并存 → PM 看到「建好了但没通电 8」却在行里找不出是哪 8 个。
 */
export const OPERATIONAL_LABEL: Readonly<Record<OperationalStatus, string>> = {
  operating_legacy: '在生产干活(老系统)',
  operating_me2: '在生产干活',
  not_operating: '没通电',
}

export const LANE_LABEL: Readonly<Record<BusinessLane, string>> = {
  shared: '几条线共用',
  geo: 'AI 可见度',
  seo: '搜索',
  social: '社媒',
  ads: '广告',
}

/**
 * 🔴 对外只说四大步(CLAUDE.md:发现-分析-处方-执行)。八小步是内部拆分,
 *    上屏前必须折叠去重 —— 否则一个组件能挂 5 个 chip,还多出 4 个 PM 词表里
 *    没有的词(板桥二轮建议 1)。
 */
export const STAGE_LABEL: Readonly<Record<DapeStage, string>> = {
  discovery: '发现',
  analysis: '分析',
  prescription: '处方',
  authorization: '执行',
  execution: '执行',
  verification: '执行',
  outcome: '执行',
  learning: '执行',
}

/** 折叠 + 去重 + 按四大步固定顺序。 */
export function foldStages(stages: readonly DapeStage[]): string[] {
  const order = ['发现', '分析', '处方', '执行']
  const seen = new Set(stages.map((s) => STAGE_LABEL[s]))
  return order.filter((o) => seen.has(o))
}

export const TYPE_LABEL: Readonly<Record<ComponentType, string>> = {
  platform: '地基',
  capability: '一门手艺',
  adapter: '插头',
  module: '诊断脑',
  playbook: '一条流水线',
  registry: '一本账',
  agent: '代跑的机器人',
}

/**
 * `ceilingReason` 是给 PR3 的,但原文是黑话 —— 在这里翻译(子牙 M5 + 板桥 M4)。
 *
 * 🔴 顺序即优先级,**legacy 判据必须排在通用判据前面**(板桥二轮 1):
 *    legacy 件的原文是「缺可审计的生产执行证据(legacy 件不进 ME2 M4)」,
 *    通用那条排前面就会先命中,于是天天在生产干活的老系统被写成
 *    「还没在真客户身上跑过一次」—— 药丸说在跑、详情说没跑,页面自己打架。
 *    全角括号也要匹配到(maturity.ts 用的是「（）」和「：」)。
 */
const CEILING_PHRASES: readonly (readonly [string, string])[] = [
  ['legacy 件不进 ME2 M4', '老系统不按新标准计分 —— 它在不在生产干活看左边那一列'],
  ['legacy 件', '还没认领任何代码'],
  ['缺 frozen_contract 证据', '还没定死怎么做'],
  ['缺 merged 的 implements PR', '交付它的代码还没合进主干'],
  ['缺 importer/caller/wiring 证据', '没有任何地方在调用它'],
  ['缺可审计的生产执行证据', '还没在真客户身上跑过一次'],
  ['缺 ≥2 条不同日的 recurring_outcome', '只出过一次结果,还谈不上「持续在跑」'],
  ['全部证据齐', '证据齐了'],
]

export function humaniseCeilingReason(reason: string): string {
  for (const [needle, human] of CEILING_PHRASES) {
    if (reason.includes(needle)) return human
  }
  return reason
}

// ---------------------------------------------------------------------------
// 输出模型
// ---------------------------------------------------------------------------

/** 三堆 —— 比六档梯子有用十倍(板桥 M2)。 */
export const RUN_BUCKET = ['operating', 'built_not_live', 'building'] as const
export type RunBucket = (typeof RUN_BUCKET)[number]

export const BUCKET_LABEL: Readonly<Record<RunBucket, string>> = {
  operating: '在生产干活',
  built_not_live: '建好了但没通电',
  building: '还在建',
}

export interface ComponentView {
  /** 不可读 key —— id 绝不外泄(供应商名)。 */
  readonly key: string
  readonly name: string
  readonly businessOutcome: string
  readonly description: string
  readonly laneLabel: string
  readonly typeLabel: string
  readonly stageLabels: readonly string[]
  readonly bucket: RunBucket
  readonly operationalLabel: string
  readonly maturityLabel: string
  readonly maturityCode: Maturity
  readonly declaredLabel: string
  readonly ceilingLabel: string
  readonly ceilingReasonHuman: string
  readonly isLegacy: boolean
  /** legacy 件的 pill 旁常驻说明,防「在跑却显示分低」被误读(板桥 M1)。 */
  readonly legacyNote?: string
  readonly blockers: readonly { kindLabel: string; summary: string; ref?: string }[]
  readonly blockedByUpstream: readonly string[]
  readonly isBlocked: boolean
  /** 证据未经机器核验(仅 M4+ 逐行标;整体说明放页面级,板桥 M3)。 */
  readonly evidenceUnverified: boolean
  /** 同步没覆盖到它引用的 PR —— 进度可能被低估(子牙 M3)。 */
  readonly coverageGapPrs: readonly number[]
  readonly upstream: readonly { name: string; typeLabel: string; note: string }[]
  readonly downstream: readonly { name: string; typeLabel: string; note: string }[]
  readonly linkedPrs: readonly { number: number; url: string; stateLabel: string; unresolvedThreads: number | null }[]
  readonly linkedIssues: readonly { number: number; url: string; stateLabel: string }[]
  readonly nextMilestone?: { targetLabel: string; unlockedBy: readonly string[] }
  /** 「谁在做」的人话(不上英文标识)。 */
  readonly ownerLabel: string
  /**
   * 真跑过的硬证据 —— M4 的唯一底气。不上屏 = 一个没有证据可看的 M4 声明,
   * 正是「声明了≠接上了」(板桥二轮 13)。这里也是全系统唯一的真实花费数字。
   */
  readonly productionEvidence: readonly { ref: string; note?: string; observedAt?: string }[]
}

export interface DecisionView {
  readonly componentName: string
  readonly kindLabel: string
  readonly decision: string
  readonly links: readonly { label: string; url: string }[]
  /** 复审线程未解决数(PO 不用再去 GitHub 数,子牙 S1)。 */
  readonly unresolvedThreads: number | null
  /** 为什么现在还轮不到你 —— 理由写错比藏起来更伤(板桥二轮 7)。 */
  readonly waitingReason?: string
}

export interface TrustView {
  readonly loadOutcome: LoadOutcome
  readonly health: ConsoleHealth
  /** 横幅第一行给**结论**,不是并列状态词(板桥 S7)。 */
  readonly verdict: string
  readonly detail: string
  readonly freshnessText: string
  readonly factsSourceLabel: string
  readonly coverageGapPrs: readonly number[]
  readonly registryErrors: readonly string[]
  readonly registryWarnings: readonly string[]
  /** 「没拉全的部分」具体是什么 —— 横幅说了「见下方」就必须有下方(铁律 3)。 */
  readonly syncIssues: readonly string[]
}

/**
 * 全局依赖图的一个节点。**只带 key,不带 id**(id 含供应商真名,板桥 M8)——
 * 所有显示值都从已建好的 ComponentView 投影,不重算(子牙 M4)。
 */
export interface GraphNodeView {
  readonly key: string
  readonly name: string
  readonly laneLabel: string
  readonly maturityLabel: string
  readonly bucket: RunBucket
  readonly isLegacy: boolean
  /** 分层深度:越小越靠左 / 越先做(别人要先靠它)。 */
  readonly depth: number
  /** 没有任何登记依赖(上游或下游)——「独立」还是「关系没登记」由 UI 显式说明,不默认无依赖(板桥 M8/诚实)。 */
  readonly isolated: boolean
}

/** 一条依赖边:`fromKey` 排在 `toKey` 之前(上游 → 下游 / 先 → 后)。端点走 key,不走 id(子牙 S1/S2)。 */
export interface GraphEdgeView {
  readonly fromKey: string
  readonly toKey: string
  readonly typeLabel: string
}

export interface GraphView {
  readonly nodes: readonly GraphNodeView[]
  readonly edges: readonly GraphEdgeView[]
}

/**
 * 检索目录的一条:一个 issue/PR + 它挂在哪些组件上(人话)。
 * 标题/状态是**动态事实**(来自同步快照),不写回登记册。组件用 name/businessOutcome,
 * 绝不上 id(板桥 M4)。componentNames 为空 = 还没挂到任何组件(孤儿),UI 据此诚实提示。
 */
export interface CatalogItemView {
  readonly kind: 'pr' | 'issue'
  readonly number: number
  readonly title: string
  readonly stateLabel: string
  readonly url: string
  readonly components: readonly { name: string; businessOutcome: string; laneLabel: string }[]
}

export interface ConsolePresentation {
  readonly trust: TrustView
  readonly buckets: Readonly<Record<RunBucket, number>>
  readonly totalComponents: number
  readonly lanes: readonly { laneLabel: string; components: readonly ComponentView[] }[]
  readonly components: readonly ComponentView[]
  readonly decisionsNow: readonly DecisionView[]
  readonly decisionsLater: readonly DecisionView[]
  readonly blocked: readonly ComponentView[]
  readonly unclassified: readonly UnclassifiedItemView[]
  /** 全局「谁垫着谁」依赖图(横轴=先后)。 */
  readonly graph: GraphView
  /** issue/PR 检索目录(标题来自同步,可能为空 = 同步未开通)。 */
  readonly catalog: readonly CatalogItemView[]
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

const REPO_URL = 'https://github.com/bigbigraydeng-maker/magic-engine'
const STALE_HOURS = 26

const BLOCKER_KIND_LABEL: Readonly<Record<string, string>> = {
  code: '代码没写完',
  data: '数据不到位',
  authorization: '等授权',
  security: '安全问题',
  provisioning: '生产没配好',
  external_platform: '卡在外部平台',
}

/** 「谁在做」—— 英文技术标识不上屏(板桥二轮 9)。 */
const OWNER_LABEL: Readonly<Record<string, string>> = {
  'claude-code': 'agent 自动做,不用你管',
  'build-control-room': '要你批了才开工',
  fde: 'FDE 手动做',
}

const DECISION_KIND_LABEL: Readonly<Record<string, string>> = {
  merge: '要不要合代码',
  migration_apply: '要不要建表',
  credential: '要不要配密钥',
  deploy: '要不要部署',
  enable: '要不要开通',
  scope: '要不要开工',
}

function bucketOf(c: ProductMapComponent, effective: Maturity): RunBucket {
  // 用**生效**成熟度,不用自报的 declared(子牙二轮 2):declared 是登记册可以吹的
  // 那一栏,用它分堆会跟行内显示的档位自相矛盾。
  if (c.operationalStatus !== 'not_operating') return 'operating'
  return maturityRank(effective) >= maturityRank('M2_IMPLEMENTED') ? 'built_not_live' : 'building'
}

/** 只算「过去了多久」;时间在未来一律当 0,不许 abs 成过去(板桥二轮 11)。 */
function hoursSince(now: Date, then: Date): number {
  return Math.max(0, (now.getTime() - then.getTime()) / 3_600_000)
}

/**
 * 🔴 按新西兰时区算日期(CLAUDE.md:目标市场 NZ,时区 NZST)。
 *    用 UTC 算的话,NZ 上午打开会看到「今天」而日历已经是明天 —— 直接误判鲜度。
 */
const NZ_TZ = 'Pacific/Auckland'

function nzDayNumber(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return Math.floor(new Date(`${parts}T00:00:00Z`).getTime() / 86_400_000)
}

function nzStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TZ,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d)
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 0)
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0)
  return `${month} 月 ${day} 日`
}

/** 「数据到 8 月 15 日(今天)」这种说法,不说「最旧一条是 X 小时前」。 */
function freshnessText(oldest: string | null, now: Date): string {
  if (!oldest) return '还没有同步过数据'
  const d = new Date(oldest)
  if (Number.isNaN(d.getTime())) return '同步时间不可读'
  // 24 小时内一律说「X 小时前」,不用日历日(子牙二轮 1):
  // NZ = UTC+12,UTC 正午已跨到 NZ 次日 —— 只按日历日算,「3 小时前刚同步」
  // 会被写成「昨天」,而 NZ 上午正是 PO 最常打开的时段。说反鲜度比不说更糟。
  const hours = hoursSince(now, d)
  if (hours < 1) return '数据是刚刚同步的'
  if (hours < 24) return `数据是 ${Math.floor(hours)} 小时前同步的`
  const days = Math.max(1, nzDayNumber(now) - nzDayNumber(d))
  const stamp = nzStamp(d)
  if (days === 1) return `数据到 ${stamp}(昨天)`
  return `数据停在 ${stamp},已经 ${days} 天没更新`
}

function computeHealth(input: PresenterInput): ConsoleHealth {
  if (input.loadOutcome !== 'ok') return 'unknown'
  const run = input.latestRun
  if (!run) return 'unknown'
  if (run.status === 'error') return 'run_error'
  if (run.status === 'partial') return 'partial'
  // 只有全量轮才能证明「刚核对过」;targeted 或从没跑过全量 → 不许冒充(子牙 M2)
  if (!input.lastFullRunAt) return 'unknown'
  return hoursSince(input.now, new Date(input.lastFullRunAt)) > STALE_HOURS ? 'stale' : 'fresh'
}

function trustVerdict(outcome: LoadOutcome, health: ConsoleHealth): { verdict: string; detail: string } {
  switch (outcome) {
    case 'not_provisioned':
      // 这一态可能长期存在 —— 用告警口吻,PM 看三次就免疫了(板桥二轮建议 12)
      return {
        verdict: '同步还没开通,这页显示的是代码仓库里的登记(每次改代码都会更新)',
        detail: 'GitHub 上的最新动静要等同步开通才有。agent 在办,不用你管。',
      }
    case 'sync_error':
      return {
        verdict: '同步出错了 —— 下面的状态可能是旧的,别照着它做合并决定',
        detail: '错误已记录,agent 会处理。',
      }
    case 'never_synced':
      return {
        verdict: '同步开通了但一次都没跑过 —— 这页只反映登记,不反映 GitHub 最新情况',
        detail: '等第一轮同步跑完就会有真实状态。',
      }
    default:
      break
  }
  switch (health) {
    case 'fresh':
      return { verdict: '可以照着这页做决定', detail: '最近一次全量核对是新鲜的。' }
    case 'partial':
      return {
        verdict: '这轮同步没拉全 —— 下面的代码状态可能是旧的,别照着它做合并决定',
        detail: '没拉全的部分列在下面。',
      }
    case 'run_error':
      return { verdict: '最近一轮同步失败了 —— 数据可能是旧的', detail: '失败原因列在下面。' }
    case 'stale':
      return { verdict: '数据有点旧了(超过一天没全量核对)', detail: '每日对账可能没跑成,agent 会查。' }
    default:
      return {
        verdict: '还没做过完整核对 —— 单条刷新过,但没有全量对账',
        detail: '全量对账每天跑一次;也可以让 agent 手动跑一次。',
      }
  }
}

const FACTS_SOURCE_LABEL: Readonly<Record<string, string>> = {
  manual_snapshot: '人工登记(未经程序核对)',
  github_sync: '程序从 GitHub 实时同步',
  mixed: '一部分程序同步、一部分人工登记',
}

/**
 * PR 状态 → 中文。**唯一真值源**:linkedPrs 和 catalog 都调它,禁止第二套人话(子牙 M3)。
 * 没抓到时按同步是否开通分「没同步到 / 未同步」——「不知道」不装成「不存在」。
 */
function prStateLabel(fact: PrFactView | undefined, syncActive: boolean): string {
  if (!fact) return syncActive ? '没同步到' : '未同步'
  if (fact.state === 'merged') return '已合并'
  if (fact.isDraft) return '草稿'
  return fact.state === 'open' ? '开着' : '已关闭'
}

/** Issue 状态 → 中文。「已关闭」必带「≠已上线」(子牙 M9)。同上,唯一真值源。 */
function issueStateLabel(fact: IssueFactView | undefined): string {
  return !fact ? '未同步' : fact.state === 'closed' ? '已关闭(≠已上线)' : '开着'
}

/** 依赖边类型 → 中文(图例用同一套词,不另造)。 */
const DEP_EDGE_LABEL: Readonly<Record<ComponentDependency['type'], string>> = {
  requires: '必须先有',
  consumes: '调用',
  implements: '实现',
  adapts: '适配',
  verifies: '验证',
  blocks: '卡住',
}

export function buildPresentation(input: PresenterInput): ConsolePresentation {
  const { snapshot } = input
  const prByNumber = new Map(input.prFacts.map((p) => [p.number, p]))
  const issueByNumber = new Map(input.issueFacts.map((i) => [i.number, i]))
  const nameById = new Map(snapshot.components.map((s) => [s.component.id, s.component.name]))
  const typeById = new Map(snapshot.components.map((s) => [s.component.id, s.component.componentType]))

  // coverageGap:登记册引用的 PR ∖ 同步到的(子牙 M3)。
  // 同步没覆盖到 ≠ 活儿没干完 —— 绝不把「不知道」显示成「不存在」。
  const syncActive = input.loadOutcome === 'ok' && input.prFacts.length > 0
  const allGapPrs: number[] = []

  const components: ComponentView[] = snapshot.components.map((snap, index) => {
    const c = snap.component
    const gapPrs = syncActive
      ? c.linkedPullRequests.filter((pr) => !prByNumber.has(pr.number)).map((pr) => pr.number)
      : []
    for (const n of gapPrs) if (!allGapPrs.includes(n)) allGapPrs.push(n)

    const blockedByUpstream = snap.inheritedBlockedBy.map((id) => nameById.get(id) ?? '(未知组件)')

    return {
      key: `c${index}`,
      name: c.name,
      businessOutcome: c.businessOutcome,
      description: c.description,
      laneLabel: LANE_LABEL[c.businessLane],
      typeLabel: TYPE_LABEL[c.componentType],
      stageLabels: foldStages(c.dapeStages),
      bucket: bucketOf(c, snap.maturity.effectiveMaturity),
      operationalLabel: OPERATIONAL_LABEL[c.operationalStatus],
      // legacy 件不显示 M 档 —— 显示档位必被读成「没干活」
      maturityLabel:
        c.origin === 'legacy'
          ? LEGACY_MATURITY_LABEL
          : MATURITY_LABEL[snap.maturity.effectiveMaturity],
      maturityCode: snap.maturity.effectiveMaturity,
      declaredLabel: MATURITY_LABEL[snap.maturity.declaredMaturity],
      ceilingLabel: MATURITY_LABEL[snap.maturity.evidenceCeiling],
      ceilingReasonHuman: humaniseCeilingReason(snap.maturity.ceilingReason),
      isLegacy: c.origin === 'legacy',
      legacyNote:
        c.origin === 'legacy'
          ? '老系统按「接进新体系的程度」计分,分低不代表没在干活'
          : undefined,
      blockers: c.currentBlockers.map((b) => ({
        kindLabel: BLOCKER_KIND_LABEL[b.kind] ?? b.kind,
        summary: b.summary,
        ref: b.ref,
      })),
      blockedByUpstream,
      isBlocked: c.currentBlockers.length > 0 || blockedByUpstream.length > 0,
      evidenceUnverified: snap.maturity.unverifiedCriticalEvidence,
      coverageGapPrs: gapPrs,
      // 🔴 blocks 边的方向:graph.ts 的口径是「上游 = 卡住我的人,下游 = 我卡住的人」。
      //    写反了因果关系就倒了(板桥二轮 12)。
      upstream: snap.neighbours.upstream.map((n) => ({
        name: nameById.get(n.id) ?? '(未知组件)',
        typeLabel: TYPE_LABEL[typeById.get(n.id) ?? 'platform'],
        note: n.type === 'blocks' ? '它卡着我' : '要先有它',
      })),
      downstream: snap.neighbours.downstream.map((n) => ({
        name: nameById.get(n.id) ?? '(未知组件)',
        typeLabel: TYPE_LABEL[typeById.get(n.id) ?? 'platform'],
        note: n.type === 'blocks' ? '我卡着它' : '它在等这件事',
      })),
      linkedPrs: c.linkedPullRequests.map((pr) => {
        const fact = prByNumber.get(pr.number)
        return {
          number: pr.number,
          url: `${REPO_URL}/pull/${pr.number}`,
          stateLabel: prStateLabel(fact, syncActive),
          unresolvedThreads: fact?.unresolvedThreads ?? null,
        }
      }),
      linkedIssues: c.linkedIssues.map((n) => {
        const fact = issueByNumber.get(n)
        return {
          number: n,
          url: `${REPO_URL}/issues/${n}`,
          // 🔴 「已关闭」旁必须提醒:Issue 关了 ≠ 生产完成(子牙 M9)——见 issueStateLabel
          stateLabel: issueStateLabel(fact),
        }
      }),
      nextMilestone: c.nextMilestone
        ? {
            targetLabel: MATURITY_LABEL[c.nextMilestone.target],
            unlockedBy: c.nextMilestone.unlockedBy.map(
              (bid) => c.currentBlockers.find((b) => b.id === bid)?.summary ?? bid,
            ),
          }
        : undefined,
      ownerLabel: OWNER_LABEL[c.ownerRole] ?? c.ownerRole,
      productionEvidence: c.productionEvidence.map((e) => ({
        ref: e.ref,
        note: e.note,
        observedAt: e.observedAt,
      })),
    }
  })

  const buckets: Record<RunBucket, number> = { operating: 0, built_not_live: 0, building: 0 }
  for (const v of components) buckets[v.bucket]++

  // 分组键用互斥的 businessLane —— 各组求和必须 == 总数(子牙 M10)
  const laneOrder: BusinessLane[] = ['shared', 'geo', 'seo', 'social', 'ads']
  const lanes = laneOrder
    .map((lane) => ({
      laneLabel: LANE_LABEL[lane],
      components: snapshot.components
        .map((s, i) => ({ s, view: components[i] }))
        .filter(({ s }) => s.component.businessLane === lane)
        .map(({ view }) => view),
    }))
    .filter((g) => g.components.length > 0)

  // 待拍板拆两栏:现在能回的 vs 条件没到的(板桥 M5)。
  //
  // 🔴 判据按决策类型分,不能一律看「上游有没有卡住」(板桥二轮 7):
  //    合代码(merge)只取决于这个 PR 自己准没准备好 —— 上游那件事没做完,
  //    不妨碍它合。一刀切会把唯一能立刻回的事藏起来,还告诉 PM「不用管」。
  const decisionsNow: DecisionView[] = []
  const decisionsLater: DecisionView[] = []
  snapshot.components.forEach((snap, i) => {
    const view = components[i]
    for (const d of snap.component.poDecisionRequired) {
      const prNumbers = snap.component.linkedPullRequests.map((p) => p.number)
      const prFactsForComponent = prNumbers
        .map((n) => prByNumber.get(n))
        .filter((f): f is PrFactView => f !== undefined)
      // 多 PR 组件求和,不取第一个(子牙二轮 8)
      const threadCounts = prFactsForComponent
        .map((f) => f.unresolvedThreads)
        .filter((t): t is number => typeof t === 'number')
      const threads = threadCounts.length > 0 ? threadCounts.reduce((a, b) => a + b, 0) : undefined

      let waitingReason: string | undefined
      if (d.kind === 'merge') {
        const blockingPr = prFactsForComponent.find(
          (f) => f.state === 'open' && (f.isDraft || (f.unresolvedThreads ?? 0) > 0),
        )
        if (blockingPr) {
          waitingReason = blockingPr.isDraft
            ? '这段代码还是草稿,写完了会来找你'
            : `复审还有 ${blockingPr.unresolvedThreads} 条没解决,清完了会来找你`
        }
      } else if (view.blockedByUpstream.length > 0) {
        waitingReason = `在等「${view.blockedByUpstream[0]}」先做完`
      }

      const entry: DecisionView = {
        componentName: view.name,
        kindLabel: DECISION_KIND_LABEL[d.kind] ?? d.kind,
        decision: d.decision,
        links: [
          ...prNumbers.map((n) => ({ label: `去看这段代码 #${n}`, url: `${REPO_URL}/pull/${n}` })),
          ...snap.component.linkedIssues.map((n) => ({
            label: `去看这件事 #${n}`,
            url: `${REPO_URL}/issues/${n}`,
          })),
        ],
        unresolvedThreads: threads ?? null,
        waitingReason,
      }
      if (waitingReason) decisionsLater.push(entry)
      else decisionsNow.push(entry)
    }
  })

  // 全局依赖图:节点从现成 ComponentView 投影(子牙 M4),边从 dependencies 权威单声明派生(子牙 S1)。
  const keyById = new Map(snapshot.components.map((s, i) => [s.component.id, `c${i}`]))
  const depthById = layerByDepth(snapshot.components.map((s) => s.component))
  const graphEdges: GraphEdgeView[] = []
  for (const s of snapshot.components) {
    const c = s.component
    const selfKey = keyById.get(c.id)
    if (!selfKey) continue
    for (const dep of c.dependencies) {
      const targetKey = keyById.get(dep.target)
      if (!targetKey) continue // 悬空依赖 validate 已拦,此处防御跳过
      // 🔴 只画 DEPTH_EDGE_TYPES 认可的边(与 layerByDepth 同一个真值源,魏征+子牙复审)——
      //    blocks/verifies 没有「先后」语义,硬画进这张「谁垫着谁」图会指反箭头,
      //    当场打脸图例「左边这件要先有」。它们属于「卡住」/「验证」,不是先后关系。
      if (!DEPTH_EDGE_TYPES.has(dep.type)) continue
      // target 排在 self 之前(先 → 后):`A requires/consumes/implements/adapts B` → B 更浅、在左。
      graphEdges.push({ fromKey: targetKey, toKey: selfKey, typeLabel: DEP_EDGE_LABEL[dep.type] })
    }
  }
  const touchedKeys = new Set<string>()
  for (const e of graphEdges) {
    touchedKeys.add(e.fromKey)
    touchedKeys.add(e.toKey)
  }
  const graphNodes: GraphNodeView[] = components.map((v, i) => ({
    key: v.key,
    name: v.name,
    laneLabel: v.laneLabel,
    maturityLabel: v.maturityLabel,
    bucket: v.bucket,
    isLegacy: v.isLegacy,
    depth: depthById.get(snapshot.components[i].component.id) ?? 0,
    isolated: !touchedKeys.has(v.key),
  }))
  const graph: GraphView = { nodes: graphNodes, edges: graphEdges }

  // 检索目录:issue/PR 事实(带标题) × 组件反查(人话名)。孤儿(components 空)也进,UI 据此诚实标注。
  type CompMeta = { name: string; businessOutcome: string; laneLabel: string }
  const compsByPr = new Map<number, CompMeta[]>()
  const compsByIssue = new Map<number, CompMeta[]>()
  for (const s of snapshot.components) {
    const c = s.component
    const meta: CompMeta = {
      name: c.name,
      businessOutcome: c.businessOutcome,
      laneLabel: LANE_LABEL[c.businessLane],
    }
    for (const pr of c.linkedPullRequests) {
      const list = compsByPr.get(pr.number) ?? []
      list.push(meta)
      compsByPr.set(pr.number, list)
    }
    for (const n of c.linkedIssues) {
      const list = compsByIssue.get(n) ?? []
      list.push(meta)
      compsByIssue.set(n, list)
    }
  }
  const catalog: CatalogItemView[] = [
    ...input.prFacts.map((f) => ({
      kind: 'pr' as const,
      number: f.number,
      title: f.title,
      stateLabel: prStateLabel(f, true),
      url: `${REPO_URL}/pull/${f.number}`,
      components: compsByPr.get(f.number) ?? [],
    })),
    ...input.issueFacts.map((f) => ({
      kind: 'issue' as const,
      number: f.number,
      title: f.title,
      stateLabel: issueStateLabel(f),
      url: `${REPO_URL}/issues/${f.number}`,
      components: compsByIssue.get(f.number) ?? [],
    })),
  ]

  const health = computeHealth(input)
  const { verdict, detail } = trustVerdict(input.loadOutcome, health)

  return {
    trust: {
      loadOutcome: input.loadOutcome,
      health,
      verdict,
      detail: input.loadErrorSummary ? `${detail}(${input.loadErrorSummary})` : detail,
      freshnessText: freshnessText(input.oldestObservedAt, input.now),
      factsSourceLabel: FACTS_SOURCE_LABEL[snapshot.factsSource] ?? snapshot.factsSource,
      coverageGapPrs: allGapPrs,
      registryErrors: snapshot.validation.errors.map((e) => e.message),
      registryWarnings: snapshot.validation.warnings.map((w) => w.message),
      syncIssues: [
        ...(input.latestRun?.failedItems ?? []),
        ...(input.latestRun?.truncations ?? []),
        ...(input.latestRun?.errorMessage ? [input.latestRun.errorMessage] : []),
      ],
    },
    buckets,
    totalComponents: components.length,
    lanes,
    components,
    decisionsNow,
    decisionsLater,
    blocked: components.filter((c) => c.isBlocked),
    unclassified: input.unclassified,
    graph,
    catalog,
  }
}

