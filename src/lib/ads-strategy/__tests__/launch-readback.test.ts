import { describe, it, expect } from 'vitest'
import { checkLaunch, renderReadback, type LaunchReadbackInput } from '../launch-readback'

const base = (over: Partial<LaunchReadbackInput> = {}): LaunchReadbackInput => ({
  adSet: {
    adSetId: 'AS1',
    adSetName: '三语专测 · Auckland 全域',
    optimizationGoal: 'CONVERSATIONS',
    targeting: { geoNames: ['Auckland Region'] },
    creatives: [
      { adId: 'A1', adName: 'Ad F · 中文', buyerFacingText: ['Rangitoto 学区 · 全新四房独立屋'] },
    ],
    ...over.adSet,
  },
  ...over,
})

describe('checkLaunch — 坑 1：私信广告混语言', () => {
  it('🔴 同一私信广告组里中英创意混放 → blocker', () => {
    const r = checkLaunch(base({
      adSet: {
        adSetId: 'AS1', adSetName: '三语专测', optimizationGoal: 'CONVERSATIONS',
        targeting: {},
        creatives: [
          { adId: 'A1', adName: 'Ad F · 中文', buyerFacingText: ['Rangitoto 学区 全新四房'] },
          { adId: 'A2', adName: 'Ad D · EN',  buyerFacingText: ['Brand-new 4-bed freestanding home'] },
        ],
      },
    }))
    expect(r.findings.map(f => f.code)).toContain('mixed_script_messaging_adset')
    expect(r.safeToActivate).toBe(false)
  })

  it('同语言的私信广告组不报警', () => {
    const r = checkLaunch(base({
      adSet: {
        adSetId: 'AS1', adSetName: 'EN only', optimizationGoal: 'CONVERSATIONS', targeting: {},
        creatives: [
          { adId: 'A1', adName: 'EN a', buyerFacingText: ['Brand-new 4-bed home'] },
          { adId: 'A2', adName: 'EN b', buyerFacingText: ['Move in now. Offers over $1.25M'] },
        ],
      },
    }))
    expect(r.findings.map(f => f.code)).not.toContain('mixed_script_messaging_adset')
  })

  it('非私信目标即使混语言也不报这条 —— 表单/看视频不会自动发问候语', () => {
    const r = checkLaunch(base({
      adSet: {
        adSetId: 'AS1', adSetName: '表单', optimizationGoal: 'LEAD_GENERATION', targeting: {},
        creatives: [
          { adId: 'A1', adName: 'cn', buyerFacingText: ['全新四房'] },
          { adId: 'A2', adName: 'en', buyerFacingText: ['Brand-new home'] },
        ],
      },
    }))
    expect(r.findings.map(f => f.code)).not.toContain('mixed_script_messaging_adset')
  })

  it('韩文创意跟英文创意混同样报警', () => {
    const r = checkLaunch(base({
      adSet: {
        adSetId: 'AS1', adSetName: 'KR+EN', optimizationGoal: 'CONVERSATIONS', targeting: {},
        creatives: [
          { adId: 'A1', adName: 'kr', buyerFacingText: ['랑기토토 칼리지 학군 신축 단독주택 지금 입주 가능합니다'] },
          { adId: 'A2', adName: 'en', buyerFacingText: ['Brand-new home'] },
        ],
      },
    }))
    expect(r.findings.map(f => f.code)).toContain('mixed_script_messaging_adset')
  })
})

describe('checkLaunch — 坑 2：名字说重定向，设置被放宽', () => {
  const retarget = (targeting: LaunchReadbackInput['adSet']['targeting']): LaunchReadbackInput => ({
    adSet: {
      adSetId: 'AS9', adSetName: '私约看房 · 暖池重定向', optimizationGoal: 'CONVERSATIONS',
      targeting,
      creatives: [{ adId: 'A1', adName: 'cn', buyerFacingText: ['全新四房'] }],
    },
    claimsRetargeting: true,
  })

  it('🔴 允许投给名单外的人 → blocker', () => {
    const r = checkLaunch(retarget({ customAudienceRelaxed: true, customAudienceIds: ['X'] }))
    expect(r.findings.map(f => f.code)).toContain('retargeting_relaxed')
    expect(r.safeToActivate).toBe(false)
  })

  it('🔴 优势受众开着 → blocker', () => {
    const r = checkLaunch(retarget({ advantageAudience: true, customAudienceIds: ['X'] }))
    expect(r.findings.map(f => f.code)).toContain('retargeting_advantage_audience')
  })

  it('🔴 号称重定向却一个名单都没挂 → blocker', () => {
    const r = checkLaunch(retarget({ customAudienceIds: [] }))
    expect(r.findings.map(f => f.code)).toContain('retargeting_without_audience')
  })

  it('设置正确的重定向组不报这三条', () => {
    const r = checkLaunch(retarget({
      customAudienceIds: ['X'], customAudienceRelaxed: false, advantageAudience: false,
    }))
    const codes = r.findings.map(f => f.code)
    expect(codes).not.toContain('retargeting_relaxed')
    expect(codes).not.toContain('retargeting_advantage_audience')
    expect(codes).not.toContain('retargeting_without_audience')
  })

  it('没声称重定向的组，不拿这三条去要求它', () => {
    const r = checkLaunch(base({ adSet: { ...base().adSet, targeting: { advantageAudience: true } } }))
    expect(r.findings.map(f => f.code)).not.toContain('retargeting_advantage_audience')
  })
})

describe('checkLaunch — 坑 3/4/5', () => {
  it('⚠️ Meta 自动挂了相似人群 → warn，但不拦', () => {
    const r = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { implicitLookalikeIds: ['LAL1'] } },
    }))
    expect(r.findings.map(f => f.code)).toContain('implicit_lookalike_attached')
    expect(r.safeToActivate).toBe(true)
  })

  it('🔴 投放地区跟房源所在地对不上 → blocker', () => {
    const r = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { geoNames: ['New Zealand'] } },
      expectedGeo: 'Auckland',
    }))
    expect(r.findings.map(f => f.code)).toContain('geo_mismatch')
    expect(r.safeToActivate).toBe(false)
  })

  it('地区对得上就不报（包含匹配即可）', () => {
    const r = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { geoNames: ['Auckland Region'] } },
      expectedGeo: 'Auckland',
    }))
    expect(r.findings.map(f => f.code)).not.toContain('geo_mismatch')
  })

  it('给不出房源所在地就跳过地区检查，不瞎判', () => {
    const r = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { geoNames: ['New Zealand'] } },
      expectedGeo: null,
    }))
    expect(r.findings.map(f => f.code)).not.toContain('geo_mismatch')
  })

  it('⚠️ 回读不到买家可见文字 → warn（可能是真空，也可能是没取全）', () => {
    const r = checkLaunch(base({
      adSet: {
        ...base().adSet,
        creatives: [{ adId: 'A1', adName: '空', buyerFacingText: ['', '   '] }],
      },
    }))
    expect(r.findings.map(f => f.code)).toContain('creative_without_buyer_text')
  })
})

describe('renderReadback', () => {
  it('把买家会看到的原文放在最前面 —— 这比任何规则都管用', () => {
    const out = renderReadback(checkLaunch(base({
      adSet: {
        ...base().adSet,
        creatives: [{ adId: 'A1', adName: 'Ad F', buyerFacingText: ['Boris，你好！请问有什么可以帮助你的?'] }],
      },
    })))
    expect(out.indexOf('买家实际会看到的内容')).toBeLessThan(out.indexOf('Boris，你好'))
    expect(out).toContain('Boris，你好！请问有什么可以帮助你的?')
  })

  it('有 blocker 时结论是「不要开」', () => {
    const out = renderReadback(checkLaunch(base({
      adSet: {
        adSetId: 'AS1', adSetName: 'mixed', optimizationGoal: 'CONVERSATIONS', targeting: {},
        creatives: [
          { adId: 'A1', adName: 'cn', buyerFacingText: ['全新四房'] },
          { adId: 'A2', adName: 'en', buyerFacingText: ['Brand-new home'] },
        ],
      },
    })))
    expect(out).toContain('不要开')
  })

  it('没撞坑时明说没撞坑', () => {
    expect(renderReadback(checkLaunch(base()))).toContain('没撞上已知的坑')
  })

  it('事故来源不带客户名 / 真人姓名 / 金额 —— 回读会原样给任何客户看（红线 2）', () => {
    // 第一份：撞上除「读不到设置」以外的全部坑；第二份：两项设置读不到 + 落点未知。
    const all = checkLaunch({
      adSet: {
        adSetId: 'AS1', adSetName: 'x', optimizationGoal: 'CONVERSATIONS',
        targeting: {
          customAudienceRelaxed: true, advantageAudience: true, customAudienceIds: [],
          implicitLookalikeIds: ['LAL1'], geoNames: ['New Zealand'],
        },
        creatives: [
          { adId: 'A1', adName: 'cn', buyerFacingText: ['全新四房'] },
          { adId: 'A2', adName: 'en', buyerFacingText: ['Brand-new home'] },
          { adId: 'A3', adName: 'empty', buyerFacingText: [''] },
        ],
      },
      claimsRetargeting: true,
      expectedGeo: 'Auckland',
    })
    const unknowns = checkLaunch({
      adSet: {
        adSetId: 'AS2', adSetName: 'y', optimizationGoal: 'LINK_CLICKS', targeting: {},
        creatives: [
          { adId: 'B1', adName: 'cn', buyerFacingText: ['全新四房'] },
          { adId: 'B2', adName: 'en', buyerFacingText: ['Brand-new home'] },
        ],
      },
      claimsRetargeting: true,
    })
    const codes = [...all.findings, ...unknowns.findings].map(f => f.code)
    for (const c of [
      'mixed_script_messaging_adset', 'messaging_destination_unknown', 'retargeting_relaxed',
      'retargeting_advantage_audience', 'retargeting_without_audience', 'retargeting_relaxation_unknown',
      'retargeting_advantage_unknown', 'implicit_lookalike_attached', 'geo_mismatch', 'creative_without_buyer_text',
    ]) expect(codes).toContain(c)

    const out = renderReadback(all) + renderReadback(unknowns)
    for (const banned of ['Roman', 'Boris', 'Richard', 'Jude', '$1.25M', '$5.88', 'Kiteroa']) {
      expect(out, `回读输出含「${banned}」`).not.toContain(banned)
    }
  })
})

// ── 回归：把 2026-08-04 那条真实广告喂进去，必须被拦下 ──────────────
describe('回归：2026-08-04 Roman 的真实配置', () => {
  it('三语专测组（中/英/韩混放 + 私信目标）必须判定不可上线', () => {
    const r = checkLaunch({
      adSet: {
        adSetId: '120251880863820589',
        adSetName: '30 Kiteroa · 三语专测 · Auckland 全域 · FB only',
        optimizationGoal: 'CONVERSATIONS',
        targeting: { geoNames: ['Auckland Region'] },
        creatives: [
          { adId: 'F',  adName: 'Ad F · 中文 · Rangitoto 学区', buyerFacingText: ['Rangitoto College 学区 · Rothesay Bay 全新 4 房独立屋'] },
          { adId: 'E2', adName: 'Ad E2 · 三语',                 buyerFacingText: ['Brand-new 4-bed freestanding home in the Rangitoto College zone.'] },
        ],
      },
      expectedGeo: 'Auckland',
    })
    expect(r.safeToActivate).toBe(false)
    // 事故来源会原样输出给任何客户看 —— 只留事故形状，不带客户名 / 真人姓名（红线 2）。
    expect(r.findings[0].learnedFrom).toContain('得罪 5 人')
    expect(r.findings[0].learnedFrom).not.toContain('Boris')
  })
})

// ── 魏征 2026-08-04 抽查抓出的两类错，逐条钉住 ────────────────────────
import { dominantScript } from '../launch-readback'

const ms = (creatives: { adId: string; adName: string; buyerFacingText: string[] }[]) =>
  checkLaunch({
    adSet: { adSetId: 'AS', adSetName: 'x', optimizationGoal: 'CONVERSATIONS', targeting: {}, creatives },
  })

describe('语种检测 —— 魏征抽查修正', () => {
  it('🔴 中文 + 韩文同组必须报警（原版把两者归成一桶，完全不响）', () => {
    const r = ms([
      { adId: 'F', adName: 'Ad F · 中文',  buyerFacingText: ['Rangitoto College 学区 全新四房独立屋'] },
      { adId: 'H', adName: 'Ad H · KR',    buyerFacingText: ['Rangitoto College 학군 신축 단독주택입니다'] },
    ])
    expect(r.findings.map(f => f.code)).toContain('mixed_script_messaging_adset')
    expect(r.findings[0].message).toContain('韩文')
    expect(r.safeToActivate).toBe(false)
  })

  it('🔴 中文创意里夹一行电话号码，不该误报（原版会报 blocker）', () => {
    const r = ms([
      { adId: 'A', adName: 'cn', buyerFacingText: ['Rothesay Bay 全新四房独立屋', 'WhatsApp: +64 21 555 123'] },
      { adId: 'B', adName: 'cn2', buyerFacingText: ['产权与验收已下发，可即刻入住'] },
    ])
    expect(r.findings.map(f => f.code)).not.toContain('mixed_script_messaging_adset')
  })

  it('🔴 中文创意里夹一行 emoji，不该误报', () => {
    const r = ms([
      { adId: 'A', adName: 'cn', buyerFacingText: ['全新四房独立屋', '🔥🔥🔥'] },
      { adId: 'B', adName: 'cn2', buyerFacingText: ['学区房，即刻入住'] },
    ])
    expect(r.findings.map(f => f.code)).not.toContain('mixed_script_messaging_adset')
  })

  it('🔴 单条三语创意独自一组，不该报（组里只有一条，拆不了）', () => {
    const r = ms([
      { adId: 'E', adName: '三语', buyerFacingText: ['Brand-new 4-bed home 全新四房 신축 주택'] },
    ])
    expect(r.findings.map(f => f.code)).not.toContain('mixed_script_messaging_adset')
  })

  it('中英同组仍然报（原有能力不能丢）', () => {
    const r = ms([
      { adId: 'A', adName: 'cn', buyerFacingText: ['全新四房独立屋，学区好'] },
      { adId: 'B', adName: 'en', buyerFacingText: ['Brand-new four bedroom freestanding home'] },
    ])
    expect(r.findings.map(f => f.code)).toContain('mixed_script_messaging_adset')
  })

  it('🔴 optimizationGoal 小写也要拦（魏征 M6：删掉 toUpperCase 原来零测试报警）', () => {
    const r = checkLaunch({
      adSet: {
        adSetId: 'AS', adSetName: 'x', optimizationGoal: 'conversations', targeting: {},
        creatives: [
          { adId: 'A', adName: 'cn', buyerFacingText: ['全新四房独立屋'] },
          { adId: 'B', adName: 'en', buyerFacingText: ['Brand-new home here'] },
        ],
      },
    })
    expect(r.findings.map(f => f.code)).toContain('mixed_script_messaging_adset')
  })
})

describe('dominantScript', () => {
  it.each([
    [['全新四房独立屋'], 'han'],
    [['신축 단독주택입니다'], 'hangul'],
    [['Brand-new home'], 'latin'],
    [['こちらのおうちはとてもすてきです'], 'kana'],
  ])('%s → %s', (texts, expected) => {
    expect(dominantScript(texts as string[])).toBe(expected)
  })

  it('没有任何文字字符 → null（纯电话/emoji/URL 不参与判定）', () => {
    expect(dominantScript(['+64 21 555 123'])).toBeNull()
    expect(dominantScript(['🔥🔥🔥'])).toBeNull()
    expect(dominantScript([''])).toBeNull()
  })

  it('按字符数取多数：中文为主夹几个英文词 → han', () => {
    expect(dominantScript(['Rangitoto College 学区 · Rothesay Bay 全新四房独立屋，产权已下发'])).toBe('han')
  })
})
