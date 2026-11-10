/**
 * 「自动发信」读接口的入口：把订单 → 批次计划，再把计划和登记 / 发送记录拼成列表和详情。
 * 读数据库的细节在 load-bookings.ts / load-facts.ts；拼装在 aggregate.ts（纯函数）。
 * 出错（读不到表）就抛错，由路由翻成「暂时读不到」；没有记录是正常情况，返回空，不抛。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { nzTodayIso } from '@/lib/crm/booking-view'
import { SCHEDULED_BATCHES_SHOWN, buildDetail, buildList, type LetterFacts } from './aggregate'
import { COUNTDOWN_CADENCE, type CountdownCadence } from './cadence'
import { buildTemplateKey, buildTriggerKey, parseLetterKey, type LetterIdentity } from './keys'
import { loadBookingFacts } from './load-bookings'
import { loadMeSends, loadRegistry } from './load-facts'
import { planCountdownCalendar, planCountdownIssue } from './plan'
import type { AutoLetterDetail, AutoLettersList, PlannedLetter } from './types'

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

/** 取这些信的登记 + 发送事实（按 letterKey）。信的编号算不出来（日期不合法）就当没有事实。 */
async function loadLetterFacts(
  db: SupabaseClient,
  clientId: string,
  letters: readonly PlannedLetter[],
): Promise<Map<string, LetterFacts>> {
  const keyed = letters.map((letter) => ({
    letterKey: letter.letterKey,
    templateKey: buildTemplateKey(identityOf(letter)),
    triggerKey: buildTriggerKey(identityOf(letter)),
  }))
  const templateKeys = keyed.flatMap((item) => (item.templateKey === null ? [] : [item.templateKey]))
  const triggerKeys = keyed.flatMap((item) => (item.triggerKey === null ? [] : [item.triggerKey]))
  const [registry, sends] = await Promise.all([
    loadRegistry(db, clientId, templateKeys),
    loadMeSends(db, clientId, triggerKeys),
  ])
  const facts = new Map<string, LetterFacts>()
  for (const item of keyed) {
    facts.set(item.letterKey, {
      registry: item.templateKey === null ? null : (registry.get(item.templateKey) ?? null),
      sends: item.triggerKey === null ? null : (sends.get(item.triggerKey) ?? null),
    })
  }
  return facts
}

/** 列表上要显示的信：最近几批（含「下一批」）。其余的信只算个数，不用读记录。 */
function lettersShownOnList(planned: readonly PlannedLetter[], today: string): PlannedLetter[] {
  const upcoming = planned.filter((letter) => letter.sendDate >= today)
  const shownDays = new Set(Array.from(new Set(upcoming.map((letter) => letter.sendDate))).slice(0, SCHEDULED_BATCHES_SHOWN))
  return upcoming.filter((letter) => shownDays.has(letter.sendDate))
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
  const planned = planCountdownCalendar(facts, today, cadence)
  const letterFacts = await loadLetterFacts(db, clientId, lettersShownOnList(planned, today))
  return { ...buildList(planned, letterFacts, today, now.toISOString()), cadence: { firstMonth: cadence.firstMonth }, notices }
}

/** 找不到这封信（编号不认识，或现在的计划里没有它）→ null，路由翻成 404。 */
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
  const { facts } = await loadBookingFacts(db, clientId)
  const letter = planCountdownIssue(facts, identity.sendDate, cadence).find((candidate) => candidate.letterKey === letterKey)
  if (letter === undefined) return null
  const letterFacts = await loadLetterFacts(db, clientId, [letter])
  return buildDetail(letter, letterFacts.get(letterKey) ?? null, nzTodayIso(now))
}
