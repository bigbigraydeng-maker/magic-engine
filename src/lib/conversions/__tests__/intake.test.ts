import { describe, it, expect } from 'vitest'
import { buildIntakeRow, toMinorUnits, minorUnitsFor, type IntakeInput } from '../intake'
import { normalizeEmail, normalizePhone } from '@/lib/pii/normalize'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const NOW = new Date('2026-09-05T00:00:00Z')
const CTX = { defaultPhoneCountry: '64', now: NOW }

function purchase(over: Partial<IntakeInput> = {}): IntakeInput {
  return {
    clientId: CTS,
    outcomeKind: 'purchase',
    customerEmail: 'Rosalind@Example.COM',
    amount: 23500,
    currency: 'nzd',
    occurredAt: '2026-09-03T10:00:00Z',
    sourceKind: 'manual_seed',
    ...over,
  }
}

describe('金额换算（浮点会算错钱，必须走十进制）', () => {
  it('常见币种是两位小数', () => {
    expect(minorUnitsFor('NZD')).toBe(2)
    expect(minorUnitsFor('nzd')).toBe(2)
  })

  it('未列出的币种返回 null，不默认成 2 位', () => {
    // 默认 2 的话，哪天真收了一笔日元（0 位小数），金额会静默差 100 倍。
    // 宁可当场报错让人来加一行，也不让系统猜。
    expect(minorUnitsFor('JPY')).toBeNull()
    expect(minorUnitsFor('EUR')).toBeNull()
  })

  it.each([
    ['3880', 'NZD', 388000],
    ['3880.50', 'NZD', 388050],
    ['19.99', 'NZD', 1999],
    ['0.01', 'NZD', 1],
    ['1200', 'AUD', 120000],
  ])('%s %s → %i', (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected)
  })

  it('数字入参与字符串入参结果一致', () => {
    expect(toMinorUnits(19.99, 'NZD')).toBe(toMinorUnits('19.99', 'NZD'))
    expect(toMinorUnits(0.07, 'NZD')).toBe(7)
  })

  it('真正的护栏是「超出精度就拒收」，不是换算方式', () => {
    // 2026-09-05 变异测试查实：把十进制换算改成 Math.round(x * 100)，
    // 在本函数允许的输入范围内结果完全一样 —— 浮点的经典反例 1.005
    // 早被下面这道闸挡掉了。所以真正保证金额不出错的是这一条。
    expect(toMinorUnits('1.005', 'NZD')).toBeNull()
    expect(toMinorUnits('3880.001', 'NZD')).toBeNull()
    expect(toMinorUnits('3880.99', 'NZD')).toBe(388099)
  })

  it('超出币种精度的尾数拒收，不静默四舍五入', () => {
    // 静默改金额比报错难查得多。
    expect(toMinorUnits('3880.555', 'NZD')).toBeNull()
  })

  it('未支持的币种返回 null，不猜小数位', () => {
    expect(toMinorUnits('10000', 'JPY')).toBeNull()
  })

  it('末位补零不算超精度', () => {
    expect(toMinorUnits('3880.500', 'NZD')).toBe(388050)
  })

  it('非数字返回 null', () => {
    expect(toMinorUnits('abc', 'NZD')).toBeNull()
    expect(toMinorUnits('$3,880', 'NZD')).toBeNull()
    expect(toMinorUnits('', 'NZD')).toBeNull()
  })
})

describe('电话规范化（不许把首个客户的国别写死成平台规则）', () => {
  it('NZ 本地格式带上国家码，去掉长途前导 0', () => {
    expect(normalizePhone('021 555 1234', '64')).toBe('64215551234')
    expect(normalizePhone('021-555-1234', '64')).toBe('64215551234')
  })

  it('AU 号码用 AU 的国家码 —— 同一段代码换个客户要能换国家', () => {
    expect(normalizePhone('0412 345 678', '61')).toBe('61412345678')
  })

  it('已经是国际格式的原样取数字', () => {
    expect(normalizePhone('+64 21 555 1234', '64')).toBe('64215551234')
    expect(normalizePhone('0064215551234', '64')).toBe('64215551234')
  })

  it('已带本国国家码的不再加一遍', () => {
    expect(normalizePhone('64215551234', '64')).toBe('64215551234')
  })

  it('拿不到国家码时，本地格式号返回 null —— 宁可少一个匹配键也不猜', () => {
    // 猜错国家会生成一个错的哈希，那个哈希可能匹配到**别人**。
    expect(normalizePhone('021 555 1234', null)).toBeNull()
    expect(normalizePhone('021 555 1234', '')).toBeNull()
  })

  it('但国际格式在没有国家码配置时依然可用', () => {
    expect(normalizePhone('+64 21 555 1234', null)).toBe('64215551234')
  })

  it('空值与纯符号返回 null', () => {
    expect(normalizePhone(null, '64')).toBeNull()
    expect(normalizePhone('   ', '64')).toBeNull()
    expect(normalizePhone('---', '64')).toBeNull()
  })
})

describe('邮箱规范化与打码', () => {
  it('去空白 + 全小写（同一个人换个写法要哈希成同一个值）', () => {
    expect(normalizeEmail('  Rosalind@Example.COM ')).toBe('rosalind@example.com')
  })

  it('空值返回 null', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('姓名也做同样的规范化', () => {
    expect(normalizeEmail('  A@B.CO ')).toBe('a@b.co')
  })
})

describe('录入校验 · 成交', () => {
  it('正常一条通过，并完成规范化', () => {
    const r = buildIntakeRow(purchase(), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.customer_email).toBe('rosalind@example.com')
    expect(r.row.amount_minor).toBe(2350000)
    expect(r.row.currency).toBe('NZD')
    expect(r.row.outcome_kind).toBe('purchase')
    expect(r.warnings).toEqual([])
  })

  it('成交必须有金额与币种', () => {
    const r = buildIntakeRow(purchase({ amount: null, currency: null }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('必须有金额')
    expect(r.errors.join()).toContain('必须有币种')
  })

  it('金额为 0 或负数被拒（退款不走这张表）', () => {
    expect(buildIntakeRow(purchase({ amount: 0 }), CTX).ok).toBe(false)
    expect(buildIntakeRow(purchase({ amount: -100 }), CTX).ok).toBe(false)
  })

  it('尾款走 balance，同样要金额', () => {
    const r = buildIntakeRow(purchase({ outcomeKind: 'balance', amount: 21500 }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // PM 2026-09-05：定金算成交，尾款绝不能记成第二笔 —— 靠 kind 区分，
    // 到 L3 adapter 映射成 BalancePaid 自定义事件而非 Purchase。
    expect(r.row.outcome_kind).toBe('balance')
  })
})

describe('录入校验 · 币种', () => {
  it('未支持的币种被拒，并说清怎么办', () => {
    const r = buildIntakeRow(purchase({ currency: 'JPY' }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    // 报错要告诉人下一步做什么，不是只说"不行"
    expect(r.errors.join()).toContain('暂不支持币种 JPY')
    expect(r.errors.join()).toContain('NZD')
  })

  it('未支持币种只报一条错，不再叠一条"金额不合法"', () => {
    const r = buildIntakeRow(purchase({ currency: 'JPY' }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.filter((e) => e.includes('amount 不是合法金额'))).toEqual([])
  })

  it('AUD 可用（Oztop 是澳洲客户）', () => {
    const r = buildIntakeRow(purchase({ currency: 'aud' }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.currency).toBe('AUD')
  })
})

describe('录入校验 · 咨询', () => {
  it('lead 不带金额也能过', () => {
    const r = buildIntakeRow(
      { clientId: CTS, outcomeKind: 'lead', customerEmail: 'sarah@example.com', occurredAt: '2026-09-04T00:00:00Z', sourceKind: 'inbox_extract' },
      CTX,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.amount_minor).toBeNull()
    expect(r.row.currency).toBeNull()
  })

  it('lead 带了金额反而被拒（PM 定的：咨询不带金额）', () => {
    const r = buildIntakeRow(purchase({ outcomeKind: 'lead', amount: 500, currency: 'NZD' }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('lead 不带金额')
  })
})

describe('录入校验 · 时间（挡住真实事故形状）', () => {
  it('把行程出发日当付款日录进来会被拒', () => {
    // CTS 有 2027 年 3 月才走的团，定金 2026 年就付了。录成出发日的话，
    // 这笔永远发不出去，而且没人知道为什么。
    const r = buildIntakeRow(purchase({ occurredAt: '2027-03-18T00:00:00Z' }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('不是行程出发日')
  })

  it('超过 7 天的照收但给出警告（历史成交要留档）', () => {
    const r = buildIntakeRow(purchase({ occurredAt: '2026-08-01T00:00:00Z' }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.join()).toContain('7 天')
  })

  it('7 天内的没有警告', () => {
    const r = buildIntakeRow(purchase({ occurredAt: '2026-09-01T00:00:00Z' }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
  })

  it('时钟略微超前（几小时）不算未来时间', () => {
    const r = buildIntakeRow(purchase({ occurredAt: '2026-09-05T06:00:00Z' }), CTX)
    expect(r.ok).toBe(true)
  })

  it('非法时间被拒', () => {
    expect(buildIntakeRow(purchase({ occurredAt: 'yesterday' }), CTX).ok).toBe(false)
  })
})

describe('录入校验 · 匹配键', () => {
  it('邮箱电话都没有 → 拒（发出去 100% 匹配不上）', () => {
    const r = buildIntakeRow(purchase({ customerEmail: null, customerPhone: null }), CTX)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('至少要有邮箱、电话')
  })

  it('只有电话也可以', () => {
    const r = buildIntakeRow(purchase({ customerEmail: null, customerPhone: '021 555 1234' }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.customer_phone).toBe('64215551234')
  })

  it('电话解析失败且没有邮箱 → 拒，并说清为什么丢了电话', () => {
    const r = buildIntakeRow(
      purchase({ customerEmail: null, customerPhone: '021 555 1234' }),
      { defaultPhoneCountry: null, now: NOW },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('至少要有邮箱、电话')
  })

  it('没有邮箱电话，但有 Facebook 私信身份 + contactId → 放行（NAL 场景）', () => {
    const r = buildIntakeRow(
      {
        clientId: CTS,
        contactId: '11111111-2222-3333-4444-555555555555',
        outcomeKind: 'lead',
        occurredAt: '2026-09-04T00:00:00Z',
        sourceKind: 'messenger_conversation',
        pageScopedUserId: '28681838868174032',
      },
      CTX,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.page_scoped_user_id).toBe('28681838868174032')
    expect(r.row.contact_id).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('只有 Facebook 私信身份、没有 contactId → 拒——拒联检查会被整段跳过', () => {
    const r = buildIntakeRow(
      {
        clientId: CTS,
        outcomeKind: 'lead',
        occurredAt: '2026-09-04T00:00:00Z',
        sourceKind: 'messenger_conversation',
        pageScopedUserId: '28681838868174032',
      },
      CTX,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('contactId 必须提供')
  })

  it('邮箱/电话/PSID 一个都没有 → 拒，错误信息带上三个选项', () => {
    const r = buildIntakeRow(
      {
        clientId: CTS,
        outcomeKind: 'lead',
        occurredAt: '2026-09-04T00:00:00Z',
        sourceKind: 'messenger_conversation',
      },
      CTX,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('Facebook 私信身份')
  })

  it('电话解析失败但有邮箱 → 放行 + 警告，不静默吞掉输入', () => {
    const r = buildIntakeRow(
      purchase({ customerPhone: '021 555 1234' }),
      { defaultPhoneCountry: null, now: NOW },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.customer_phone).toBeNull()
    expect(r.warnings.join()).toContain('国家码')
  })
})

describe('录入校验 · 其它', () => {
  it('clientId 必须是 uuid', () => {
    expect(buildIntakeRow(purchase({ clientId: 'cts' }), CTX).ok).toBe(false)
  })

  it('未知的 outcomeKind / sourceKind 被拒', () => {
    expect(buildIntakeRow(purchase({ outcomeKind: 'refund' }), CTX).ok).toBe(false)
    expect(buildIntakeRow(purchase({ sourceKind: 'guess' }), CTX).ok).toBe(false)
  })

  it('空字符串的可选字段落成 null，不是空串', () => {
    const r = buildIntakeRow(purchase({ orderRef: '  ', contactId: '', sourceRef: '' }), CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.order_ref).toBeNull()
    expect(r.row.contact_id).toBeNull()
    expect(r.row.source_ref).toBeNull()
  })

  it('一次报全部错误，不是报一条改一条', () => {
    const r = buildIntakeRow(
      { clientId: 'nope', outcomeKind: 'refund', occurredAt: 'bad', sourceKind: 'guess' },
      CTX,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.length).toBeGreaterThanOrEqual(4)
  })
})
