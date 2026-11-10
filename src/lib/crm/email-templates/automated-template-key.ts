/**
 * Templates whose key starts with `auto-` are written for ME's own automated letters (the welcome letter, the countdown
 * letters). Staff never pick or send them by hand: the post-call picker leaves them out and the manual send path refuses
 * them, because the request's template key comes from the browser. The automated sender reads them through the template
 * store as usual. Template keys are lower-case by rule (`TEMPLATE_KEY_RE`); the check lower-cases anyway, so a request
 * key in another case cannot slip past it.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §9-4.
 */

import { COUNTDOWN_CADENCE } from '@/lib/messaging/letters/cadence'

export const AUTOMATED_TEMPLATE_KEY_PREFIX = 'auto-'

export function isAutomatedTemplateKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.trim().toLowerCase().startsWith(AUTOMATED_TEMPLATE_KEY_PREFIX)
}

export interface AutomatedSendDisplay {
  trigger: string | null
  schedule: string | null
  recipients: string | null
}

const WELCOME_DISPATCH = '每日 09:00、11:00（Pacific/Auckland）跑欢迎信扫描与发送队列'
const COUNTDOWN_KEY_RE = /^auto-countdown-(\d{8})-([a-z0-9]+)-(\d{8})-(m[1-6]|w)$/i

function formatYmd(compact: string): string | null {
  if (!/^\d{8}$/.test(compact)) return null
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

export function automatedSendDisplay(templateKey: string): AutomatedSendDisplay | null {
  if (!isAutomatedTemplateKey(templateKey)) return null
  const key = templateKey.trim().toLowerCase()
  if (key === 'auto-welcome') {
    return { trigger: 'ME 欢迎信（trigger_key：welcome）', schedule: WELCOME_DISPATCH, recipients: null }
  }
  const m = COUNTDOWN_KEY_RE.exec(key)
  if (!m) return { trigger: 'ME 自动发信', schedule: null, recipients: null }
  const [, sendYmd, , , monthsToken] = m
  const send = formatYmd(sendYmd)
  const batch = COUNTDOWN_CADENCE.batchWeekday === 3 ? '每月第一个周三' : `每周周${COUNTDOWN_CADENCE.batchWeekday}`
  const weekly =
    monthsToken === 'w'
      ? `离出发 ≤ ${COUNTDOWN_CADENCE.weeklyWithinDays} 天时按周发`
      : `出发前约 ${monthsToken.replace(/^m/, '')} 个月的信（发信日 ${send ?? sendYmd}）`
  const schedule = `${batch}批次；${weekly}；最后一封至少提前 ${COUNTDOWN_CADENCE.stopBeforeDays} 天`
  const recipients =
    monthsToken === 'w'
      ? '该团、该出发日已订座的客人（每周倒计时信）'
      : '该团、该出发日已订座的客人（同一批共用这一封）'
  return {
    trigger: 'ME 出发前倒计时信（trigger_key 与模板键一一对应）',
    schedule,
    recipients,
  }
}
