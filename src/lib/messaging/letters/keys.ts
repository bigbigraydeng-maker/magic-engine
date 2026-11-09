/**
 * 信编号：一封信 = 某个发信日 × 某个团（tourId + 出发日）× 第几个月（或每周）。
 * 编号只由这四样事实算出来，同一封信前后不变；读接口、发信引擎、登记工具都用同一套写法。
 *
 *   letterKey   plan:<发信日>:<tourId 编码>:<出发日>:<月数 | w>                     （读接口 / 页面用，不透明）
 *   templateKey auto-countdown-<发信日 YYYYMMDD>-<团码>-<出发日 YYYYMMDD>-<m月数 | w>   （信的登记，crm_email_templates.template_key）
 *   triggerKey  countdown_<发信日 YYYYMMDD>_<团码>_<出发日 YYYYMMDD>_<月数 | w>         （发信引擎写 triggered_sends.trigger_key）
 *
 * tourId 用 encodeURIComponent 编码，所以 letterKey 里的「:」只会出现在分隔位。
 * 登记用的两个编号有长度和字符限制（模板键：小写字母 / 数字 / 连字符、最长 63 位，且 `auto-` 开头让销售选不到、手发会被拒；
 * 发信编号：小写字母 / 数字 / 下划线、最长 40 位），而 tourId 是 36 位的 uuid，放不下——所以两处都用 7 位「团码」
 * （由 tourId 算出的短码，只用来分团，不能反查；同一个 tourId 永远算出同一个码）。
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

/** 7 位短码：tourId 的 32 位哈希（FNV-1a）转 36 进制，不足补 0。只含 a-z、0-9。 */
export function tourCodeOf(tourId: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < tourId.length; index += 1) {
    hash ^= tourId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

function codeParts(identity: LetterIdentity): { send: string; depart: string; tour: string; months: string } | null {
  if (buildLetterKey(identity) === null) return null
  const send = compactDate(identity.sendDate)
  const depart = compactDate(identity.departOn)
  if (send === null || depart === null) return null
  return {
    send,
    depart,
    tour: tourCodeOf(identity.tourId),
    months: monthsToken(identity.monthsLeft),
  }
}

/** 信的登记用的模板编号（crm_email_templates.template_key）。 */
export function buildTemplateKey(identity: LetterIdentity): string | null {
  const parts = codeParts(identity)
  if (!parts) return null
  return `auto-countdown-${parts.send}-${parts.tour}-${parts.depart}-${parts.months === 'w' ? 'w' : `m${parts.months}`}`
}

/** 发信引擎写 triggered_sends.trigger_key 用的编号。 */
export function buildTriggerKey(identity: LetterIdentity): string | null {
  const parts = codeParts(identity)
  if (!parts) return null
  return `countdown_${parts.send}_${parts.tour}_${parts.depart}_${parts.months}`
}
