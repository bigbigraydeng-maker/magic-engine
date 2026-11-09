/**
 * 草案生成器的测试。
 *
 * 守的核心只有一条：**编造在结构上不可能**。
 * 具体表现为：事实不全就抛、价格原样带出、战绩原文照抄不改写、
 * 一个草案只有一种语言。
 */
import { describe, it, expect } from 'vitest'
import {
  buildBuyerLeadDraft,
  buildSellerThruPlayDraft,
  traceClaims,
  NotGroundedError,
  BannedPhraseError,
  type ListingFacts,
  type AgentFacts,
  type BuildOptions,
} from '../listing-draft-builder'
import { validateDraft } from '../ad-draft'
import { dominantScript } from '../launch-readback'

const LISTING: ListingFacts = {
  address: '9-11 Schnapper Rock Road',
  suburb: 'Schnapper Rock',
  bedrooms: 3,
  priceLabel: '$885,000',
  status: 'On Sale',
  sourceUrl: 'https://www.romanhu.com/properties',
}

const AGENT: AgentFacts = {
  displayName: 'Roman Hu',
  achievements: [
    'No.1 Listing Agent | Royal Heights Branch 2022-2023',
    'Best Customer Service | Royal Heights Branch 2022-2023',
  ],
  serviceArea: 'Central and West Auckland',
  sourceUrl: 'https://www.romanhu.com',
}

const OPTS: BuildOptions = {
  clientId: 'c1',
  pageId: 'p1',
  lang: 'zh',
  dailyBudget: 25,
  durationDays: 7,
  geoCountries: ['NZ'],
  leadFormId: 'form1',
  imageHash: 'h1',
}

describe('buildBuyerLeadDraft', () => {
  it('生成的草案本身就是合法的（能直接送去建）', () => {
    expect(validateDraft(buildBuyerLeadDraft(LISTING, AGENT, OPTS))).toEqual([])
  })

  it('价格原样带出 —— 不改写、不四舍五入', () => {
    const d = buildBuyerLeadDraft(LISTING, AGENT, OPTS)
    expect(d.creatives[0].primaryText).toContain('$885,000')
  })

  it('`Nego.` 这种非数字价格也原样带出，不被翻译成「面议价」之类', () => {
    const d = buildBuyerLeadDraft({ ...LISTING, priceLabel: 'Nego.' }, AGENT, OPTS)
    expect(d.creatives[0].primaryText).toContain('Nego.')
  })

  it('拿不到房型数 → 整句不出现，不写「多房」这种含糊话', () => {
    const d = buildBuyerLeadDraft({ ...LISTING, bedrooms: undefined }, AGENT, OPTS)
    expect(d.creatives[0].primaryText).not.toMatch(/房型|bedroom|多房/)
  })

  it('拿不到价格 → 整句不出现，不写「价格面议」', () => {
    const d = buildBuyerLeadDraft({ ...LISTING, priceLabel: undefined }, AGENT, OPTS)
    expect(d.creatives[0].primaryText).not.toContain('价格')
  })

  it('没给来源链接 → 抛（事实不可溯不许投放）', () => {
    expect(() => buildBuyerLeadDraft({ ...LISTING, sourceUrl: '' }, AGENT, OPTS)).toThrow(
      NotGroundedError,
    )
  })

  it('没有图也没有视频 → 抛（素材要先传到 Meta 才有 id）', () => {
    expect(() =>
      buildBuyerLeadDraft(LISTING, AGENT, { ...OPTS, imageHash: undefined }),
    ).toThrow(NotGroundedError)
  })

  it('没给表单 id → 抛（它收不到任何联系方式）', () => {
    expect(() =>
      buildBuyerLeadDraft(LISTING, AGENT, { ...OPTS, leadFormId: undefined }),
    ).toThrow(NotGroundedError)
  })

  it('一个草案只有一种语言 —— 中文那份里不混英文创意', () => {
    const zh = buildBuyerLeadDraft(LISTING, AGENT, { ...OPTS, lang: 'zh' })
    expect(zh.creatives).toHaveLength(1)
    // 地址本身是英文，所以只检查草案里没有第二条别的语言的创意
    const en = buildBuyerLeadDraft(LISTING, AGENT, { ...OPTS, lang: 'en' })
    expect(dominantScript([en.creatives[0].primaryText, en.creatives[0].headline])).toBe('latin')
  })

  it('组名如实说明它在做什么（名字骗人是那次事故的起点）', () => {
    const d = buildBuyerLeadDraft(LISTING, AGENT, OPTS)
    expect(d.adSetName).toContain('表单留资')
    expect(d.adSetName).not.toMatch(/重定向|暖池/)
  })
})

describe('buildSellerThruPlayDraft', () => {
  it('没视频 → 抛（没视频就没有完播，这条草案没有意义）', () => {
    expect(() => buildSellerThruPlayDraft(AGENT, OPTS)).toThrow(NotGroundedError)
  })

  it('战绩原文照抄 —— 不许把「分行第一」变成「奥克兰第一」', () => {
    const d = buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1' })
    expect(d.creatives[0].primaryText).toContain(
      'No.1 Listing Agent | Royal Heights Branch 2022-2023',
    )
    expect(d.creatives[0].primaryText).not.toMatch(/奥克兰第一|Auckland'?s? No\.?1/i)
  })

  it('养受众的广告里不出现房价 —— 它不是在卖某一套房', () => {
    const d = buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1' })
    expect(d.creatives[0].primaryText).not.toMatch(/\$[\d,]+/)
  })

  it('生成的草案本身合法', () => {
    expect(validateDraft(buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1' }))).toEqual([])
  })

  it('战绩最多带 2 条 —— 一屏读不完的战绩等于没战绩', () => {
    const many = { ...AGENT, achievements: ['a1', 'a2', 'a3', 'a4'] }
    const d = buildSellerThruPlayDraft(many, { ...OPTS, videoId: 'v1' })
    expect(d.creatives[0].primaryText).not.toContain('a3')
  })
})

describe('traceClaims — 逐句标可溯来源（红线要求）', () => {
  it('事实句标成官网可溯，行为邀请句标成不含事实主张', () => {
    const d = buildBuyerLeadDraft(LISTING, AGENT, OPTS)
    const t = traceClaims(d, { listing: LISTING, agent: AGENT })
    const priceLine = t.find((x) => x.line.includes('$885,000'))!
    expect(priceLine.source).toContain('官网可溯')
    const cta = t.find((x) => x.line.includes('留个联系方式'))!
    expect(cta.source).toContain('不含事实主张')
  })

  it('每一句都被标到，一句不漏', () => {
    const d = buildBuyerLeadDraft(LISTING, AGENT, OPTS)
    const t = traceClaims(d, { listing: LISTING, agent: AGENT })
    const lines = d.creatives[0].primaryText.split('\n').filter((s) => s.trim())
    expect(t.length).toBeGreaterThanOrEqual(lines.length)
  })
})

describe('禁用词硬闸 —— 广告是付费对外的，命中直接不出稿', () => {
  // 2026-08-05 真实场景：Roman 从 Barfoot & Thompson Royal Heights 转到
  // Ray White Mission Bay，但他官网上还全是旧行资料。照着官网抓事实生成广告，
  // 就会把前东家的品牌印在他自己的付费物料上。
  const OLD_AGENCY = ['Barfoot & Thompson', 'Royal Heights', 'barfoot.co.nz']

  it('战绩里带前东家分行名 → 拒绝出稿', () => {
    expect(() =>
      buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1', bannedPhrases: OLD_AGENCY }),
    ).toThrow(BannedPhraseError)
  })

  it('报错里说清是哪个词命中，不是一句「有问题」', () => {
    try {
      buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1', bannedPhrases: OLD_AGENCY })
      throw new Error('应该抛才对')
    } catch (e) {
      expect(e).toBeInstanceOf(BannedPhraseError)
      expect((e as BannedPhraseError).hits).toContain('Royal Heights')
    }
  })

  it('大小写不敏感 —— `royal heights` 一样拦', () => {
    const a = { ...AGENT, achievements: ['no.1 listing agent | royal heights branch 2022-2023'] }
    expect(() =>
      buildSellerThruPlayDraft(a, { ...OPTS, videoId: 'v1', bannedPhrases: OLD_AGENCY }),
    ).toThrow(BannedPhraseError)
  })

  it('换成不带前东家的战绩 → 正常出稿', () => {
    const clean = {
      ...AGENT,
      achievements: ['NZ government RBPs certified digital marketing expert'],
    }
    const d = buildSellerThruPlayDraft(clean, {
      ...OPTS, videoId: 'v1', bannedPhrases: OLD_AGENCY,
    })
    expect(d.creatives[0].primaryText).toContain('RBPs certified')
  })

  it('留资广告同样过这道闸（不是只有卖家向那条查）', () => {
    const dirty = { ...LISTING, suburb: 'Royal Heights' }
    expect(() =>
      buildBuyerLeadDraft(dirty, AGENT, { ...OPTS, bannedPhrases: OLD_AGENCY }),
    ).toThrow(BannedPhraseError)
  })

  it('禁用词只出现在标题里也要拦 —— 标题同样是买家读到的字', () => {
    // 卖家向的标题是固定话术「现在是不是放盘的时候」，正文里没有「放盘」二字。
    // 有的客户会禁「放盘」这类措辞，那这条就必须靠查标题才拦得住。
    expect(() =>
      buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1', bannedPhrases: ['放盘'] }),
    ).toThrow(BannedPhraseError)
  })

  it('没给禁用词就不拦（老调用方不受影响）', () => {
    expect(() => buildSellerThruPlayDraft(AGENT, { ...OPTS, videoId: 'v1' })).not.toThrow()
  })
})
