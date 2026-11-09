import type { RecipientStatus } from './types'

/**
 * Labels for reason codes that the existing 「最近发送」 table does not know about.
 * The page looks a code up in the caller's `base` table first and only falls back to
 * this map, so nothing here can ever override an existing label.
 */
export const AUTO_SEND_EXTRA_REASON_LABELS: Readonly<Record<string, string>> = {
  no_consent_basis: '没有同意依据',
  frequency_full: '最近 7 天已收满 2 封',
  dnc: '客人说了别再联系',
  mailchimp_suppressed: '已在 Mailchimp 退订',
  excluded_tag: '带了不发信的标签',
  sales_email_exists: '销售已经单独发过邮件',
  bad_email: '邮箱地址不可用',
  system_address: '是系统邮箱，不发',
  not_in_allowlist: '不在试跑名单里',
  stale: '线索太久了，不发',
  dnc_unverifiable: '没法确认他有没有说过别再联系',
  consent_unreadable: '读不到同意记录',
  legacy_unverifiable: '没法确认以前有没有发过',
  evidence_unverifiable: '数不清他最近收了几封',
  bounced: '对方邮箱退回',
  invalid_address: '邮箱地址无效',
  unsubscribed: '客人已经退订',
}

export const UNKNOWN_REASON_TEXT = '原因暂时没写清楚'

/** Own-property lookup only, so inherited keys such as `constructor` never match. */
function lookup(table: Readonly<Record<string, string>>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(table, key)) return null
  const value = table[key]
  return typeof value === 'string' ? value : null
}

function normaliseDetail(detail: string | null): string | null {
  if (detail === null) return null
  const trimmed = detail.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Turns a recipient row into the text shown in the 「原因」 cell.
 *
 * `base` is the existing 「最近发送」 label table passed in by the caller; this module only
 * ADDS labels and never changes an existing one. The raw reason code is never returned.
 */
export function resolveReasonText(
  row: { status: RecipientStatus; reasonCode: string | null; reasonDetail: string | null },
  base: Readonly<Record<string, string>>,
): { main: string; detail: string | null } {
  if (row.status === 'sent' || row.status === 'pending') {
    return { main: '—', detail: null }
  }

  if (row.status === 'rehearsal') {
    return { main: '彩排，没有真的发出去', detail: null }
  }

  const code = row.reasonCode
  const main =
    code === null
      ? UNKNOWN_REASON_TEXT
      : lookup(base, code) ?? lookup(AUTO_SEND_EXTRA_REASON_LABELS, code) ?? UNKNOWN_REASON_TEXT

  return { main, detail: normaliseDetail(row.reasonDetail) }
}
