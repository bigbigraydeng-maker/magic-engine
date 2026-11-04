/**
 * 多个广告组的草稿建完之后，回头核一遍「建出来的，是不是我们要建的」。
 *
 * ── 跟 `launch-readback.checkLaunch` 分工 ────────────────────────────────
 * `checkLaunch` 逐个广告组查「已知的坑」（受众被放宽、多语言混放……），它不知道我们
 * **想要**什么。多组草稿多出来的几件事只有这里查：
 *   1. 系列和每个组、每条广告都真的是暂停的（创建时传了 PAUSED ≠ 回读到是 PAUSED）；
 *   2. 每个组的日预算、结束时间、年龄、国家和草稿写的一致（预算设在系列上还是组上，
 *      差一个字段，钱就不是想要的那样花）；
 *   3. 每个组的广告条数对得上，挂的表单对得上；
 *   4. 系列花费上限（`spend_cap`）真的落到了 Meta 上 —— 只写在草稿里不算数。
 * 任何一项读不到都算没过（读不到 ≠ 没问题）；唯一的例外是表单编号：Meta 不一定回显，
 * 读不到只给提醒，读到了但对不上才是拦。
 *
 * 判断是纯函数，不联网；取数在 `fetchMultiReadback`。
 */

import type { AdDraft } from './ad-draft'
import { adSetViews } from './ad-draft'
import type { LaunchFinding, LaunchReadbackReport } from './launch-readback'
import type { RawMetaAdCreative, RawMetaAdSet } from './meta-readback-adapter'
import type { PublishedDraft } from '@/lib/meta/ad-publisher'
import { fetchAdCreativesReadback, fetchAdSetReadback, fetchCampaignReadback } from '@/lib/meta/readback'

const DAY_MS = 86_400_000
const LEARNED = '2026-11-05 多广告组起草：创建时传了什么 ≠ 回读到什么，每一组都要单独对'

export interface SetReadback {
  /** 这一组的单组草稿视图（`adSetViews`）。 */
  view: AdDraft
  adSetId: string
  adSet: RawMetaAdSet
  ads: RawMetaAdCreative[]
}

export interface MultiReadback {
  campaign: { status: string | null; spendCap: string | null }
  sets: SetReadback[]
}

/**
 * 回读系列和每个广告组（含各组的广告）。任何一步读不到返回 null（= 查不出来，不是没问题）。
 * 草稿里有几个组、建出来就该有几个组编号，对不上也返回 null。
 */
export async function fetchMultiReadback(
  draft: AdDraft,
  published: Pick<PublishedDraft, 'campaignId' | 'adSetIds'>,
  accessToken: string,
): Promise<MultiReadback | null> {
  const views = adSetViews(draft)
  if (published.adSetIds.length !== views.length) return null
  const [campaign, sets] = await Promise.all([
    fetchCampaignReadback(published.campaignId, accessToken),
    Promise.all(views.map((view, i) => readOneSet(view, published.adSetIds[i], accessToken))),
  ])
  if (!campaign || sets.some((s) => s === null)) return null
  return { campaign, sets: sets as SetReadback[] }
}

async function readOneSet(view: AdDraft, adSetId: string, accessToken: string): Promise<SetReadback | null> {
  const [adSet, ads] = await Promise.all([
    fetchAdSetReadback(adSetId, accessToken),
    fetchAdCreativesReadback(adSetId, accessToken),
  ])
  return adSet && ads ? { view, adSetId, adSet, ads } : null
}

const blocker = (code: string, message: string): LaunchFinding => ({
  code, severity: 'blocker', message, learnedFrom: LEARNED,
})

const isPaused = (s: unknown): boolean => typeof s === 'string' && s.trim().toUpperCase() === 'PAUSED'
const show = (s: unknown): string => (typeof s === 'string' && s.trim() ? s.trim() : '读不到')

function campaignFindings(draft: AdDraft, rb: MultiReadback): LaunchFinding[] {
  const out: LaunchFinding[] = []
  if (!isPaused(rb.campaign.status)) {
    out.push(blocker('not_paused', `广告系列应该是暂停的，回读到「${show(rb.campaign.status)}」。读不到也算没确认。`))
  }
  const want = draft.campaignSpendCapMinor
  if (want !== undefined && Number(rb.campaign.spendCap) !== want) {
    out.push(blocker(
      'spend_cap_mismatch',
      `系列花费上限应是 ${want}（最小货币单位），回读到「${show(rb.campaign.spendCap)}」。上限没落到 Meta 上，就不算设上了。`,
    ))
  }
  return out
}

function setStateFindings(sb: SetReadback, nowMs: number): LaunchFinding[] {
  const out: LaunchFinding[] = []
  const { view, adSet } = sb
  if (!isPaused(adSet.status)) {
    out.push(blocker('not_paused', `广告组「${view.adSetName}」应该是暂停的，回读到「${show(adSet.status)}」。`))
  }
  const wantBudget = Math.round(view.dailyBudget * 100)
  const gotBudget = Number(adSet.daily_budget)
  if (!Number.isFinite(gotBudget) || gotBudget !== wantBudget) {
    out.push(blocker(
      'adset_budget_mismatch',
      `广告组「${view.adSetName}」的日预算应是 ${wantBudget}（最小货币单位），回读到「${show(adSet.daily_budget)}」。预算没设在这个组上，或者数不对。`,
    ))
  }
  const end = Date.parse(typeof adSet.end_time === 'string' ? adSet.end_time : '')
  const wantEnd = nowMs + view.durationDays * DAY_MS
  if (!Number.isFinite(end) || Math.abs(end - wantEnd) > DAY_MS) {
    out.push(blocker(
      'adset_end_time_mismatch',
      `广告组「${view.adSetName}」的结束时间应在约 ${view.durationDays} 天后，回读到「${show(adSet.end_time)}」。没有终点的广告没人会记得关。`,
    ))
  }
  return out
}

function setTargetingFindings(sb: SetReadback): LaunchFinding[] {
  const { view, adSet } = sb
  const t = adSet.targeting
  const problems: string[] = []
  if (Number(t?.age_min) !== (view.ageMin ?? 25)) problems.push(`年龄下限应是 ${view.ageMin ?? 25}，回读到「${show(t?.age_min)}」`)
  if (Number(t?.age_max) !== (view.ageMax ?? 65)) problems.push(`年龄上限应是 ${view.ageMax ?? 65}，回读到「${show(t?.age_max)}」`)
  if ((view.geoCityKeys?.length ?? 0) === 0) {
    const got = (t?.geo_locations?.countries ?? []).map(String).sort().join(',')
    const want = [...view.geoCountries].sort().join(',')
    if (got !== want) problems.push(`投放国家应是「${want}」，回读到「${got || '读不到'}」`)
  }
  if (problems.length === 0) return []
  return [blocker('adset_targeting_mismatch', `广告组「${view.adSetName}」的定向和草稿不一致：${problems.join('；')}。`)]
}

function setAdFindings(sb: SetReadback): LaunchFinding[] {
  const { view, ads } = sb
  const out: LaunchFinding[] = []
  if (ads.length !== view.creatives.length) {
    out.push(blocker(
      'ad_count_mismatch',
      `广告组「${view.adSetName}」应有 ${view.creatives.length} 条广告，回读到 ${ads.length} 条。可能是刚建完还没同步，也可能是丢了，都不能当没问题。`,
    ))
  }
  const loose = ads.filter((a) => !isPaused(a.status)).map((a) => `${show(a.adName)}（${show(a.status)}）`)
  if (loose.length > 0) {
    out.push(blocker('not_paused', `广告组「${view.adSetName}」里这些广告不是暂停的：${loose.join('、')}。`))
  }
  out.push(...formFindings(sb))
  return out
}

function formFindings(sb: SetReadback): LaunchFinding[] {
  const { view, ads } = sb
  if (view.kind !== 'lead_form' || !view.leadFormId) return []
  const wrong = ads.filter((a) => a.leadFormId !== undefined && a.leadFormId !== view.leadFormId)
  if (wrong.length > 0) {
    return [blocker('ad_form_mismatch', `广告组「${view.adSetName}」里有广告挂的表单和草稿不是同一个：${wrong.map((a) => show(a.adName)).join('、')}。`)]
  }
  if (ads.some((a) => a.leadFormId === undefined)) {
    return [{
      code: 'ad_form_unreadable',
      severity: 'warn',
      message: `广告组「${view.adSetName}」的广告回读里没看到表单编号（Meta 不一定回显），表单对不对要开投前人工核一次。`,
      learnedFrom: LEARNED,
    }]
  }
  return []
}

/** 多组草稿建完之后的核对。`nowMs` 注入是为了测试不用拨假时钟。 */
export function checkMultiCreated(draft: AdDraft, rb: MultiReadback, nowMs: number): LaunchFinding[] {
  return [
    ...campaignFindings(draft, rb),
    ...rb.sets.flatMap((sb) => [
      ...setStateFindings(sb, nowMs),
      ...setTargetingFindings(sb),
      ...setAdFindings(sb),
    ]),
  ]
}

/** 把每个组各自的 `checkLaunch` 报告和上面的核对合成一份：任何一组有 blocker，整份就不能开。 */
export function mergeMultiReports(
  reports: readonly { setName: string; report: LaunchReadbackReport }[],
  extra: readonly LaunchFinding[],
): LaunchReadbackReport {
  const findings = [
    ...reports.flatMap((r) => r.report.findings.map((f) => ({ ...f, message: `【${r.setName}】${f.message}` }))),
    ...extra,
  ]
  return {
    findings,
    safeToActivate: reports.every((r) => r.report.safeToActivate) && !extra.some((f) => f.severity === 'blocker'),
    buyerWillSee: reports.flatMap((r) => r.report.buyerWillSee.map((b) => ({ ...b, adName: `【${r.setName}】${b.adName}` }))),
  }
}
