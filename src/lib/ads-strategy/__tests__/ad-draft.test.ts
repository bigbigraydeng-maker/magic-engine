import { describe, it, expect } from 'vitest'
import {
  validateDraft,
  metaTripletFor,
  describeDraft,
  isApprovableKind,
  isKnownDraftKind,
  DRAFT_PLAY,
  MAX_AUTO_DAILY_BUDGET,
  MAX_MESSENGER_CREATIVES,
  MESSENGER_CTA_TYPE,
  type AdDraft,
} from '../ad-draft'
import { PLAY_CATALOG } from '../play-vocabulary'

function leadDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'c1',
    campaignName: 'Kiteroa 留资',
    adSetName: 'North Shore 买家',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page1',
    leadFormId: 'form1',
    creatives: [
      { name: 'EN', primaryText: 'Brand new four bedroom home', headline: 'Book a viewing', imageHash: 'h1' },
    ],
    ...over,
  }
}

describe('validateDraft — 拦住 ME 自己就能判的错', () => {
  it('齐全的留资草案没问题', () => {
    expect(validateDraft(leadDraft())).toEqual([])
  })

  it('留资广告没挂表单 → 拦（不然它收不到任何联系方式）', () => {
    const p = validateDraft(leadDraft({ leadFormId: undefined }))
    expect(p.map((x) => x.field)).toContain('leadFormId')
  })

  it('没说投给哪里 → 拦（投给全世界不是一个决定）', () => {
    const p = validateDraft(leadDraft({ geoCountries: [] }))
    expect(p.map((x) => x.field)).toContain('geoCountries')
  })

  it('没说跑几天 → 拦（不设终点的广告没人记得关）', () => {
    const p = validateDraft(leadDraft({ durationDays: 0 }))
    expect(p.map((x) => x.field)).toContain('durationDays')
  })

  it(`每天超过 $${MAX_AUTO_DAILY_BUDGET} → 拦`, () => {
    const p = validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET + 1 }))
    expect(p.map((x) => x.field)).toContain('dailyBudget')
  })

  it(`刚好 $${MAX_AUTO_DAILY_BUDGET} 放行 —— 边界不能反着来`, () => {
    expect(validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET }))).toEqual([])
  })

  it('视频广告没给视频 → 拦', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y' }],
      }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].videoId')
  })

  it('视频广告不需要表单', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }],
      }),
    )
    expect(p).toEqual([])
  })

  it('正文空白（只有空格）也算空', () => {
    const p = validateDraft(
      leadDraft({ creatives: [{ name: 'E', primaryText: '   ', headline: 'h', imageHash: 'h1' }] }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].primaryText')
  })

  it('年龄下限 18 岁以下 → 拦', () => {
    expect(validateDraft(leadDraft({ ageMin: 16 })).map((x) => x.field)).toContain('ageMin')
  })
})

describe('metaTripletFor — 三件套写死，配错就是「名字叫留资、实际买曝光」', () => {
  it('留资 → OUTCOME_LEADS / LEAD_GENERATION，落点在广告里不是私信', () => {
    const t = metaTripletFor('lead_form')
    expect(t.objective).toBe('OUTCOME_LEADS')
    expect(t.optimizationGoal).toBe('LEAD_GENERATION')
    expect(t.destinationType).toBe('ON_AD')
  })

  it('养受众 → THRUPLAY，落点 ON_VIDEO（少了它 Meta 不给按完播优化）', () => {
    const t = metaTripletFor('video_thruplay')
    expect(t.optimizationGoal).toBe('THRUPLAY')
    expect(t.destinationType).toBe('ON_VIDEO')
  })

  it('原来那两种草案的落点仍然都不是私信 —— 私信是单独的类型 messenger_conversation', () => {
    for (const k of ['lead_form', 'video_thruplay'] as const) {
      expect(['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT']).not.toContain(
        metaTripletFor(k).destinationType,
      )
    }
  })
})

describe('describeDraft — 审批页第一行必须说清花多少', () => {
  it('算的是总花费上限，不是每天', () => {
    expect(describeDraft(leadDraft({ dailyBudget: 30, durationDays: 7 }))).toContain('$210')
  })

  it('留资和养受众说的是两件事', () => {
    expect(describeDraft(leadDraft())).toContain('联系方式')
    expect(
      describeDraft(
        leadDraft({
          kind: 'video_thruplay',
          creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v' }],
        }),
      ),
    ).toContain('受众')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 私信（点击后进 Messenger 对话）类型
// ─────────────────────────────────────────────────────────────────────────────

function messengerDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'messenger_conversation',
    clientId: 'c1',
    campaignName: 'DM campaign',
    adSetName: 'DM set',
    dailyBudget: 20,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page1',
    creatives: [
      {
        name: 'A', primaryText: 'Join our Christmas tour', headline: 'Message us',
        videoId: 'v1', thumbnailImageHash: 'th1', language: 'en',
      },
    ],
    ...over,
  }
}

const fields = (d: AdDraft) => validateDraft(d).map((x) => x.field)

describe('messenger_conversation — metaTripletFor / 打法 / 描述', () => {
  it('四个 Meta 参数写死：互动目标 / 对话优化 / 落点 Messenger', () => {
    expect(metaTripletFor('messenger_conversation')).toEqual({
      objective: 'OUTCOME_ENGAGEMENT',
      optimizationGoal: 'CONVERSATIONS',
      billingEvent: 'IMPRESSIONS',
      destinationType: 'MESSENGER',
    })
  })

  it('按钮类型只定义在一个常量里', () => {
    expect(MESSENGER_CTA_TYPE).toBe('MESSAGE_PAGE')
  })

  it('打法对到 messenger_direct，而且这个打法在词表里真的存在', () => {
    expect(DRAFT_PLAY.messenger_conversation).toBe('messenger_direct')
    expect(PLAY_CATALOG[DRAFT_PLAY.messenger_conversation]).toBeDefined()
  })

  it('陌生类型直接抛，不静默落到某个兜底分支', () => {
    expect(() => metaTripletFor('nope' as never)).toThrow()
    expect(() => metaTripletFor('constructor' as never)).toThrow()
  })

  it('审批页第一行说的是私信，不是留资也不是养受众', () => {
    const t = describeDraft(messengerDraft())
    expect(t).toContain('私信')
    expect(t).toContain('$140')
  })

  it('请求体里的 kind 是任意值时描述也不炸（它在校验之前就会被调）', () => {
    expect(() => describeDraft(messengerDraft({ kind: 'constructor' as never }))).not.toThrow()
    expect(describeDraft(messengerDraft({ kind: 'constructor' as never }))).toContain('不认识')
  })
})

describe('validateDraft — 视频留资要封面', () => {
  const lead = (c: object) => ({
    kind: 'lead_form', clientId: 'c1', campaignName: 'n', adSetName: 'a', dailyBudget: 1, durationDays: 1,
    geoCountries: ['NZ'], pageId: 'p', leadFormId: 'f',
    creatives: [{ name: 'A', primaryText: 'x', headline: 'y', ...c }],
  }) as AdDraft

  it('视频没封面 → 拒；给 hash 或 https 链接 → 放行；只给图不要封面', () => {
    expect(fields(lead({ videoId: 'v' }))).toContain('creatives[0].thumbnail')
    expect(fields(lead({ videoId: 'v', thumbnailUrl: 'http://a.test/t.jpg' }))).toContain('creatives[0].thumbnail')
    expect(validateDraft(lead({ videoId: 'v', thumbnailImageHash: 'h' }))).toEqual([])
    expect(validateDraft(lead({ videoId: 'v', thumbnailUrl: 'https://a.test/t.jpg' }))).toEqual([])
    expect(validateDraft(lead({ imageHash: 'h' }))).toEqual([])
  })
})

describe('validateDraft — 私信类型', () => {
  it('齐全的私信草案没问题；不要求表单和落地页', () => {
    expect(validateDraft(messengerDraft())).toEqual([])
  })

  it('缩略图缺失 → 拒（Meta 的视频广告要封面，没有「缺了用首帧」这回事）', () => {
    const d = messengerDraft({
      creatives: [{ name: 'A', primaryText: 'x', headline: 'y', videoId: 'v1', language: 'en' }],
    })
    expect(fields(d)).toContain('creatives[0].thumbnail')
  })

  it('缩略图链接不是 https → 拒；https 放行；给 hash 也放行', () => {
    const mk = (c: object) => messengerDraft({
      creatives: [{ name: 'A', primaryText: 'x', headline: 'y', videoId: 'v1', language: 'en', ...c }],
    })
    expect(fields(mk({ thumbnailUrl: 'http://a.test/t.jpg' }))).toContain('creatives[0].thumbnail')
    expect(fields(mk({ thumbnailUrl: 'not a url' }))).toContain('creatives[0].thumbnail')
    expect(validateDraft(mk({ thumbnailUrl: 'https://a.test/t.jpg' }))).toEqual([])
    expect(validateDraft(mk({ thumbnailImageHash: 'h' }))).toEqual([])
  })

  it('没给视频 → 拒', () => {
    const d = messengerDraft({
      creatives: [{ name: 'A', primaryText: 'x', headline: 'y', thumbnailImageHash: 'h', language: 'en' }],
    })
    expect(fields(d)).toContain('creatives[0].videoId')
  })

  it('一语言一组：声明的语言不一致 → 拒', () => {
    const base = { name: 'A', primaryText: 'Kia ora', headline: 'Hi', videoId: 'v', thumbnailImageHash: 'h' }
    const d = messengerDraft({
      creatives: [{ ...base, language: 'en' }, { ...base, name: 'B', language: 'mi' }],
    })
    expect(fields(d)).toContain('creatives.language')
  })

  it('语言要写代码：缺了拒，English 这种拒，en-NZ 和 en 算同一种', () => {
    const base = { name: 'A', primaryText: 'x', headline: 'y', videoId: 'v', thumbnailImageHash: 'h' }
    expect(fields(messengerDraft({ creatives: [{ ...base }] }))).toContain('creatives.language')
    expect(fields(messengerDraft({ creatives: [{ ...base, language: 'English' }] })))
      .toContain('creatives.language')
    // 三位码 eng 和 en 会被当成两种语言，所以不收（只收两位）
    expect(fields(messengerDraft({ creatives: [{ ...base, language: 'eng' }] })))
      .toContain('creatives.language')
    expect(validateDraft(messengerDraft({
      creatives: [{ ...base, language: 'en-NZ' }, { ...base, name: 'B', language: 'EN' }],
    }))).toEqual([])
  })

  it('一语言一组：声明都写 en，但文字体系混了中英 → 第二道拦住', () => {
    const base = { name: 'A', videoId: 'v', thumbnailImageHash: 'h', language: 'en' }
    const d = messengerDraft({
      creatives: [
        { ...base, primaryText: 'Join our Christmas tour', headline: 'Message us' },
        { ...base, name: 'B', primaryText: '圣诞节新西兰南北岛双岛游，现在私信我们', headline: '发消息给我们' },
      ],
    })
    expect(fields(d)).toContain('creatives.script')
  })

  it(`创意超过 ${MAX_MESSENGER_CREATIVES} 条 → 拒（写操作次数和等转码的时间都随它涨）`, () => {
    const c = { name: 'A', primaryText: 'x', headline: 'y', videoId: 'v', thumbnailImageHash: 'h', language: 'en' }
    expect(fields(messengerDraft({ creatives: Array(MAX_MESSENGER_CREATIVES + 1).fill(c) })))
      .toContain('creatives')
    expect(validateDraft(messengerDraft({ creatives: Array(MAX_MESSENGER_CREATIVES).fill(c) }))).toEqual([])
  })

  it('每天超过上限仍然拦（私信类型不豁免）', () => {
    expect(fields(messengerDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET + 1 }))).toContain('dailyBudget')
  })
})

describe('validateDraft — 请求体形状（它是 body as AdDraft，没人保证过）', () => {
  it('陌生 kind → 拒，不被当成别的类型默默建出去', () => {
    expect(fields(messengerDraft({ kind: 'weird' as never }))).toEqual(['kind'])
    expect(fields(messengerDraft({ kind: 'constructor' as never }))).toEqual(['kind'])
    expect(fields(messengerDraft({ kind: undefined as never }))).toEqual(['kind'])
  })

  it('可选字段不是字符串(language: 5 / videoId: 5 …) → 返回问题，不抛 500', () => {
    for (const k of ['language', 'videoId', 'description', 'thumbnailUrl', 'thumbnailImageHash', 'imageHash']) {
      const d = messengerDraft({
        creatives: [{ name: 'A', primaryText: 'x', headline: 'y', videoId: 'v', thumbnailImageHash: 'h', language: 'en', [k]: 5 }] as never,
      })
      expect(() => validateDraft(d), k).not.toThrow()
      expect(fields(d), k).toEqual(['creatives'])
    }
  })

  it('creatives 不是数组 / 条目不是对象 / 正文不是字符串 → 返回问题，不抛 500', () => {
    expect(() => validateDraft(messengerDraft({ creatives: undefined as never }))).not.toThrow()
    expect(fields(messengerDraft({ creatives: undefined as never }))).toEqual(['creatives'])
    expect(fields(messengerDraft({ creatives: [null] as never }))).toEqual(['creatives'])
    expect(fields(messengerDraft({ creatives: [{ name: 'A', primaryText: 5, headline: 'h' }] as never })))
      .toEqual(['creatives'])
  })
})

describe('isApprovableKind — ME 的「开」按钮只认白名单', () => {
  it('留资和养受众可以开', () => {
    expect(isApprovableKind('lead_form')).toBe(true)
    expect(isApprovableKind('video_thruplay')).toBe(true)
  })

  it('私信不可以开（要等 PM 授权 + 总预算检查）', () => {
    expect(isApprovableKind('messenger_conversation')).toBe(false)
  })

  it('缺失 / 陌生值 / 原型链上的名字一律不可以', () => {
    for (const k of [undefined, null, '', 'weird', 'constructor', 'toString', '__proto__', 5]) {
      expect(isApprovableKind(k), String(k)).toBe(false)
    }
  })

  it('isKnownDraftKind 认三种、不认原型链上的名字', () => {
    expect(['lead_form', 'video_thruplay', 'messenger_conversation'].every(isKnownDraftKind)).toBe(true)
    expect(isKnownDraftKind('hasOwnProperty')).toBe(false)
  })
})
