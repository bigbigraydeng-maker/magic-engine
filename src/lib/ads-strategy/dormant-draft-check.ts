/**
 * 「暂停草稿待命期」每日只读核对 + 账户级兜底——建好暂停草稿后、PM 说「开」之前，每天确认：
 * 系列 / 广告组 / 广告三层**自身状态**都还是暂停，且花费为 0。纯函数，不联网、不写库。
 *
 * 这是**参考实现**：目前代码库里没有任何调用方，它**不是**自动闸门。真正的每日执行者是排程 CTS 日检任务，
 * 按日检手册第 7 项执行（它按手册步骤读回并判断，不调用本函数）。只有拿到实时证据且 `readOk` 为 true 时，
 * 才可能判 `ok`。
 *
 * 为什么看「自身状态」不看 `effective_status`：广告组/广告的 `effective_status` 会被上层暂停压成
 * `CAMPAIGN_PAUSED` / `ADSET_PAUSED`，掩盖「下层自己其实是 ACTIVE」——上层一打开，下层立刻开始花钱
 * （手册 §二十九，2026-09-26/27 两次实测：一开组，8 条自身 ACTIVE 的广告全部跟着投）。所以待命期要求
 * 三层自身状态都是 `PAUSED`，不是「看起来没在花钱」。
 *
 * 为什么花费证据要标来源：Meta 对零花费的日子不返回数据行，库里 `ad_daily_insights` 没有某天的行有两种
 * 可能——真没花钱，或取数断了（CTS 官方账户库里最新一天是 9/22，之后全无行）。所以库里的「没有花费行」
 * 只有在**最新日期已覆盖到需要的那天**时才算证据；否则只能判「没法证明」，需要拿 Meta 实时读回。
 *
 * 三态：`violation`（有东西不对，当场报）· `unverified`（读不全，不能说没事）· `ok`。违规压过没法证明。
 * 读不到一律不算通过。
 */

export type DormantLevel = 'campaign' | 'adset' | 'ad'

export interface DormantSnapshotRow {
  level: DormantLevel
  entity_id: string
  campaign_id: string | null
  /** 自身状态（不是 effective_status）。 */
  status: string | null
  effective_status: string | null
  captured_at: string
}

export interface DormantSpendRow {
  entity_id: string
  insight_date: string
  spend: number
}

export type DormantLayerEvidence =
  /** 刚从 Meta 实时读回的行。只有三层请求全部成功时 `readOk` 才可为 true。 */
  | { source: 'meta_live'; readOk: boolean; rows: readonly DormantSnapshotRow[] }
  /** 来自库里快照表的行。仅供参考：可能已约 30 小时旧，永远不能证明草稿仍是暂停。 */
  | { source: 'db_snapshot'; rows: readonly DormantSnapshotRow[] }

export type DormantSpendEvidence =
  /** Meta 实时读回：`throughDate` 之前（含）的逐日花费都已请求过。 */
  | { source: 'meta_live'; readOk: boolean; throughDate: string; rows: readonly DormantSpendRow[] }
  /** 库里的日花费表：零花费日没有行，所以必须带上库里最新有数据的日期。 */
  | { source: 'db_insights'; latestInsightDate: string | null; rows: readonly DormantSpendRow[] }

export type DormantVerdict = 'ok' | 'violation' | 'unverified'

export interface DormantCheckResult {
  verdict: DormantVerdict
  layers: Record<DormantLevel, { count: number; notPaused: string[] }>
  spendTotal: number
  /** 人话，进日检卡片。 */
  findings: string[]
}

const LEVELS: readonly DormantLevel[] = ['campaign', 'adset', 'ad']
const LEVEL_LABEL: Record<DormantLevel, string> = { campaign: '系列', adset: '广告组', ad: '广告' }

export function checkDormantDraft(args: {
  /** 这批草稿所属的广告系列 id（执行窗口建完后写进回执）。 */
  campaignIds: readonly string[]
  layers: DormantLayerEvidence
  spend: DormantSpendEvidence
  /** 只数这天及之后的花费（通常是建草稿那天）。YYYY-MM-DD。 */
  sinceDate: string
  /** 要证明「到这天为止花费都是 0」。YYYY-MM-DD，用广告账户时区的昨天。 */
  requiredThroughDate: string
  now: Date
  /** 快照最大允许年龄（小时），默认 30（日快照 + 余量）。只用于 db_snapshot。 */
  maxSnapshotAgeHours?: number
}): DormantCheckResult {
  const violations: string[] = []
  const unverified: string[] = []
  const layers: DormantCheckResult['layers'] = {
    campaign: { count: 0, notPaused: [] },
    adset: { count: 0, notPaused: [] },
    ad: { count: 0, notPaused: [] },
  }

  const ids = new Set(args.campaignIds)
  if (ids.size === 0) {
    return { verdict: 'unverified', layers, spendTotal: 0, findings: ['没有给出要核对的系列编号，没法核对'] }
  }

  // 每个实体只留最新一条
  const latest = new Map<string, DormantSnapshotRow>()
  for (const r of args.layers.rows) {
    const belongs = r.level === 'campaign' ? ids.has(r.entity_id) : r.campaign_id !== null && ids.has(r.campaign_id)
    if (!belongs) continue
    const key = `${r.level}:${r.entity_id}`
    const cur = latest.get(key)
    if (!cur || Date.parse(r.captured_at) > Date.parse(cur.captured_at)) latest.set(key, r)
  }

  let newest = -Infinity
  for (const r of latest.values()) {
    newest = Math.max(newest, Date.parse(r.captured_at))
    const layer = layers[r.level]
    layer.count += 1
    if (r.status === null) {
      unverified.push(`${LEVEL_LABEL[r.level]} ${r.entity_id} 的自身状态读不到`)
    } else if (r.status.toUpperCase() !== 'PAUSED') {
      layer.notPaused.push(r.entity_id)
      violations.push(`${LEVEL_LABEL[r.level]} ${r.entity_id} 自身状态是 ${r.status}，不是暂停`)
    }
  }
  for (const level of LEVELS) {
    if (layers[level].count === 0) unverified.push(`没读到${LEVEL_LABEL[level]}这一层的快照（刚建好还没被抓取，或抓取失败）`)
  }

  if (args.layers.source === 'meta_live') {
    if (!args.layers.readOk) {
      unverified.push('Meta 实时读回没有全部成功，不能证明三层仍是暂停')
    }
  } else {
    unverified.push('三层状态来自库里快照（可能是约 1 天前的），只能当参考，不能证明现在仍是暂停；需要 Meta 实时读回')
    const maxAgeMs = (args.maxSnapshotAgeHours ?? 30) * 3_600_000
    if (Number.isFinite(newest) && args.now.getTime() - newest > maxAgeMs) {
      unverified.push('快照已过期，不能证明现在仍是暂停；先重抓或直接读 Meta')
    }
  }

  const spendTotal = args.spend.rows
    .filter((r) => r.insight_date >= args.sinceDate)
    .reduce((s, r) => s + (Number.isFinite(r.spend) ? r.spend : 0), 0)
  if (spendTotal > 0) {
    violations.push(`自 ${args.sinceDate} 起已有花费 ${spendTotal.toFixed(2)}，草稿不该花钱`)
  } else if (args.spend.source === 'meta_live') {
    if (!args.spend.readOk) {
      unverified.push('Meta 花费读回没有成功，不能证明花费为 0')
    } else if (args.spend.throughDate < args.requiredThroughDate) {
      unverified.push(`Meta 读回只覆盖到 ${args.spend.throughDate}，早于需要的 ${args.requiredThroughDate}，不能证明花费为 0`)
    }
  } else {
    const through = args.spend.latestInsightDate
    if (through === null || through < args.requiredThroughDate) {
      unverified.push(
        `库里日花费最新只到 ${through ?? '无数据'}，早于需要的 ${args.requiredThroughDate}；零花费日 Meta 不返回行，不能据此证明花费为 0，需要 Meta 实时读回`,
      )
    }
  }

  const verdict: DormantVerdict = violations.length > 0 ? 'violation' : unverified.length > 0 ? 'unverified' : 'ok'
  return { verdict, layers, spendTotal, findings: [...violations, ...unverified] }
}

export interface AccountBackstopRow {
  level: DormantLevel
  entity_id: string
  campaign_id: string | null
  /** 自身状态（不是 effective_status）。 */
  status: string | null
}

export interface AccountBackstopSpendRow {
  entity_id: string
  campaign_id: string | null
  insight_date: string
  spend: number
}

export interface AccountBackstopResult {
  verdict: DormantVerdict
  /** 自身状态为 ACTIVE 且未被覆盖的广告组 / 广告 id（不含系列） */
  unauthorizedActive: string[]
  /** 未被授权清单 / 已知清单 / 回执覆盖的暂停系列 id */
  unaccountedPausedCampaigns: string[]
  spendTotalUncovered: number
  findings: string[]
}

export function checkAccountBackstop(args: {
  /** 账户里全部系列 / 广告组 / 广告行，从 Meta 实时读回。 */
  rows: readonly AccountBackstopRow[]
  rowsReadOk: boolean
  /** PM 明确打开过的系列。 */
  authorizedCampaignIds: readonly string[]
  /** PM 已确认无害的遗留实体（任意层级）。若某实体的 campaign_id 在此清单里，也算被覆盖。 */
  knownExceptionIds: readonly string[]
  /** 建草稿回执里的草稿系列 id。null = 回执读不到。 */
  receiptCampaignIds: readonly string[] | null
  spend: { readOk: boolean; throughDate: string; rows: readonly AccountBackstopSpendRow[] }
  sinceDate: string
  requiredThroughDate: string
}): AccountBackstopResult {
  const violations: string[] = []
  const unverified: string[] = []
  const unauthorizedActive: string[] = []
  const unaccountedPausedCampaigns: string[] = []

  const authorized = new Set(args.authorizedCampaignIds)
  const known = new Set(args.knownExceptionIds)
  const receipt = new Set(args.receiptCampaignIds ?? [])

  const isCovered = (entityId: string, campaignId: string | null): boolean =>
    authorized.has(entityId) ||
    (campaignId !== null && authorized.has(campaignId)) ||
    known.has(entityId) ||
    (campaignId !== null && known.has(campaignId))

  if (!args.rowsReadOk) {
    unverified.push('官方账户读回没有全部成功，不能证明账户里没有被打开的东西')
  }

  for (const r of args.rows) {
    if (r.status === null) {
      unverified.push(`${LEVEL_LABEL[r.level]} ${r.entity_id} 的自身状态读不到`)
      continue
    }
    const status = r.status.toUpperCase()
    if (r.level !== 'campaign' && status === 'ACTIVE' && !isCovered(r.entity_id, r.campaign_id)) {
      unauthorizedActive.push(r.entity_id)
      violations.push(`${LEVEL_LABEL[r.level]} ${r.entity_id} 自身状态是 ACTIVE，不在 PM 授权清单里`)
    }
  }

  let spendTotalUncovered = 0
  for (const s of args.spend.rows) {
    if (s.insight_date < args.sinceDate) continue
    if (!Number.isFinite(s.spend) || s.spend <= 0) continue
    if (isCovered(s.entity_id, s.campaign_id)) continue
    spendTotalUncovered += s.spend
  }
  if (spendTotalUncovered > 0) {
    violations.push(`不在授权清单里的实体有花费 ${spendTotalUncovered.toFixed(2)}`)
  }

  if (!args.spend.readOk) {
    unverified.push('Meta 花费读回没有成功，不能证明花费为 0')
  } else if (args.spend.throughDate < args.requiredThroughDate) {
    unverified.push(`Meta 读回只覆盖到 ${args.spend.throughDate}，早于需要的 ${args.requiredThroughDate}，不能证明花费为 0`)
  }

  for (const r of args.rows) {
    if (r.level !== 'campaign') continue
    if (r.status === null) continue
    if (r.status.toUpperCase() !== 'PAUSED') continue
    if (isCovered(r.entity_id, r.campaign_id)) continue
    if (receipt.has(r.entity_id)) continue
    unaccountedPausedCampaigns.push(r.entity_id)
  }
  if (unaccountedPausedCampaigns.length > 0) {
    const suffix = args.receiptCampaignIds === null ? ' （草稿回执读不到）' : ''
    unverified.push(
      `账户里有 ${unaccountedPausedCampaigns.length} 个暂停系列既不在回执里也不在已知清单里，没法证明它们是不是草稿${suffix}`,
    )
  }

  const verdict: DormantVerdict = violations.length > 0 ? 'violation' : unverified.length > 0 ? 'unverified' : 'ok'
  return { verdict, unauthorizedActive, unaccountedPausedCampaigns, spendTotalUncovered, findings: [...violations, ...unverified] }
}
