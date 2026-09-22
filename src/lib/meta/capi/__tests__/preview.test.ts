/**
 * 试运行预览的测试（Issue #1397 PR2）。
 *
 * 预览有两条硬要求，都在这里钉住：
 *   1. **不能有明文** —— 预览会进数据库、进日志、进截图。
 *   2. **不能只有哈希** —— 一串 sha256 核对不了任何东西，人看了等于没看。
 * 中间那条路是打码：认得出是谁，但留不下完整身份。
 */

import { describe, it, expect } from 'vitest'
import { maskForPreview } from '../preview'
import type { ClientSendConfig, OutcomeForSend } from '@/lib/conversions/destination-writer'

const CONFIG: ClientSendConfig = {
  clientId: 'c0000000-0000-0000-0000-000000000000',
  defaultPhoneCountry: '64',
  facebookPageId: null,
}

const META = { eventName: 'Purchase', maxEventAgeDays: 7 }

function outcome(over: Partial<OutcomeForSend> = {}): OutcomeForSend {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    clientId: CONFIG.clientId,
    contactId: null,
    outcomeKind: 'purchase',
    customerEmail: 'rosalind@example.com',
    customerPhone: '021 555 1234',
    customerFirst: 'Rosalind',
    customerLast: 'Vane',
    orderRef: '84191',
    amountMinor: 2350000,
    currency: 'NZD',
    occurredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    pageScopedUserId: null,
    actionSource: 'email',
    ...over,
  }
}

describe('不留明文', () => {
  it('完整邮箱、完整电话、完整姓名都不出现', () => {
    const p = JSON.stringify(maskForPreview(outcome(), CONFIG, META))
    expect(p).not.toContain('rosalind@example.com')
    expect(p).not.toContain('64215551234')
    expect(p).not.toContain('5551234')
    expect(p).not.toContain('Rosalind')
    expect(p).not.toContain('Vane')
  })

  it('也不给哈希（人核对不了一串 sha256）', () => {
    const p = JSON.stringify(maskForPreview(outcome(), CONFIG, META))
    expect(p).not.toMatch(/[0-9a-f]{64}/)
  })

  it('Facebook 私信身份也只给「有/无」，原始 PSID 绝不出现在返回对象里', () => {
    // 🔴 这个返回对象会被写进 me_conversion_writebacks.payload_preview 永久留底
    // （试运行阶段必经路径）——PSID 是 Meta 官方文档说"不哈希发给他们"的原始值，
    // 跟"我们自己存的时候要不要打码"是两件事，这里必须守住后者。
    const psid = '28681838868174032'
    const result = maskForPreview(outcome({ pageScopedUserId: psid }), CONFIG, META)
    expect(JSON.stringify(result)).not.toContain(psid)
    expect(result.匹配键_有).toContain('Facebook 私信身份')
  })

  it('没有 PSID 时，「Facebook 私信身份」进匹配键_无', () => {
    const result = maskForPreview(outcome({ pageScopedUserId: null }), CONFIG, META)
    expect(result.匹配键_无).toContain('Facebook 私信身份')
  })
})

describe('但要认得出是谁', () => {
  it('邮箱留头三位和域名', () => {
    const p = maskForPreview(outcome(), CONFIG, META)
    expect((p.客户 as Record<string, unknown>).邮箱).toBe('ros***@example.com')
  })

  it('电话留末两位', () => {
    const p = maskForPreview(outcome(), CONFIG, META)
    expect((p.客户 as Record<string, unknown>).电话).toBe('*********34')
  })

  it('姓名留首字母', () => {
    const p = maskForPreview(outcome(), CONFIG, META)
    expect((p.客户 as Record<string, unknown>).姓名).toBe('R*** V***')
  })

  it('金额是人能读的形式，不是最小单位的数字', () => {
    // 「2350000」看不出是 2.35 万还是 235 万。
    const p = maskForPreview(outcome(), CONFIG, META)
    expect(p.金额).toBe('NZD 23,500.00')
  })
})

describe('把该判断的判断替人做了', () => {
  it('列出有哪些匹配键、缺哪些', () => {
    const p = maskForPreview(outcome({ customerLast: null }), CONFIG, META)
    expect(p.匹配键_有).toContain('邮箱')
    expect(p.匹配键_有).toContain('电话')
    expect(p.匹配键_无).toContain('姓')
  })

  it('匹配键少时直说"大概率匹配不上"，不让人自己数', () => {
    const p = maskForPreview(
      outcome({ customerPhone: null, customerFirst: null, customerLast: null }),
      CONFIG,
      META,
    )
    expect(p.匹配质量提示).toContain('只有一个匹配键')
  })

  it('匹配键齐全时给正面判断', () => {
    const p = maskForPreview(outcome(), CONFIG, META)
    expect(p.匹配质量提示).toBe('匹配键较全')
  })

  it('超过 7 天的直接说不能发、早了几天', () => {
    // 「HTTP 400」对人没用；「已过去 35 天，Meta 只收 7 天内的」才有用。
    const p = maskForPreview(
      outcome({ occurredAt: new Date(Date.now() - 35 * 86_400_000).toISOString() }),
      CONFIG,
      META,
    )
    expect(String(p.能否发送)).toContain('不能')
    expect(String(p.能否发送)).toContain('35 天')
  })

  it('7 天内的说可以发', () => {
    const p = maskForPreview(outcome(), CONFIG, META)
    expect(p.能否发送).toBe('可以')
  })
})

describe('边界', () => {
  it('什么都没有时不崩，也不吐出 undefined 字样', () => {
    const p = maskForPreview(
      outcome({
        customerEmail: null,
        customerPhone: null,
        customerFirst: null,
        customerLast: null,
        amountMinor: null,
        currency: null,
        orderRef: null,
      }),
      CONFIG,
      META,
    )
    expect(JSON.stringify(p)).not.toContain('undefined')
    expect((p.客户 as Record<string, unknown>).邮箱).toBeNull()
    expect(p.金额).toBeNull()
  })

  it('电话解析不出来时显示为空，不显示原始输入', () => {
    // 拿不到国家码时电话会被丢掉 —— 预览要跟真正发出去的内容一致。
    const p = maskForPreview(outcome(), { ...CONFIG, defaultPhoneCountry: null }, META)
    expect((p.客户 as Record<string, unknown>).电话).toBeNull()
    expect(p.匹配键_无).toContain('电话')
  })
})
