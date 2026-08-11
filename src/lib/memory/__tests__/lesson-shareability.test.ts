import { describe, it, expect } from 'vitest'
import { checkShareable, assertShareable } from '../lesson-shareability'

const CTX = {
  clientNames: ['30 Kiteroa', 'Parkhomes', 'Roman Hu Real Estate', 'CTS Tours NZ', 'Oztop'],
  personNames: ['David', 'Anita', 'Karen', 'Boris'],
}

describe('checkShareable — 放行「术」', () => {
  it('纯方法论、无金额无人名 → 可共享', () => {
    const v = checkShareable(
      '地产视频广告：中文要烧进画面，写在文案里救不回来',
      '中文观众在信息流里先看画面上的字，看到全英文就划走，根本读不到下面的中文说明。',
      CTX,
    )
    expect(v.shareable).toBe(true)
    expect(v.findings).toHaveLength(0)
  })

  it('平台机制类经验 → 可共享', () => {
    const v = checkShareable(
      '私信广告的问候语会照抄该创意自身的语言，不是可单独编辑的字段',
      '所以同一个私信广告组里混放两种语言的创意，必然有一批人收到看不懂的问候语。',
      CTX,
    )
    expect(v.shareable).toBe(true)
  })

  it('方法论里的数字不误伤 —— 365 天留存、前 3 秒都是「术」的一部分', () => {
    const v = checkShareable(
      '受众池按 365 天留存建，前 3 秒决定完播',
      '30 天的池子太小投不动；开头 3 秒留不住人，后面拍得再好也没人看到。',
      CTX,
    )
    expect(v.shareable).toBe(true)
  })
})

describe('checkShareable — 拦住「案例」', () => {
  it('🔴 金额 → 拦', () => {
    const v = checkShareable('中文素材有效', '实测每个咨询 $6.35，英文四条同日 0 个。', CTX)
    expect(v.shareable).toBe(false)
    expect(v.findings.map(f => f.kind)).toContain('money')
    expect(v.findings.find(f => f.kind === 'money')!.matched).toBe('$6.35')
  })

  it('🔴 花费拆分（多个金额）全部标出来', () => {
    const v = checkShareable('IG 表现差', 'FB 花 $86.57，IG 花 $14.74。', CTX)
    expect(v.findings.filter(f => f.kind === 'money')).toHaveLength(2)
  })

  it('🔴 NZ$ / 元 等其他写法也认', () => {
    expect(checkShareable('x', '预算 NZ$1,250,000', CTX).shareable).toBe(false)
    expect(checkShareable('x', '花了 3000 元', CTX).shareable).toBe(false)
  })

  it('🔴 客户名 → 拦', () => {
    const v = checkShareable('x', '30 Kiteroa 实测：中文烧字视频当天即出现中文咨询。', CTX)
    expect(v.findings.map(f => f.kind)).toContain('client_name')
    expect(v.findings.find(f => f.kind === 'client_name')!.matched).toBe('30 Kiteroa')
  })

  it('🔴 买家真名 → 拦（服务协议 §11.3）', () => {
    const v = checkShareable('欢迎语要直接给答案', '买家 David 收到问候语后问「房子地址在哪」。', CTX)
    expect(v.findings.map(f => f.kind)).toContain('person_name')
  })

  it('🔴 结果计数 → 拦', () => {
    const v = checkShareable('x', '这条广告带来 13 个咨询，另一条 0 个咨询。', CTX)
    expect(v.findings.map(f => f.kind)).toContain('outcome_count')
  })

  it('lesson 字段里的泄露同样拦 —— 两个字段都会进提示词', () => {
    const v = checkShareable('30 Kiteroa 的中文广告每咨询 $7.24', null, CTX)
    expect(v.shareable).toBe(false)
    expect(v.findings.map(f => f.kind)).toEqual(expect.arrayContaining(['money', 'client_name']))
  })

  it('rationale 为 null 也能判', () => {
    expect(checkShareable('纯方法论一句话', null, CTX).shareable).toBe(true)
    expect(checkShareable('花了 $50', null, CTX).shareable).toBe(false)
  })
})

describe('不误伤', () => {
  it('没给名字清单时不瞎猜人名', () => {
    const v = checkShareable('x', '买家 David 说了什么', {})
    expect(v.findings.map(f => f.kind)).not.toContain('person_name')
  })

  it('太短的名字（1 个字）不参与匹配 —— 否则满篇都是命中', () => {
    // 关键：这两个「名字」在正文里**确实出现**。有长度下限才不会命中；
    // 拿掉下限就会把「开头要抓人」里的「人」判成人名泄露。
    const v = checkShareable('这条经验讲的是钩子', '开头要抓人', { personNames: ['人', 'A'] })
    expect(v.shareable).toBe(true)
    expect(v.findings.map(f => f.kind)).not.toContain('person_name')
  })

  it('行业通用词不会因为像客户名就被拦', () => {
    const v = checkShareable('地产广告的钩子要放学区', '学区是地产买家最关心的信息之一。', CTX)
    expect(v.shareable).toBe(true)
  })
})

describe('assertShareable', () => {
  it('通过时不抛', () => {
    expect(() => assertShareable('纯方法论', '为什么', CTX)).not.toThrow()
  })

  it('🔴 不通过时抛，且报错里说清楚改哪里', () => {
    expect(() => assertShareable('x', '30 Kiteroa 每咨询 $6.35', CTX))
      .toThrow(/拒绝写入公共经验池/)
    try {
      assertShareable('x', '30 Kiteroa 每咨询 $6.35', CTX)
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('$6.35')
      expect(msg).toContain('30 Kiteroa')
      expect(msg).toContain('evidence')
    }
  })
})

// ── 回归：当天被隔离的 5 条，脱敏前必须被拦、脱敏后必须放行 ────────────
describe('回归：2026-08-04 隔离的 5 条经验', () => {
  const QUARANTINED: [string, string][] = [
    ['中文素材验证华人需求', '30 Kiteroa 实测：上线中文烧字视频当天即出现中文咨询，且该条为全场最低成本（$6.35/咨询）。'],
    ['IG 在高价住宅表现差', '同一账户同期实测：FB 花 $86.57／触达 1753；IG 花 $14.74／触达 279。'],
    ['欢迎语必须直接给答案', '实测：华人买家 David 收到「你好！请问有什么可以帮助你的?」，随即问「房子的具体地址在哪里?」'],
    ['问候语会照抄广告语种', '实测：中文广告投给不懂中文的买家 Anita 和 Karen，PM 两次手动道歉。'],
    ['AI 改写会删掉合规限定词', '实测：「8月20日前签约，成交时送 $10,000 礼卡」被改写成「签约即送」。'],
  ]

  it('5 条脱敏前全部被拦', () => {
    for (const [lesson, rationale] of QUARANTINED) {
      expect(checkShareable(lesson, rationale, CTX).shareable).toBe(false)
    }
  })

  const REWRITTEN: [string, string][] = [
    ['地产视频广告：中文要烧进画面，不能只写在文案里',
      '中文观众在信息流里先看画面上的字，看到全英文就划走，读不到下面的中文说明。'],
    ['高价住宅广告在 IG 版位明显弱于 FB',
      '同期同账户对比下，IG 的点击率显著低于 FB。单独投 IG 前先小额验证再放量。'],
    ['私信广告的欢迎语要直接给答案，别反问「有什么可以帮你」',
      '开放式问候把获客变成人工客服：每个人都会问同一件本该写在广告里的事。'],
    ['私信广告的问候语照抄该创意自身的语言，不是可单独编辑的字段',
      '同一广告组里混放多语种创意，必然有一批人收到看不懂的问候语。按语言拆组。'],
    ['平台 AI 改写会删掉合规限定词，改变要约含义',
      '限定条件被删掉后会变成更强的承诺，属误导陈述。该选项默认全部勾选，上线前必须逐条核对。'],
  ]

  it('脱敏重写后 5 条全部放行', () => {
    for (const [lesson, rationale] of REWRITTEN) {
      const v = checkShareable(lesson, rationale, CTX)
      expect(v.shareable, `${lesson} → ${JSON.stringify(v.findings)}`).toBe(true)
    }
  })
})

/**
 * 2026-08-05 魏征抽查的回归集。
 *
 * 他当时实测 34 种写法漏 28 种（82%）。一道漏 82% 的闸比没有闸更危险 ——
 * 它让人以为查过了。这一组就是那 34 条，一条都不许再漏。
 */
describe('泄露写法回归集（34 条，一条都不许漏）', () => {
  const MONEY_FORMS = [
    '86.57 NZD', 'NZD 86.57', '86.57 dollars', '＄100', 'spent 86.57 on this',
    'cost per lead 6.35', '1.2k spend', '$86.57', 'NZ$1,250', '3000 元', '八百元',
    'USD 50', '50 AUD', '花了 86 块', '预算 30/天',
  ]
  const COUNT_FORMS = [
    '13 inquiries', '13 enquiries', '13 sign-ups', '13 signups', '13 form fills',
    '13 bookings', '13 appointments', '13 viewings', '13 replies', '13 messages',
    '13 客资', '13 单', '13 个意向', '13 报名', '13 预约', '13 leads',
    '收到 13 个咨询', 'thirteen leads', '13 个买家',
  ]

  // 断言 kind 而不只是「拦住了」：金额被当成「结果数」拦下也算拦住，
  // 但给人的理由就写错了。2026-08-05 变异测试逃逸一次才发现这个盲区 ——
  // 只断言 shareable=false，等于金额那几条规则可以被整条删掉而没人报警。
  it.each(MONEY_FORMS)('金额写法「%s」必须按「金额」拦下', (t) => {
    const v = checkShareable(t, null)
    expect(v.shareable).toBe(false)
    expect(v.findings.map((f) => f.kind)).toContain('money')
  })

  it.each(COUNT_FORMS)('结果数写法「%s」必须被拦', (t) => {
    expect(checkShareable(t, null).shareable).toBe(false)
  })
})

/**
 * 反面：方法论表述不能被误伤。
 *
 * 这组跟上面同等重要 —— 一道谁都过不了的闸，最后的结果是所有人绕开它。
 */
describe('方法论表述必须放行（不能一刀切拦数字）', () => {
  const SAFE = [
    '前 3 秒决定完播率，钩子必须在这里落地',
    '视频长度控制在 15 seconds 以内',
    '同一组里只放 1 language，混语言会让人收到看不懂的问候语',
    '预热期给 7 days 再判断，太早停会杀掉还没跑出量的组',
    '完播率只当淘汰线用，不当赢家判据',
    'Test 2 variants at a time, not more',
    '按 3 pillars 分配预算',
    '重定向组必须显式关掉自动放宽，否则名单形同虚设',
  ]

  it.each(SAFE)('「%s」必须放行', (t) => {
    const v = checkShareable(t, null)
    expect(v.shareable, `误拦：${v.findings.map((f) => f.matched).join('、')}`).toBe(true)
  })
})

describe('同一处不重复报', () => {
  it('`$86.57` 被金额抓到后，不再作为结果数再报一遍', () => {
    const v = checkShareable('每条线索 $86.57', null)
    expect(v.findings.filter((f) => f.kind === 'outcome_count')).toHaveLength(0)
    expect(v.findings.some((f) => f.kind === 'money')).toBe(true)
  })
})
