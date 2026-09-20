/**
 * 授权缺口 vs 故障的分岔判据。
 *
 * 钉住的是 2026-09-18~09-20 那次「任务永远是红的」的根因：3 个客户卡在
 * 只有人能修的授权上，却每 2 小时把整条任务判一次失败。
 */

import { describe, expect, it } from 'vitest'
import { parseGraphErrorDetail } from '../lead-forms'
import { classifyLeadsSyncBlocker, firstLeadsSyncBlocker } from '../leads-sync-blocker'

/** 2026-09-20 生产 `cron_run_logs` 里 Magic Lab Class / New Asian Logistics 的报错原文。 */
const REAL_190 = `{"error":{"message":"Any of the pages_read_engagement, pages_manage_metadata,\\n        pages_read_user_content, pages_manage_ads, pages_show_list or\\n        pages_messaging permission(s) must be granted before impersonating a\\n        user's page.","type":"OAuthException","code":190,"fbtrace_id":"AEkJ53wQ6MauKPU13X6pdnu"}}`

/** 2026-08-30 那次的报错原文。 */
const REAL_200 = `{"error":{"message":"(#200) Requires pages_manage_ads permission to manage the object","type":"OAuthException","code":200}}`

describe('classifyLeadsSyncBlocker', () => {
  it('Graph #190（令牌被拒）= 授权缺口 —— 这是 2026-09-20 那 13 次全红的真因', () => {
    expect(classifyLeadsSyncBlocker(parseGraphErrorDetail(REAL_190))).toBe('token_rejected')
  })

  it('Graph #200（缺权限）= 授权缺口', () => {
    expect(classifyLeadsSyncBlocker(parseGraphErrorDetail(REAL_200))).toBe('missing_permission')
  })

  it('#10 / #3 也算 —— 两者都只有人能补', () => {
    expect(classifyLeadsSyncBlocker({ code: 10, message: 'x' })).toBe('missing_permission')
    expect(classifyLeadsSyncBlocker({ code: 3, message: 'x' })).toBe('missing_permission')
  })

  it('限流和 5xx 不算授权缺口 —— 它们下一轮就可能好，当缺口会把真故障藏起来', () => {
    expect(classifyLeadsSyncBlocker({ code: 4, message: 'rate limit' })).toBeNull()
    expect(classifyLeadsSyncBlocker({ code: 2, message: 'transient' })).toBeNull()
    expect(classifyLeadsSyncBlocker({ code: 1, message: 'unknown' })).toBeNull()
  })

  it('报错体不是 Graph JSON（网络断 / 返回 HTML）→ 按故障处理，不瞎猜', () => {
    expect(parseGraphErrorDetail('<html>502 Bad Gateway</html>')).toBeNull()
    expect(classifyLeadsSyncBlocker(null)).toBeNull()
    expect(classifyLeadsSyncBlocker(undefined)).toBeNull()
  })

  it('认 code 不认文案 —— Meta 改措辞的那天判据不能跟着失效', () => {
    // 同一个 #190，message 换成完全不同的说法，结论必须不变。
    expect(classifyLeadsSyncBlocker({ code: 190, message: '（随便什么新文案）' })).toBe(
      'token_rejected',
    )
    // 反过来：文案里有 permission 字样但 code 是限流，不能被文案骗过去。
    expect(
      classifyLeadsSyncBlocker({ code: 4, message: 'permission checks temporarily unavailable' }),
    ).toBeNull()
  })
})

describe('firstLeadsSyncBlocker', () => {
  it('一把令牌被拒时每个表单都报同一句 —— 取第一个认得出来的就够了', () => {
    const details = [null, parseGraphErrorDetail(REAL_190), parseGraphErrorDetail(REAL_190)]
    expect(firstLeadsSyncBlocker(details)).toBe('token_rejected')
  })

  it('一条都认不出来 → null（按故障处理）', () => {
    expect(firstLeadsSyncBlocker([null, { code: 4, message: 'rate limit' }])).toBeNull()
  })

  it('空数组 → null', () => {
    expect(firstLeadsSyncBlocker([])).toBeNull()
  })
})
