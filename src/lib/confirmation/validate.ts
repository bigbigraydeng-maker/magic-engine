import type { ConfirmationData } from './types'

/** CTS tour codes look like CTS4270729: "CTS" followed by digits. */
const TOUR_CODE_RE = /^CTS\d{5,}$/

/**
 * Returns human-readable problems (empty array = OK to generate).
 * The check that matters most: the tour code must be a single well-formed
 * value, because the source document once carried two different codes.
 */
export function validateConfirmation(d: ConfirmationData): string[] {
  const errors: string[] = []

  const code = d.tourCode.trim()
  if (!code) errors.push('团号必填')
  else if (!TOUR_CODE_RE.test(code)) errors.push('团号格式不对，应该像 CTS4270729（CTS 加数字，不要空格）')

  if (!d.groundOperator.trim()) errors.push('地接社名称必填')
  if (!Number.isInteger(d.paxCount) || d.paxCount < 1) errors.push('人数至少 1 人')
  if (!d.departureDate.trim()) errors.push('出发日期必填')
  if (d.days.length === 0) errors.push('至少要有一天行程')

  d.days.forEach((day, i) => {
    if (!day.date.trim()) errors.push(`第 ${i + 1} 天缺日期`)
    if (!day.route.trim()) errors.push(`第 ${i + 1} 天缺路线`)
  })

  d.emergencyContacts.forEach((c, i) => {
    if (c.name.trim() && !c.mobile.trim()) errors.push(`紧急联系人 ${i + 1} 缺电话`)
  })

  return errors
}

/** Lines of free text -> trimmed non-empty lines. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}
