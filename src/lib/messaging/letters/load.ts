/**
 * 「自动发信」读接口的入口：把订单 → 批次计划，再把计划和登记 / 发送记录拼成列表和详情。
 * 读数据库的细节在 load-bookings.ts / load-facts.ts；拼装在 aggregate.ts（纯函数）。
 * 出错（读不到表）就抛错，由路由翻成「暂时读不到」；没有记录是正常情况，返回空，不抛。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listContactNamesForClient } from '@/lib/crm/booking-overview-reads'
import { nzTodayIso } from '@/lib/crm/booking-view'
import { cleanDisplayName } from '@/lib/crm/clean-display-name'
import { loadBookingTourFacts } from '@/lib/tour-catalog/booking-facts'
import { SCHEDULED_BATCHES_SHOWN, buildDetail, buildList, type LetterFacts } from './aggregate'
import { COUNTDOWN_CADENCE, type CountdownCadence } from './cadence'
import { shiftDays } from './dates'
import { lookbackDaysFor } from './history'
import { buildTemplateKey, buildTriggerKey, parseLetterKey, type LetterIdentity } from './keys'
import { UNKNOWN_TOUR_NAME, loadBookingFacts } from './load-bookings'
import { loadMailchimpSends, loadMeSends, loadRegistry } from './load-facts'
import { planCountdownCalendar, planCountdownIssue } from './plan'
import type { AutoLetterDetail, AutoLettersList, NzDate, PlannedLetter } from './types'

export type CadenceResolver = (clientId: string) => CountdownCadence | null

/**
 * 这个客户用哪套倒计时节奏——全仓库只在这一处决定。
 * 现在所有客户暂用同一套（现有旅游客户的规矩：周三发、6 到 1 个月、最后一封提前 3 天停），这是进客户配置之前的过渡。
 * 发信引擎用计划函数之前，这里必须改成从客户配置读；没配节奏的客户返回 null，就不排信（列表为空、详情找不到）。
 */
export const cadenceFor: CadenceResolver = () => COUNTDOWN_CADENCE

function identityOf(letter: PlannedLetter): LetterIdentity {
  return { sendDate: letter.sendDate, tourId: letter.tourId, departOn: letter.departOn, monthsLeft: letter.monthsLeft }
}

/** Mailchimp 里有同名的已发活动、对不上哪一个：如实告诉员工，这封信的发送情况先不显示。 */
function mismatchNotice(templateKey: string, campaigns: number): string {
  return `「${templateKey}」在 Mailchimp 里对不上：有 ${campaigns} 个同名活动，这封信的发送情况先不显示（只留一个同名活动就能对上）。`
}

/**
 * 取这些信的登记 + 发送事实（按 letterKey）。信的编号算不出来（日期不合法）就当没有事实。
 * 发送事实有两个来源：走 Mailchimp 发的（活动标题 ＝ 模板键，一字不差）和 ME 自己发的（提案 / 发送记录）。
 * 两边都有时以 Mailchimp 为准（它对得上就说明这一封是在 Mailchimp 发出去的）；Mailchimp 对不上（同名活动不止一个）就不猜，
 * 退回 ME 这边的记录，并在 notices 里说一句。
 */
async function loadLetterFacts(
  db: SupabaseClient,
  clientId: string,
  letters: readonly PlannedLetter[],
): Promise<{ facts: Map<string, LetterFacts>; notices: string[] }> {
  const keyed = letters.map((letter) => ({
    letterKey: letter.letterKey,
    templateKey: buildTemplateKey(identityOf(letter)),
    triggerKey: buildTriggerKey(identityOf(letter)),
  }))
  const templateKeys = keyed.flatMap((item) => (item.templateKey === null ? [] : [item.templateKey]))
  const triggerKeys = keyed.flatMap((item) => (item.triggerKey === null ? [] : [item.triggerKey]))
  const [registry, meSends, mailchimp] = await Promise.all([
    loadRegistry(db, clientId, templateKeys),
    loadMeSends(db, clientId, triggerKeys),
    loadMailchimpSends(db, clientId, templateKeys),
  ])
  const facts = new Map<string, LetterFacts>()
  const notices: string[] = []
  for (const item of keyed) {
    const viaMailchimp = item.templateKey === null ? null : (mailchimp.facts.get(item.templateKey) ?? null)
    const clash = item.templateKey === null ? undefined : mailchimp.ambiguous.get(item.templateKey)
    if (item.templateKey !== null && clash !== undefined) notices.push(mismatchNotice(item.templateKey, clash))
    facts.set(item.letterKey, {
      registry: item.templateKey === null ? null : (registry.get(item.templateKey) ?? null),
      sends: viaMailchimp ?? (item.triggerKey === null ? null : (meSends.get(item.triggerKey) ?? null)),
    })
  }
  return { facts, notices }
}

/** 列表上要显示的信：最近几批（含「下一批」）。其余的信只算个数，不用读记录。 */
function lettersShownOnList(planned: readonly PlannedLetter[], today: string): PlannedLetter[] {
  const upcoming = planned.filter((letter) => letter.sendDate >= today)
  const shownDays = new Set(Array.from(new Set(upcoming.map((letter) => letter.sendDate))).slice(0, SCHEDULED_BATCHES_SHOWN))
  return upcoming.filter((letter) => shownDays.has(letter.sendDate))
}

/**
 * 要去读记录的信：已经过了发信日的（要看有没有痕迹，团汇总也要数「已发几封」）+ 列表上显示的最近几批。
 * 更远的信还没有任何记录，只算个数，不用读。
 */
function lettersToRead(planned: readonly PlannedLetter[], today: string): PlannedLetter[] {
  return [...planned.filter((letter) => letter.sendDate < today), ...lettersShownOnList(planned, today)]
}

export async function loadAutoLettersList(
  db: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
  resolveCadence: CadenceResolver = cadenceFor,
): Promise<AutoLettersList> {
  const today = nzTodayIso(now)
  const cadence = resolveCadence(clientId)
  if (cadence === null) return { ...buildList([], new Map(), today, now.toISOString()), cadence: null, notices: [] }
  const { facts, notices } = await loadBookingFacts(db, clientId)
  // 回看窗口起算：能装下一个还没出发的团的全部信（history.ts），这样「已过发信日的信」和团汇总的「已发几封」才不会少算。
  const from = shiftDays(today, -lookbackDaysFor(cadence)) ?? today
  const planned = planCountdownCalendar(facts, from, cadence)
  const { facts: letterFacts, notices: mismatches } = await loadLetterFacts(db, clientId, lettersToRead(planned, today))
  return {
    ...buildList(planned, letterFacts, today, now.toISOString()),
    cadence: { firstMonth: cadence.firstMonth },
    notices: [...notices, ...mismatches],
  }
}

/**
 * 现在的计划里已经没有这封信（团取消了、出发日改了、订单变了），可是发送记录或提案里有它的痕迹：
 * 照记录把详情拼出来（姓名、团名另外去查），不让员工点一封已经发出去的信却得到「没找到」。
 * 记录里一点痕迹都没有 → null（照旧 404）。只读，只给姓名，不返回邮箱。
 */
async function detailFromRecords(
  db: SupabaseClient,
  clientId: string,
  identity: LetterIdentity,
  letterKey: string,
  today: NzDate,
): Promise<AutoLetterDetail | null> {
  const stub: PlannedLetter = {
    letterKey,
    sendDate: identity.sendDate,
    tourId: identity.tourId,
    tourName: UNKNOWN_TOUR_NAME,
    departOn: identity.departOn,
    monthsLeft: identity.monthsLeft,
    recipients: [],
  }
  const letterFacts = (await loadLetterFacts(db, clientId, [stub])).facts.get(letterKey) ?? null
  if (letterFacts?.sends == null) return null
  const people = letterFacts.sends.recipients.map((recipient) => recipient.contactId)
  const [tours, names] = await Promise.all([
    loadBookingTourFacts(db, clientId, [identity.tourId]),
    listContactNamesForClient(db, clientId, people),
  ])
  const letter: PlannedLetter = {
    ...stub,
    tourName: tours.get(identity.tourId)?.name ?? UNKNOWN_TOUR_NAME,
    recipients: people.map((contactId) => ({ contactId, displayName: cleanDisplayName(names.get(contactId) ?? null), seats: null })),
  }
  return buildDetail(letter, letterFacts, today)
}

/** 找不到这封信（编号不认识，或现在的计划和记录里都没有它）→ null，路由翻成 404。 */
export async function loadAutoLetterDetail(
  db: SupabaseClient,
  clientId: string,
  letterKey: string,
  now: Date = new Date(),
  resolveCadence: CadenceResolver = cadenceFor,
): Promise<AutoLetterDetail | null> {
  const identity = parseLetterKey(letterKey)
  if (identity === null) return null
  const cadence = resolveCadence(clientId)
  if (cadence === null) return null
  const today = nzTodayIso(now)
  const { facts } = await loadBookingFacts(db, clientId)
  const letter = planCountdownIssue(facts, identity.sendDate, cadence).find((candidate) => candidate.letterKey === letterKey)
  if (letter === undefined) return detailFromRecords(db, clientId, identity, letterKey, today)
  const { facts: letterFacts } = await loadLetterFacts(db, clientId, [letter])
  return buildDetail(letter, letterFacts.get(letterKey) ?? null, today)
}
