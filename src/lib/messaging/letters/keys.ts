/**
 * 信编号：一封信 = 某个发信日 × 某个团（tourId + 出发日）× 第几个月（或每周）。
 * 编号只由这四样事实算出来，同一封信前后不变；读接口、发信引擎、登记工具都用同一套写法。
 *
 *   letterKey   plan:<发信日>:<tourId 编码>:<出发日>:<月数 | w>        （读接口 / 页面用，不透明）
 *   templateKey countdown-<发信日 YYYYMMDD>-<tourId 编码>-<出发日 YYYYMMDD>-<m月数 | w>   （信的登记，crm_email_templates.template_key）
 *   triggerKey  countdown_<发信日 YYYYMMDD>_<tourId 编码>_<出发日 YYYYMMDD>_<月数 | w>    （发信引擎写 triggered_sends.trigger_key）
 *
 * tourId 用 encodeURIComponent 编码，所以编号里的「:」只会出现在分隔位。
 */

import { compactDate, toDayNumber } from './dates'
import type { MonthsLeft, NzDate } from './types'

export interface LetterIdentity {
  sendDate: NzDate
  tourId: string
  departOn: NzDate
  monthsLeft: MonthsLeft
}

const KEY_RE = /^plan:(\d{4}-\d{2}-\d{2}):([^:]+):(\d{4}-\d{2}-\d{2}):(w|[1-6])$/

function monthsToken(monthsLeft: MonthsLeft): string {
  return monthsLeft === 'weekly' ? 'w' : String(monthsLeft)
}

function isValidMonths(monthsLeft: MonthsLeft): boolean {
  return monthsLeft === 'weekly' || (Number.isInteger(monthsLeft) && monthsLeft >= 1 && monthsLeft <= 6)
}

/** 日期或月数不合法就返回 null（调用方跳过这一封，不抛）。 */
export function buildLetterKey(identity: LetterIdentity): string | null {
  const { sendDate, tourId, departOn, monthsLeft } = identity
  if (toDayNumber(sendDate) === null || toDayNumber(departOn) === null) return null
  if (!isValidMonths(monthsLeft) || tourId === '') return null
  return `plan:${sendDate}:${encodeURIComponent(tourId)}:${departOn}:${monthsToken(monthsLeft)}`
}

/** 认不出来（格式不对 / 日期不真实）就返回 null。 */
export function parseLetterKey(key: string): LetterIdentity | null {
  const match = KEY_RE.exec(key)
  if (!match) return null
  const [, sendDate, encodedTour, departOn, token] = match
  if (toDayNumber(sendDate) === null || toDayNumber(departOn) === null) return null
  let tourId: string
  try {
    tourId = decodeURIComponent(encodedTour)
  } catch {
    return null
  }
  if (tourId === '') return null
  return { sendDate, tourId, departOn, monthsLeft: token === 'w' ? 'weekly' : Number(token) }
}

function codeParts(identity: LetterIdentity): { send: string; depart: string; tour: string; months: string } | null {
  if (buildLetterKey(identity) === null) return null
  const send = compactDate(identity.sendDate)
  const depart = compactDate(identity.departOn)
  if (send === null || depart === null) return null
  return {
    send,
    depart,
    tour: encodeURIComponent(identity.tourId),
    months: monthsToken(identity.monthsLeft),
  }
}

/** 信的登记用的模板编号（crm_email_templates.template_key）。 */
export function buildTemplateKey(identity: LetterIdentity): string | null {
  const parts = codeParts(identity)
  if (!parts) return null
  return `countdown-${parts.send}-${parts.tour}-${parts.depart}-${parts.months === 'w' ? 'w' : `m${parts.months}`}`
}

/** 发信引擎写 triggered_sends.trigger_key 用的编号。 */
export function buildTriggerKey(identity: LetterIdentity): string | null {
  const parts = codeParts(identity)
  if (!parts) return null
  return `countdown_${parts.send}_${parts.tour}_${parts.depart}_${parts.months}`
}
