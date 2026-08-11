/**
 * Ad-level breakdown — 把「广告系列汇总」拆回它的每一条广告。
 *
 * 为什么要有这个文件（2026-08-04 真实事故）：
 *   看 Ads Manager 的广告组汇总，得出「三语广告便宜 2.6 倍」，并据此暂停了另一
 *   个广告组、挪走了预算。拆到每条广告才发现：那个组之所以便宜，是因为组里塞了
 *   一条**中文**广告（$5.60/咨询），两条真三语广告分别是 $9.93 和 $14.00，属中游。
 *   结论错了，而且已经按错结论动了钱。
 *
 *   ME 的 `ad_daily_insights` 里 `level='ad'` 的数据**一直都在**，56 行，每天在写。
 *   错误的根因不是没数据，是没有任何读侧按 parent 分组把子项摊开——所以人只能回
 *   Ads Manager 看那个会骗人的汇总。
 *
 * 这个模块只做一件事：**在汇总骗人的时候说出来**。
 *
 * 关于 parent_id 的一个事实（别再搞错）：
 *   `daily-insights.ts` 写 `level='ad'` 行时，`parent_id` 存的是**广告系列**
 *   (campaign)，不是广告组 (ad set)。ME 库里没有广告组这一层。所以本模块的
 *   「同一父级下的对比」= 同一广告系列下的对比。审这段代码的两个 agent 都把
 *   parent_id 误读成 ad set，实测数据证伪。
 *
 * 纯函数、不碰网络、不碰 DB —— 取数在调用方，这样规则本身可单测。
 */

/** 一行 `ad_daily_insights` 中 `level='ad'` 的记录，只取比较用得上的列。 */
export interface AdInsightRow {
  entityId: string
  entityName: string
  parentId: string | null
  spend: number
  /**
   * ⚠️ **这一列是两种单位相加**：`meta/client.ts:246` 写死
   * `results = leads + messaging_conversations`。
   * 所以它本身不是一个可比的量 —— 必须配合下面两列判断单位是否一致。
   */
  results: number
  impressions: number
  /** 表单留资数。给了才判得出单位；不给则退化成「单位未知」，不做倍数比较。 */
  leads?: number
  /** 私信对话数。同上。 */
  messagingConversations?: number
}

/** 一条广告的 results 到底装的是什么。 */
export type ResultUnit =
  /** 全是表单留资 */
  | 'form'
  /** 全是私信对话 */
  | 'conversation'
  /** 🔴 两种都有 —— 这条广告自己的单价就是拼出来的，不可比 */
  | 'mixed'
  /** 没有结果，无单位 */
  | 'none'
  /** 调用方没给拆分列，判不出来 */
  | 'unknown'

export const UNIT_LABEL: Readonly<Record<ResultUnit, string>> = {
  form:         '表单留资',
  conversation: '私信对话',
  mixed:        '表单+对话混合',
  none:         '无结果',
  unknown:      '单位未知',
}

function unitOf(r: Pick<AdInsightRow, 'leads' | 'messagingConversations'>): ResultUnit {
  if (r.leads === undefined || r.messagingConversations === undefined) return 'unknown'
  const hasForm = r.leads > 0
  const hasConv = r.messagingConversations > 0
  if (hasForm && hasConv) return 'mixed'
  if (hasForm) return 'form'
  if (hasConv) return 'conversation'
  return 'none'
}

/** 单条广告在其父级里的位置。 */
export interface AdBreakdownChild {
  entityId: string
  entityName: string
  spend: number
  results: number
  impressions: number
  /** 每个结果多少钱；results=0 时为 null（不是 Infinity，也不是 0）。 */
  costPerResult: number | null
  /** 这条广告吃掉了父级多少比例的钱（0–1）。用来识别「Meta 把钱全给了它」。 */
  spendShare: number
  /**
   * 结果数是否少到不配参与比较。
   *
   * 为什么要这个：Meta 在同一广告系列内会先预测谁会转化再分配展示——拿到 77 次
   * 展示的广告出 0 个结果是正常的，不是「输了」。把这种广告当成对照组会得出
   * 反向结论。
   */
  underpowered: boolean
  /** 这条广告的 results 装的是什么。判「能不能跟兄弟广告比单价」用。 */
  resultUnit: ResultUnit
}

export type BreakdownVerdict =
  /** 子项之间差异小，看汇总不会被骗。 */
  | 'uniform'
  /** 🔴 子项之间差异大 —— 汇总数字具有误导性，必须看子项。 */
  | 'divergent'
  /** 有效子项不足 2 条，无法判断汇总是否骗人。 */
  | 'insufficient'
  /** 🔴 子项的「结果」不是同一个单位（表单留资 vs 私信对话），单价不可比。 */
  | 'mixed_units'

export interface ParentBreakdown {
  parentId: string | null
  aggregate: {
    spend: number
    results: number
    costPerResult: number | null
    adCount: number
  }
  children: AdBreakdownChild[]
  verdict: BreakdownVerdict
  /**
   * 有效子项里最贵 ÷ 最便宜。verdict !== 'divergent' 时为 null。
   * 用倍数而不是绝对差，因为不同客户的单价量级差几十倍。
   */
  divergenceRatio: number | null
  /** 给人看的一句话。verdict='uniform' 时为 null。 */
  warning: string | null
}

/**
 * 参与比较的最低结果数。
 *
 * 定为 3 不是统计意义上的「够」——真要做显著性判定，本仓这种预算量级需要上万次
 * 展示（详见事故复盘）。3 只是「低于此值连方向都不该看」的地板：1 个结果的广告
 * 单价完全由那一次转化决定，噪音大于信号。
 *
 * 所以本模块**从不宣称谁赢了**，只宣称「这个汇总在掩盖差异，你得自己看」。
 */
export const MIN_RESULTS_FOR_COMPARISON = 3

/** 触发 divergent 的倍数门槛。低于此值当作正常波动。 */
export const DIVERGENCE_RATIO_THRESHOLD = 1.5

function costPerResult(spend: number, results: number): number | null {
  if (results <= 0) return null
  return spend / results
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * 按 parent 分组，算出每个父级的汇总 + 子项，并判断汇总是否具有误导性。
 *
 * 传入的 rows 可以跨多个 parent、跨多天；同一 entityId 的多天记录会先按天合并。
 */
export function breakdownByParent(rows: AdInsightRow[]): ParentBreakdown[] {
  const byParent = new Map<string, Map<string, AdInsightRow>>()

  for (const r of rows) {
    // parent 为空的行单独归一组，不能丢——丢了会让某些广告凭空消失，
    // 而「广告消失」正是本模块要防的那类静默错误。
    const pKey = r.parentId ?? '__no_parent__'
    let ads = byParent.get(pKey)
    if (!ads) {
      ads = new Map()
      byParent.set(pKey, ads)
    }
    const prev = ads.get(r.entityId)
    ads.set(r.entityId, prev
      ? {
          ...prev,
          spend:       prev.spend + r.spend,
          results:     prev.results + r.results,
          impressions: prev.impressions + r.impressions,
          // 两个拆分列也要累加，否则跨天合并后单位判定会只看最后一天。
          // undefined + number 会变 NaN，所以两边都没给才保持 undefined。
          leads: prev.leads === undefined && r.leads === undefined
            ? undefined : (prev.leads ?? 0) + (r.leads ?? 0),
          messagingConversations: prev.messagingConversations === undefined && r.messagingConversations === undefined
            ? undefined : (prev.messagingConversations ?? 0) + (r.messagingConversations ?? 0),
          // 名字取最后见到的：广告改名后历史行仍是旧名，用新名更好认。
          entityName:  r.entityName,
        }
      : { ...r })
  }

  const out: ParentBreakdown[] = []
  for (const [pKey, ads] of Array.from(byParent.entries())) {
    out.push(buildParent(pKey === '__no_parent__' ? null : pKey, Array.from(ads.values())))
  }

  // 花钱多的父级排前面——人先看到的应该是钱最多的那个。
  return out.sort((a, b) => b.aggregate.spend - a.aggregate.spend)
}

function buildParent(parentId: string | null, ads: AdInsightRow[]): ParentBreakdown {
  const spend   = ads.reduce((s, a) => s + a.spend, 0)
  const results = ads.reduce((s, a) => s + a.results, 0)

  const children: AdBreakdownChild[] = ads
    .map(a => ({
      entityId:      a.entityId,
      entityName:    a.entityName,
      spend:         round(a.spend),
      results:       a.results,
      impressions:   a.impressions,
      costPerResult: a.results > 0 ? round(a.spend / a.results) : null,
      spendShare:    spend > 0 ? round(a.spend / spend, 4) : 0,
      underpowered:  a.results < MIN_RESULTS_FOR_COMPARISON,
      resultUnit:    unitOf(a),
    }))
    .sort((a, b) => b.spend - a.spend)

  const comparable = children.filter(c => !c.underpowered && c.costPerResult !== null)
  const { verdict, ratio, warning } = judge(comparable)

  return {
    parentId,
    aggregate: {
      spend:         round(spend),
      results,
      costPerResult: costPerResult(spend, results) === null ? null : round(spend / results),
      adCount:       children.length,
    },
    children,
    verdict,
    divergenceRatio: ratio,
    warning,
  }
}

function judge(comparable: AdBreakdownChild[]): {
  verdict: BreakdownVerdict
  ratio: number | null
  warning: string | null
} {
  if (comparable.length < 2) {
    return {
      verdict: 'insufficient',
      ratio: null,
      warning: `有效广告不足 2 条（结果数 ≥${MIN_RESULTS_FOR_COMPARISON} 才算），无法判断这个汇总是否在掩盖差异 —— 别拿汇总数字下结论。`,
    }
  }

  // ── 单位一致性闸（2026-08-04 子牙抽查发现）──────────────────────────
  // `results = leads + messaging_conversations`（meta/client.ts:246）。所以
  // 「$10.29/结果」可能是 1 个表单 + 6 个对话拼出来的价格，跟纯对话的
  // 「$7.24/结果」根本不是同一个东西。拿它们比大小，就是本模块自己在犯
  // 它要防的那个错 —— 而这条比较**当天真的在页面上跑着**（Ad G · EN）。
  const units = new Set(comparable.map(c => c.resultUnit))
  const allUnknown = units.size === 1 && units.has('unknown')

  // 只在**确实混了**时拦：某条广告自己是表单+对话拼的，或者兄弟之间单位不同。
  //
  // 全部 unknown 不拦：调用方没给拆分列时，大家读的是同一列、同一种口径，
  // 拦下来只会让这个工具对所有旧调用方失效，而并没有多防住什么。
  // 但要在结论里说清「单位没验证过」—— 不能让人以为验过了。
  if (!allUnknown && (units.has('mixed') || units.size > 1)) {
    const detail = comparable
      .map(c => `${c.entityName}=${UNIT_LABEL[c.resultUnit]}`)
      .join('、')
    return {
      verdict: 'mixed_units',
      ratio: null,
      warning:
        `🔴 这些广告的「结果」不是同一个东西，单价不能比大小：${detail}。` +
        `（表单留资和私信对话被加在同一列里）先按目标分开看，再谈谁便宜。`,
    }
  }
  const unitCaveat = allUnknown
    ? '（⚠️ 没拿到留资/对话的拆分，单位是否一致未经验证）'
    : ''

  const costs = comparable.map(c => c.costPerResult as number)
  const best  = Math.min(...costs)
  const worst = Math.max(...costs)
  // best 一定 > 0：costPerResult 只在 results > 0 时非 null，spend 可能为 0 才会
  // 得到 0。spend=0 的广告没花钱，不该参与倍数比较。
  if (best <= 0) {
    return { verdict: 'insufficient', ratio: null, warning: '有效广告里存在零花费记录，倍数比较无意义。' }
  }

  const ratio = round(worst / best);
  if (ratio < DIVERGENCE_RATIO_THRESHOLD) {
    return { verdict: 'uniform', ratio: null, warning: null }
  }

  const cheapest  = comparable.find(c => c.costPerResult === best)!
  const dearest   = comparable.find(c => c.costPerResult === worst)!
  return {
    verdict: 'divergent',
    ratio,
    warning:
      `🔴 这个汇总在掩盖差异：内部最便宜「${cheapest.entityName}」$${cheapest.costPerResult}/结果，` +
      `最贵「${dearest.entityName}」$${dearest.costPerResult}/结果，差 ${ratio} 倍。` +
      `拿汇总数字下结论会把功劳记错广告 —— 必须看下面每一条。${unitCaveat}`,
  }
}
