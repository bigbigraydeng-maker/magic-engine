import { describe, expect, it } from 'vitest'

import {
  AUTO_SEND_EXTRA_REASON_LABELS,
  UNKNOWN_REASON_TEXT,
  resolveReasonText,
} from '../reason-labels'

const BASE: Readonly<Record<string, string>> = {
  frequency_cap: '最近收到的邮件已达上限',
  do_not_contact: '别再联系',
  send_unknown: '发送状态不明',
}

/** Keys that already live in the existing 「最近发送」 table; extras must not repeat them. */
const EXISTING_KEYS: readonly string[] = [
  'frequency_cap',
  'frequency_unverifiable',
  'content_blocked',
  'placeholder_left',
  'link_host_not_allowed',
  'link_not_https',
  'tour_page_not_on_sale',
  'template_outdated',
  'catalog_outdated',
  'template_unavailable',
  'tour_unavailable',
  'invalid_pick',
  'already_followed_up',
  'duplicate_template',
  'recipient_not_allowed',
  'not_enquirer',
  'do_not_contact',
  'quota',
  'busy',
  'config_invalid',
  'internal_error',
  'graph_failed',
  'send_unknown',
  'reconcile_failed',
]

const EMDASH = '—'
const CJK = /[\u4E00-\u9FFF]/

describe('resolveReasonText · text already translated by the read interface', () => {
  it('shows reasonText as it is, ahead of any code', () => {
    const out = resolveReasonText(
      { status: 'blocked', reasonCode: 'frequency_cap', reasonDetail: null, reasonText: ' 他最近 7 天已收 2 封 ' },
      { frequency_cap: 'BASE-TEXT' },
    )
    expect(out).toEqual({ main: '他最近 7 天已收 2 封', detail: null })
  })

  it('blank reasonText falls back to the code path', () => {
    const out = resolveReasonText(
      { status: 'blocked', reasonCode: 'no_consent_basis', reasonDetail: null, reasonText: '   ' },
      {},
    )
    expect(out.main).toBe('没有同意依据')
  })

  it('does not touch sent, pending or rehearsal rows', () => {
    for (const status of ['sent', 'pending', 'rehearsal'] as const) {
      const out = resolveReasonText({ status, reasonCode: null, reasonDetail: null, reasonText: '不该出现' }, {})
      expect(out.main).not.toBe('不该出现')
    }
  })
})

describe('resolveReasonText', () => {
  it('shows an em dash for sent rows', () => {
    expect(
      resolveReasonText({ status: 'sent', reasonCode: null, reasonDetail: null }, BASE),
    ).toEqual({ main: EMDASH, detail: null })
  })

  it('shows an em dash for pending rows', () => {
    expect(
      resolveReasonText({ status: 'pending', reasonCode: 'bounced', reasonDetail: '地址无效' }, BASE),
    ).toEqual({ main: EMDASH, detail: null })
  })

  it('explains rehearsal rows', () => {
    expect(
      resolveReasonText({ status: 'rehearsal', reasonCode: null, reasonDetail: null }, BASE),
    ).toEqual({ main: '彩排，没有真的发出去', detail: null })
  })

  it('uses the base table first', () => {
    expect(
      resolveReasonText(
        { status: 'blocked', reasonCode: 'frequency_cap', reasonDetail: '最近 7 天已收了 2 封' },
        BASE,
      ),
    ).toEqual({ main: '最近收到的邮件已达上限', detail: '最近 7 天已收了 2 封' })
  })

  it('falls back to the extra labels', () => {
    expect(
      resolveReasonText(
        { status: 'blocked', reasonCode: 'no_consent_basis', reasonDetail: null },
        BASE,
      ).main,
    ).toBe('没有同意依据')
  })

  it('resolves failed rows from the extra labels', () => {
    expect(
      resolveReasonText({ status: 'failed', reasonCode: 'bounced', reasonDetail: '地址无效' }, BASE),
    ).toEqual({ main: '对方邮箱退回', detail: '地址无效' })
  })

  it('lets the base table win when both tables contain the key', () => {
    const customBase: Readonly<Record<string, string>> = { dnc: 'BASE-TEXT' }
    expect(
      resolveReasonText({ status: 'blocked', reasonCode: 'dnc', reasonDetail: null }, customBase).main,
    ).toBe('BASE-TEXT')
  })

  it('returns the unknown text for an unrecognised code', () => {
    const result = resolveReasonText(
      { status: 'blocked', reasonCode: 'totally_new_code', reasonDetail: null },
      BASE,
    )
    expect(result.main).toBe(UNKNOWN_REASON_TEXT)
    expect(result.main).not.toContain('totally_new_code')
  })

  it('returns the unknown text when the reason code is null', () => {
    expect(
      resolveReasonText({ status: 'blocked', reasonCode: null, reasonDetail: null }, BASE).main,
    ).toBe(UNKNOWN_REASON_TEXT)
  })

  it('never matches prototype keys', () => {
    for (const code of ['constructor', '__proto__']) {
      const result = resolveReasonText(
        { status: 'blocked', reasonCode: code, reasonDetail: null },
        BASE,
      )
      expect(result.main).toBe(UNKNOWN_REASON_TEXT)
    }
  })

  it('drops blank details', () => {
    expect(
      resolveReasonText({ status: 'blocked', reasonCode: 'frequency_cap', reasonDetail: '   ' }, BASE)
        .detail,
    ).toBeNull()
  })

  it('trims surrounding whitespace from details', () => {
    expect(
      resolveReasonText({ status: 'blocked', reasonCode: 'frequency_cap', reasonDetail: ' x ' }, BASE)
        .detail,
    ).toBe('x')
  })
})

describe('AUTO_SEND_EXTRA_REASON_LABELS', () => {
  it('never repeats a key from the existing table', () => {
    for (const key of EXISTING_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(AUTO_SEND_EXTRA_REASON_LABELS, key)).toBe(false)
    }
  })

  it('has a readable label for every key', () => {
    for (const [key, value] of Object.entries(AUTO_SEND_EXTRA_REASON_LABELS)) {
      expect(value.length, key).toBeGreaterThan(0)
      expect(CJK.test(value), key).toBe(true)
    }
  })
})
