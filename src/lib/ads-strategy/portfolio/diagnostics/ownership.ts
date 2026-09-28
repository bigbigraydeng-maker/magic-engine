/**
 * 广告组 / 系列归属：按名下广告的创意主页判「是不是这个客户的」。纯函数。
 * 设计：docs/specs/2026-09-27-ads-diagnostics-client-page-scope-design.md（子牙 + 魏征审）
 *
 * 🔴 登记表只登记给一个客户，不等于账户里只有这个客户的广告（2026-09-26 生产核实）。广告组/系列层诊断与机会
 *    （D1/D3/D4/D5/D7/D8/D9、O1/O2/O3）在建上下文之前先经 `scopeAccountToClient` 切成「只剩客户自己的」，
 *    否则别人的广告组会被当成这个客户的来判，D3 命中还会进自动暂停。
 * 🔴 拿不准一律不算客户的（fail-closed）：名下广告混着别的主页、读不到主页、有花费却找不到名下广告，都排除；
 *    一条广告在窗口里挂过的**每一个**主页都算（广告换过主页，前半段花的可能是别家的钱）。
 * 🔴 只留客户自己的（白名单）：日数据 / 小时数据里快照已经没有的广告组（被删掉的）也按名下广告判。
 * 🔴 广告层数据（adDaily / recentAds / adPageHistory）不切：广告级 D2/D10/D11 在未切的上下文上跑，
 *    它们自己逐条按创意主页过滤，且 D2/D10 用 adDaily 最早日期当「历史从哪天开始」。命中挂在被切的（混主页）广告组上时，
 *    run.ts 用 `flagDroppedAdsetUnits` 标明「组层数字含别家」。
 * 🔴 豁免：`meta/ai/live-rules.ts`（Magic Bridge 当场检查）不经这里——它只跑 D2/D10（逐条按主页过滤），
 *    把花费占 ≥60% 的主页当客户主页，没有主页过这条线就不跑。
 */

import type { EntitySnapshotRow } from '../snapshot'
import type { AccountInput, DailyRow, Diagnosis, ExcludedEntity, HourlyRow } from './types'
import { isDelivering, windowDays } from './context'
import { OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS } from './thresholds'

/**
 * 严格版主页 id 相等：两边各自规范化（NFKC、去零宽字符/空白、按非数字切段、去每段前导零）后，
 * 都必须只有一段数字，且这一段完全相等。
 *
 * 🔴 不能直接用 `page-binding.ts` 的 `pageIdMatches`——那是"stored 里任意一段等于 target 就算命中"，
 *    专给"重复绑定检查"设计（`stored` 可能是历史脏数据，宁可多认出一个重复也不能漏）。用在这里会开一个
 *    新口子：`clients.facebook_page_id` 万一被错误拼接进两段数字（如「111222-333444」），其中一段
 *    只要凑巧等于某条别家广告的主页 id，那条广告就会被判成 own（狄仁杰 2026-09-28：生产今天没有这种
 *    脏数据，但这是本 PR 新引入的、划分客户边界的核心比较，不能继承一个更松的匹配口径）。
 */
function strictPageIdEquals(a: string, b: string): boolean {
  const canon = (v: string) =>
    v.normalize('NFKC').replace(/[\s\p{Cf}]/gu, '').split(/\D+/).filter(run => run.length > 0).map(run => run.replace(/^0+/, ''))
  const ca = canon(a)
  const cb = canon(b)
  return ca.length === 1 && cb.length === 1 && ca[0] !== '' && ca[0] === cb[0]
}

export type AdsetOwnership = 'own' | 'other_page' | 'mixed_pages' | 'page_unknown'
type NotOwn = Exclude<AdsetOwnership, 'own'>
/** 名下没有算数的广告、也从没花过钱的广告组（刚建的空组）：不判、不列，也不连坐所在 CBO 系列 */
type Verdict = AdsetOwnership | 'empty'

/**
 * 一组「广告 × 它挂过的主页」按创意主页判归属。
 * 一条广告挂过几个主页就传几行（同一条广告换过主页 → 混着别的主页）。
 */
export function ownershipOfAds(ads: ReadonlyArray<{ creative_page_id: string | null }>, clientPageId: string): AdsetOwnership {
  if (ads.length === 0) return 'page_unknown'
  let own = false
  let other = false
  let unknown = false
  for (const ad of ads) {
    // `clients.facebook_page_id` 可能是老 SQL 手填的脏数据（全角数字、零宽字符、前导零），严格 ===
    // 会把客户自己的广告全判成别家（Codex 2026-09-27）；但不能直接借用绑定检查那套更松的匹配（见
    // strictPageIdEquals 顶部说明），这里要两边都规范成单段数字再比相等。
    if (!ad.creative_page_id) unknown = true
    else if (strictPageIdEquals(clientPageId, ad.creative_page_id)) own = true
    else other = true
  }
  if (own && other) return 'mixed_pages'
  if (unknown) return 'page_unknown'
  return own ? 'own' : 'other_page'
}

/** 广告 id → 所属广告组 + 窗口里挂过的主页（当前快照 ∪ 近 35 天出现过的 ∪ 近 35 天每一行的主页） */
interface AdPages {
  adsetId: string | null
  pages: Set<string | null>
  current: boolean
}

function collectAdPages(account: AccountInput): Map<string, AdPages> {
  const out = new Map<string, AdPages>()
  const add = (id: string, adsetId: string | null, page: string | null, current: boolean) => {
    const cur = out.get(id)
    if (cur) {
      cur.pages.add(page)
      cur.adsetId = cur.adsetId ?? adsetId
      cur.current = cur.current || current
    } else {
      out.set(id, { adsetId, pages: new Set([page]), current })
    }
  }
  for (const r of account.snapshots) if (r.level === 'ad') add(r.entity_id, r.adset_id, r.creative_page_id, true)
  for (const r of account.recentAds ?? []) add(r.entity_id, r.adset_id, r.creative_page_id, false)
  for (const r of account.adPageHistory ?? []) add(r.entity_id, r.adset_id, r.creative_page_id, false)
  return out
}

/**
 * 广告组 id → 名下算数的广告（每个挂过的主页一行）。已经不在的广告只有在广告层日数据里**见过、且每天都是零花费**
 * 才不算（删掉前一分钱没花的别家广告不该把客户的组判成混的）；没加载广告层日数据、或这条广告在广告层日数据里
 * 一行都没出现过，都算它可能花过钱（宁严）——广告层日数据同步允许写侧分页中断只写部分行（`syncAdDailyInsights`
 * 「page walk stopped early」），一条广告一行都没有 ≠ 它没花过钱，只代表读不到，不能当零花费处理（Codex 2026-09-27）。
 */
function adsByAdset(account: AccountInput): Map<string, Array<{ adId: string; creative_page_id: string | null }>> {
  const spent = account.adDaily ? new Set(account.adDaily.filter(r => r.spend > 0).map(r => r.entity_id)) : null
  const everSeen = account.adDaily ? new Set(account.adDaily.map(r => r.entity_id)) : null
  const provenZeroSpend = (adId: string) => !!spent && !!everSeen && everSeen.has(adId) && !spent.has(adId)
  const out = new Map<string, Array<{ adId: string; creative_page_id: string | null }>>()
  for (const [adId, ad] of Array.from(collectAdPages(account))) {
    if (!ad.adsetId) continue
    if (!ad.current && provenZeroSpend(adId)) continue
    const list = out.get(ad.adsetId) ?? []
    for (const page of Array.from(ad.pages)) list.push({ adId, creative_page_id: page })
    out.set(ad.adsetId, list)
  }
  return out
}

function spentInDays(daily: readonly DailyRow[], level: 'campaign' | 'adset', id: string, days: ReadonlySet<string> | null): number {
  return daily
    .filter(r => r.level === level && r.entity_id === id && (days === null || days.has(r.insight_date)))
    .reduce((s, r) => s + r.spend, 0)
}

function otherPages(ads: ReadonlyArray<{ creative_page_id: string | null }>, clientPageId: string): string {
  const pages = Array.from(new Set(ads.map(a => a.creative_page_id).filter((p): p is string => !!p && !strictPageIdEquals(clientPageId, p))))
  return pages.length === 0 ? '—' : pages.slice(0, 3).join('、')
}

function adsetDetail(verdict: NotOwn, pages: string): string {
  if (verdict === 'other_page') return `广告创意挂在别的 Facebook 主页（${pages}）上，不是这个客户登记的主页，不算这个客户的广告组`
  if (verdict === 'mixed_pages') return `同一个广告组里既有这个客户主页的广告，也有别的主页（${pages}）的广告（或同一条广告换过主页），花费分不开，整组不判`
  return '有花费，但读不到这个广告组名下广告挂在哪个 Facebook 主页，确认不了是不是这个客户的，不判'
}

interface Drop {
  level: 'campaign' | 'adset'
  id: string
  row: EntitySnapshotRow | null
  reason: NotOwn
  detail: string
  /** 广告组自己就不是客户的（不是靠 CBO 兄弟连坐）——只有这种才该说「这条广告组混着别家」（Codex 2026-09-27） */
  selfNotOwn: boolean
}

interface Judge {
  verdict: (adsetId: string) => Verdict
  pages: (adsetId: string) => string
}

/** 哪些系列 / 广告组不是这个客户的。CBO 系列只要有一个子组不是，整个系列连同子组都不判。 */
function findDrops(account: AccountInput, judge: Judge): Drop[] {
  const adsets = account.snapshots.filter(r => r.level === 'adset')
  const campaigns = account.snapshots.filter(r => r.level === 'campaign')
  const notOwn = (id: string): NotOwn => {
    const v = judge.verdict(id)
    return v === 'own' || v === 'empty' ? 'page_unknown' : v
  }
  const isBad = (id: string) => { const v = judge.verdict(id); return v !== 'own' && v !== 'empty' }
  const drops: Drop[] = []
  const handled = new Set<string>()
  for (const c of campaigns) {
    const children = adsets.filter(s => s.campaign_id === c.entity_id)
    const bad = children.filter(s => isBad(s.entity_id))
    if (bad.length === 0) continue
    if (c.budget_level === 'cbo') {
      const allBad = bad.length === children.filter(s => judge.verdict(s.entity_id) !== 'empty').length
      const reason: NotOwn = allBad ? notOwn(bad[0].entity_id) : 'mixed_pages'
      const detail = `系列统一分预算，名下有 ${bad.length} 个广告组不是这个客户主页的广告（${bad.map(s => judge.pages(s.entity_id)).join('、')}），整个系列不判`
      drops.push({ level: 'campaign', id: c.entity_id, row: c, reason, detail, selfNotOwn: true })
      for (const s of children) {
        // 组自己是不是不算客户的：跟系列层这次连坐的判定分开算，不然「组自己没问题、只是系列里有别的组混主页」
        // 会被误标成「这条广告组本身混着别家」（Codex 2026-09-27）
        drops.push({ level: 'adset', id: s.entity_id, row: s, reason, detail, selfNotOwn: isBad(s.entity_id) })
        handled.add(s.entity_id)
      }
    } else if (bad.length === children.length) {
      drops.push({ level: 'campaign', id: c.entity_id, row: c, reason: notOwn(bad[0].entity_id), detail: '名下广告组都不是这个客户主页的广告，不判', selfNotOwn: true })
    }
  }
  for (const s of adsets) {
    if (handled.has(s.entity_id) || !isBad(s.entity_id)) continue
    const v = notOwn(s.entity_id)
    drops.push({ level: 'adset', id: s.entity_id, row: s, reason: v, detail: adsetDetail(v, judge.pages(s.entity_id)), selfNotOwn: true })
  }
  // 日数据里有、快照里已经没有的广告组（被删掉的）：按名下广告判，不是客户的也要切
  const inSnapshots = new Set(adsets.map(s => s.entity_id))
  const orphanIds = new Set(account.daily.filter(r => r.level === 'adset' && !inSnapshots.has(r.entity_id)).map(r => r.entity_id))
  for (const id of Array.from(orphanIds)) {
    if (!isBad(id)) continue
    const v = notOwn(id)
    drops.push({ level: 'adset', id, row: null, reason: v, detail: `（已删除）${adsetDetail(v, judge.pages(id))}`, selfNotOwn: true })
  }
  return drops
}

export interface ScopedAccount {
  account: AccountInput
  /** 评估日在投、或近 7 天有花费、却不是这个客户的实体（暂停且没花钱的不列，免得日报天天一长串） */
  excluded: ExcludedEntity[]
  /**
   * 客户没登记主页、账户里却出现 ≥2 个不同创意主页 → 分不清哪些是客户的，跟共用账户一样只做账户级（子牙 2026-09-27）。
   * 此时 `account` 是原样的（账户级判断用整个账户）。
   */
  accountLevelOnly: boolean
  /** accountLevelOnly=true 时降级的原因：page_unknown=客户没登记主页/多主页；capture_stale=快照没抓全/太旧。跑广告级规则前必须先看这个（Codex 2026-09-27 第二轮）。 */
  accountLevelOnlyReason: 'page_unknown' | 'capture_stale' | null
  /**
   * 近 7 天：名下广告全挂客户主页的广告组花费（含因 CBO 连坐被切的）/ 名下广告全挂别的主页的广告组花费。
   * 「登记主页可能不对」提示用；混主页、读不到主页的不算进任何一边（子牙第二轮：CBO 连坐不能说成「全花在别家」）。
   */
  ownWindowSpend: number
  otherPageWindowSpend: number
  /** 被切掉的广告组 / 系列 id（全部，不只排除清单里列出的）——判「有没有被切」用 */
  droppedAdsetIds: ReadonlySet<string>
  /**
   * 被切掉的广告组里，广告组自己就不是客户的那些（不含只因 CBO 兄弟连坐才被切、自己其实是客户的）。
   * 给广告级规则的命中标「所在组混主页」只认这个集合（Codex 2026-09-27：CBO 连坐不能说成「这条广告组本身混主页」）。
   */
  selfNotOwnAdsetIds: ReadonlySet<string>
}

const round2 = (n: number) => Math.round(n * 100) / 100

function unscoped(account: AccountInput): ScopedAccount {
  return { account, excluded: [], accountLevelOnly: false, accountLevelOnlyReason: null, ownWindowSpend: 0, otherPageWindowSpend: 0, droppedAdsetIds: new Set(), selfNotOwnAdsetIds: new Set() }
}

function accountLevelOnlyResult(account: AccountInput, reason: 'page_unknown' | 'capture_stale', detail: string): ScopedAccount {
  return {
    account,
    accountLevelOnly: true,
    accountLevelOnlyReason: reason,
    ownWindowSpend: 0,
    otherPageWindowSpend: 0,
    droppedAdsetIds: new Set(),
    selfNotOwnAdsetIds: new Set(),
    excluded: [{ adAccountId: account.adAccountId, level: 'account', id: account.adAccountId, name: null, reason, detail }],
  }
}

/** 客户没登记主页：单一主页（或没广告）照原样跑，归属未核实；≥2 个主页 → 只做账户级。 */
function scopeWithoutClientPage(account: AccountInput): ScopedAccount {
  const pages = new Set<string>()
  for (const list of Array.from(adsByAdset(account).values())) {
    for (const a of list) if (a.creative_page_id) pages.add(a.creative_page_id)
  }
  if (pages.size < 2) return unscoped(account)
  return accountLevelOnlyResult(account, 'page_unknown',
    `客户没登记 Facebook 主页，这个账户里的广告挂在 ${pages.size} 个不同的主页上，分不清哪些是这个客户的，只做账户级诊断`)
}

/**
 * 广告层快照最近一轮是不是新鲜、抓全了——不新鲜就没法确认这一轮有没有新加进别家的广告，归属核实不到
 * （Codex 2026-09-27：`snapshot-sync.ts` 抓取不完整/过期时不写入部分结果，这里会继续用上一轮旧快照判 `own`）。
 * 跟自动暂停闸（`ads-d3-auto-pause.ts` `verifyAdsetOwnership`）同一把尺子：不早于 evaluatedAt 前
 * `OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS` 小时、且这一轮 `complete`。
 */
function adCaptureStale(account: AccountInput, evaluatedAt: string): boolean {
  const adCaptures = account.latestCaptures.filter(c => c.level === 'ad')
  // 🔴 Codex 2026-09-27 第二轮建议把「一条广告层抓取审计记录都没有」也当作 stale（老账户可能在审计表
  //    上线前就有广告级快照数据，之后再没抓过一轮）。评估过：snapshot-sync.ts 对同一轮同一层的快照写入
  //    和 ad_snapshot_captures 审计行是配对写的（本文件顶部、loader.ts 头注释都在依赖这个不变量），
  //    正常运作下不会出现「有 ad 级快照、却一条 ad 级审计行都没有」；且这条判据在诊断测试套件里会把大量
  //    没有显式设置 latestCaptures 的既有 fixture（gates.test.ts 除外，那些不设 clientPageId 不受影响；
  //    d11-audience-pool-starved.test.ts 等会受影响）误判成 accountLevelOnly，波及面和这条 P2 的实际
  //    可达性不成比例。保留「没有审计记录 → 不拦」，未采纳；已记 docs/ledger 后续事项，不在本 PR 展开。
  if (adCaptures.length === 0) return false
  const latest = adCaptures.reduce((a, b) => (a.captured_at > b.captured_at ? a : b))
  if (!latest.complete) return true
  const ageMs = Date.parse(evaluatedAt) - Date.parse(latest.captured_at)
  return !(Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS * 3_600_000)
}

/**
 * 把账户切成「只剩客户自己的」系列 / 广告组（快照、广告组/系列日数据、按小时花费）。幂等：切过的再切一次结果不变。
 * 不切：clientPageId 缺省（没加载）/ 共用账户（本来就只做账户级）；clientPageId 为 null 见 scopeWithoutClientPage；
 * 广告层快照最近一轮没抓全或太旧见 adCaptureStale——这两种都降级成只做账户级，不是「原样跑」。
 */
export function scopeAccountToClient(account: AccountInput, clientPageId: string | null | undefined, date: string, evaluatedAt: string): ScopedAccount {
  if (clientPageId === undefined || account.shared) return unscoped(account)
  if (clientPageId === null) return scopeWithoutClientPage(account)
  if (adCaptureStale(account, evaluatedAt)) {
    return accountLevelOnlyResult(account, 'capture_stale',
      '广告层快照最近一轮没抓全或太旧，这一轮有没有新加进别家的广告核实不到，只做账户级诊断')
  }

  const ads = adsByAdset(account)
  const everSpent = (id: string) => spentInDays(account.daily, 'adset', id, null) > 0
  const judge: Judge = {
    verdict: id => {
      const list = ads.get(id) ?? []
      if (list.length === 0 && !everSpent(id)) return 'empty'
      return ownershipOfAds(list, clientPageId)
    },
    pages: id => otherPages(ads.get(id) ?? [], clientPageId),
  }
  const drops = findDrops(account, judge)
  const dropCampaigns = new Set(drops.filter(d => d.level === 'campaign').map(d => d.id))
  const dropAdsets = new Set(drops.filter(d => d.level === 'adset').map(d => d.id))
  const keepAdset = (id: string | null): boolean => {
    if (!id || dropAdsets.has(id)) return false
    const v = judge.verdict(id)
    return v === 'own' || v === 'empty'
  }
  // 系列日数据（含 7 天去重频次）只在名下没有任何被切掉的广告组时才留：否则里面混着别人的花费和人群
  const tainted = new Set<string>(Array.from(dropCampaigns))
  for (const s of account.snapshots) if (s.level === 'adset' && s.campaign_id && dropAdsets.has(s.entity_id)) tainted.add(s.campaign_id)
  for (const r of account.daily) if (r.level === 'adset' && r.parent_id && !keepAdset(r.entity_id)) tainted.add(r.parent_id)

  const snapshots = account.snapshots.filter(r => {
    if (r.level === 'campaign') return !dropCampaigns.has(r.entity_id)
    if (r.level === 'adset') return keepAdset(r.entity_id)
    if (r.level === 'ad') return keepAdset(r.adset_id)
    return true
  })
  const daily = account.daily.filter(r => (r.level === 'adset' ? keepAdset(r.entity_id) : r.level === 'campaign' ? !tainted.has(r.entity_id) : true))
  // 小时数据只留名下广告全挂客户主页的组（狄仁杰两轮）：只在小时数据里出现的组、快照里还没广告的「空组」
  // 都可能是上一轮快照之后才塞进别家广告的，它们的小时花费不能算进客户的 D1
  const hourly: Record<string, HourlyRow[]> = {}
  for (const [day, rows] of Object.entries(account.hourly)) {
    hourly[day] = rows.filter(r => !!r.adset_id && !dropAdsets.has(r.adset_id) && judge.verdict(r.adset_id) === 'own')
  }

  const days = new Set(windowDays(date))
  const excluded = listExcluded(account, drops, days)
  const windowSpendWhere = (verdict: AdsetOwnership) => round2(account.daily
    .filter(r => r.level === 'adset' && days.has(r.insight_date) && judge.verdict(r.entity_id) === verdict)
    .reduce((s, r) => s + r.spend, 0))
  const selfNotOwnAdsetIds = new Set(drops.filter(d => d.level === 'adset' && d.selfNotOwn).map(d => d.id))
  return {
    account: { ...account, snapshots, daily, hourly }, excluded, accountLevelOnly: false, accountLevelOnlyReason: null,
    ownWindowSpend: windowSpendWhere('own'), otherPageWindowSpend: windowSpendWhere('other_page'),
    droppedAdsetIds: dropAdsets, selfNotOwnAdsetIds,
  }
}

/** 只列评估日在投、或近 7 天有花费的；CBO 整系列排除只列系列一条。 */
function listExcluded(account: AccountInput, drops: Drop[], days: ReadonlySet<string>): ExcludedEntity[] {
  const out: ExcludedEntity[] = []
  const listedCampaigns = new Set<string>()
  for (const d of drops) {
    if (d.level === 'campaign' && d.row?.budget_level !== 'cbo') continue
    if (d.level === 'adset' && d.row?.campaign_id && listedCampaigns.has(d.row.campaign_id)) continue
    const children = d.level === 'campaign' ? account.snapshots.filter(r => r.level === 'adset' && r.campaign_id === d.id) : []
    const matters = isDelivering(d.row) || spentInDays(account.daily, d.level, d.id, days) > 0
      || children.some(s => isDelivering(s) || spentInDays(account.daily, 'adset', s.entity_id, days) > 0)
    if (!matters) continue
    if (d.level === 'campaign') listedCampaigns.add(d.id)
    out.push({ adAccountId: account.adAccountId, level: d.level, id: d.id, name: d.row?.entity_name ?? null, reason: d.reason, detail: d.detail })
  }
  return out
}

/**
 * 近 7 天账户里的钱全花在不是客户主页的广告组上 → 登记的主页多半填错了或客户换了主页（魏征 2026-09-27）。
 * 不提示的话，客户所有广告组都会被静默切掉，日报只剩一串排除清单。
 */
export function diagnosePageMismatch(account: AccountInput, scoped: ScopedAccount, clientId: string, date: string): Diagnosis | null {
  // 广告层快照最近一轮没抓全/太旧时 scopeAccountToClient 已经把 accountLevelOnly 置 true（adCaptureStale），
  // 这里第一条判断已经覆盖「多半是没抓到广告才判不出主页，不是登记错了」（魏征第二轮 + Codex 2026-09-27 合并）
  if (scoped.accountLevelOnly || scoped.ownWindowSpend > 0 || scoped.otherPageWindowSpend <= 0) return null
  return {
    code: 'D7', status: 'hit', clientVisible: false,
    units: [{ level: 'account', id: account.adAccountId, name: null, adAccountId: account.adAccountId }],
    title: '这个账户近 7 天的花费全在别的 Facebook 主页的广告上：客户登记的主页可能不对',
    evidence: { window_end: date, own_spend: scoped.ownWindowSpend, other_page_spend: scoped.otherPageWindowSpend, excluded_units: scoped.excluded.length },
    sample: [{ label: '被排除的在投/有花费单位', value: scoped.excluded.length }],
    reasons: ['广告组层诊断只判挂客户登记主页的广告；登记错了，客户自己的广告组会全部被当成别人的'],
    manualTask: {
      what: `广告账户 ${account.adAccountId} 近 7 天花的钱全在别的 Facebook 主页的广告上，这个客户自己的广告组一个都没判。`,
      how: '先在广告后台看这些广告挂的是哪个主页：是这个客户的（换了主页或登记错了）就到客户设置页改登记主页；不是就确认这个账户是不是登记错了客户。',
      href: `https://app.magicengine.com.au/dashboard/clients/${encodeURIComponent(clientId)}/settings`,
    },
  }
}

/**
 * 广告级命中（D2/D10/D11 在未切的上下文上跑）挂在被切掉的广告组上时——组里混着别的主页——标明组层数字
 * （组花费、频次、受众池使用花费）含别家，只看广告自己的数（子牙第二轮：否则日报里同一个组既「没参与诊断」又被报）。
 */
export function flagDroppedAdsetUnits(diagnoses: Diagnosis[], scoped: ScopedAccount): Diagnosis[] {
  if (scoped.selfNotOwnAdsetIds.size === 0) return diagnoses
  return diagnoses.map(d => {
    // 只标广告组自己就不是客户的（selfNotOwnAdsetIds）；纯因 CBO 兄弟连坐被切、自己其实是客户的组不标——
    // 那条命中本身是干净的（Codex 2026-09-27）
    const hit = d.units.filter(u => u.level === 'adset' && scoped.selfNotOwnAdsetIds.has(u.id))
    if (hit.length === 0) return d
    return {
      ...d,
      evidence: { ...d.evidence, adset_mixed_pages: hit.map(u => u.id).join(',') },
      reasons: [...d.reasons, `所在广告组（${hit.map(u => u.name ?? u.id).join('、')}）混着别的 Facebook 主页的广告：组层数字（组花费、频次）含别家，只看这条广告自己的数`],
    }
  })
}
