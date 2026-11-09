import { describe, it, expect } from 'vitest'
import {
  admissibleIdentifiersForAnswer,
  buildClientIdentifiers,
  isClientBrand,
  resolveClientBrandRank,
} from '../client-brand-match'

describe('buildClientIdentifiers', () => {
  it('includes brand, aliases, domain host and domain root', () => {
    expect(
      buildClientIdentifiers({
        brandName: 'CTS Tours',
        domain: 'https://www.ctstours.co.nz/',
        aliases: ['China Travel Service'],
      })
      // Brand name and domain come before aliases: a name that is both keeps
      // the stronger (non-alias) source when duplicates collapse.
    ).toEqual(['cts tours', 'ctstours co nz', 'ctstours', 'china travel service'])
  })

  it('adds the leading segment of a "Person — Office" composite name', () => {
    expect(buildClientIdentifiers({ brandName: 'Roman Hu — Ray White Mission Bay' })).toEqual([
      'roman hu ray white mission bay',
      'roman hu',
    ])
  })

  it('uses the registrable label, not a subdomain', () => {
    expect(buildClientIdentifiers({ brandName: 'Acme', domain: 'https://shop.acme.co.nz' })).toEqual([
      'acme',
      'shop acme co nz',
    ])
  })

  it('ignores a domain with a path (a page on someone else\'s site)', () => {
    expect(
      buildClientIdentifiers({ brandName: 'Jane Doe', domain: 'raywhite.co.nz/agents/jane-doe' })
    ).toEqual(['jane doe'])
  })

  it('returns nothing for an empty brand with no domain', () => {
    expect(buildClientIdentifiers({ brandName: '' })).toEqual([])
  })
})

describe('isClientBrand', () => {
  const roman = buildClientIdentifiers({
    brandName: 'Roman Hu — Ray White Mission Bay',
    domain: 'romanhu.com',
  })
  const cts = buildClientIdentifiers({ brandName: 'CTS Tours NZ', domain: 'ctstours.co.nz' })
  const dixon = buildClientIdentifiers({ brandName: 'Dixon Homes' })

  it('rejects a brand that only appears inside a composite client name', () => {
    expect(isClientBrand('Ray White', roman)).toBe(false)
    expect(isClientBrand('Ray White Mission Bay', roman)).toBe(false)
  })

  it('rejects generic single tokens', () => {
    expect(isClientBrand('Homes', dixon)).toBe(false)
    expect(isClientBrand('Roman', roman)).toBe(false)
  })

  it('accepts real variants', () => {
    expect(isClientBrand('Roman Hu', roman)).toBe(true)
    expect(isClientBrand('Roman Hu (Ray White Mission Bay)', roman)).toBe(true)
    expect(isClientBrand('CTS Tours NZ Ltd', cts)).toBe(true)
    expect(isClientBrand('ctstours.co.nz', cts)).toBe(true)
    expect(isClientBrand('Dixon Homes Ltd', dixon)).toBe(true)
  })

  it('a national brand does not claim a branch-named client', () => {
    const branch = buildClientIdentifiers({ brandName: 'Ray White Mission Bay' })
    expect(isClientBrand('Ray White', branch)).toBe(false)
  })

  it('a short single-token alias must equal the brand exactly', () => {
    const ids = buildClientIdentifiers({ brandName: 'CTS Tours NZ', aliases: ['CTS'] })
    expect(isClientBrand('CTS', ids)).toBe(true)
    expect(isClientBrand('CTS Logistics', ids)).toBe(false)
  })

  it('does not match a domain root embedded in a longer word', () => {
    expect(isClientBrand('Romanhunter Realty', roman)).toBe(false)
  })
})

describe('resolveClientBrandRank', () => {
  it('matches a CJK alias inside unspaced Chinese text', () => {
    const out = resolveClientBrandRank(
      [{ brand: '中国旅行社', rank: 1, snippet: '推荐中国旅行社' }],
      '如果你要去北京，我推荐中国旅行社的行程。',
      { brandName: 'CTS Tours', aliases: ['中国旅行社'] }
    )
    expect(out.client_brand_rank).toBe(1)
  })

  it('a shorter name only counts once it is configured as an alias', () => {
    const brands = [
      { brand: 'JR Academy', rank: 1, snippet: 'x' },
      { brand: 'Magic Lab', rank: 2, snippet: 'x' },
    ]
    const raw = 'Compare JR Academy and Magic Lab for small-business owners learning AI.'
    expect(resolveClientBrandRank(brands, raw, { brandName: 'Magic Lab Class' }).client_brand_rank).toBeNull()
    expect(
      resolveClientBrandRank(brands, raw, { brandName: 'Magic Lab Class', aliases: ['Magic Lab'] })
        .client_brand_rank
    ).toBe(2)
  })

  it('a short alias inside another company name is not evidence on its own', () => {
    const identity = { brandName: 'CTS Tours NZ', domain: 'ctstours.co.nz', aliases: ['CTS'] }
    const raw = 'For freight from China, Kiwi Tours and CTS Logistics are the usual names.'
    const brands = [
      { brand: 'Kiwi Tours', rank: 1, snippet: 'x' },
      { brand: 'CTS Logistics', rank: 2, snippet: 'x' },
    ]
    const out = resolveClientBrandRank(brands, raw, identity)
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands).toHaveLength(2)

    // …but the alias written on its own, and extracted as a brand, still counts.
    const solo = resolveClientBrandRank(
      [{ brand: 'CTS', rank: 1, snippet: 'x' }],
      'CTS runs small-group tours out of Auckland every week.',
      identity
    )
    expect(solo.client_brand_rank).toBe(1)
  })

  it('a 2-char CJK alias is not textual evidence (no word boundaries in CJK)', () => {
    const out = resolveClientBrandRank([], '我推荐中旅游公司的行程，性价比很高。', {
      brandName: 'CTS Tours',
      aliases: ['中旅'],
    })
    expect(out.client_brand_rank).toBeNull()
  })

  it('composite name: client written as "Person" only is still found', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'Ray White', rank: 1, snippet: 'Agent Roman Hu at Ray White is great.' }],
      'Agent Roman Hu at Ray White is great.',
      { brandName: 'Roman Hu — Ray White Mission Bay', domain: 'romanhu.com' }
    )
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['Roman Hu — Ray White Mission Bay', 1],
      ['Ray White', 2],
    ])
  })

  it('"&" and "and" are treated alike when ordering an inserted client', () => {
    const out = resolveClientBrandRank(
      [
        { brand: 'Barfoot & Thompson', rank: 1, snippet: 'x' },
        { brand: 'Bayleys', rank: 2, snippet: 'x' },
      ],
      'Barfoot and Thompson, Bayleys, then Acme Realty.',
      { brandName: 'Acme Realty' }
    )
    expect(out.client_brand_rank).toBe(3)
  })

  it('domain-only identity never inserts an empty brand name', () => {
    const out = resolveClientBrandRank([], 'See acmetours.co.nz for itineraries.', {
      brandName: '',
      domain: 'acmetours.co.nz',
    })
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands[0].brand).toBe('acmetours.co.nz')
  })

  it('a short alias mentioned only as part of a different brand is not evidence', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'CTS Logistics', rank: 1, snippet: 'x' }],
      'For freight, try CTS Logistics — they cover the whole North Island.',
      { brandName: 'CTS Tours NZ', aliases: ['CTS'] }
    )
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([['CTS Logistics', 1]])
  })

  it('a short OFFICIAL brand name still recovers a missed client', () => {
    // Only aliases are too weak to stand alone; a short official name is not.
    const out = resolveClientBrandRank(
      [{ brand: 'Bunnings', rank: 1, snippet: 'x' }],
      'For flooring, Bunnings is the obvious start, though Oztop is cheaper.',
      { brandName: 'Oztop' }
    )
    expect(out.client_brand_rank).toBe(2)
  })

  it('an identifier only found inside another brand name is not evidence', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'Oztop Supplies', rank: 1, snippet: 'x' }],
      'Oztop Supplies delivers nationwide.',
      { brandName: 'Oztop' }
    )
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => b.brand)).toEqual(['Oztop Supplies'])
  })

  it('the client is still found at a later standalone occurrence', () => {
    const raw = 'Oztop Supplies is unrelated. For flooring itself, ask Oztop directly.'
    const out = resolveClientBrandRank(
      [{ brand: 'Oztop Supplies', rank: 1, snippet: 'x' }],
      raw,
      { brandName: 'Oztop' }
    )
    expect(out.client_brand_rank).toBe(2)
    // The snippet must quote the occurrence that grounded the rank.
    const inserted = out.brands.find(b => b.brand === 'Oztop')
    expect(inserted?.snippet).toContain('ask Oztop directly')
  })

  it('a shortened parser result does not hide the full name in the text', () => {
    // The parser returned "Acme" (too short to be accepted as the client),
    // but the text plainly writes "Acme Tours".
    const out = resolveClientBrandRank(
      [{ brand: 'Acme', rank: 1, snippet: 'x' }],
      'Acme Tours runs the small-group departures out of Auckland.',
      { brandName: 'Acme Tours' }
    )
    expect(out.client_brand_rank).toBe(1)
  })

  it('a competitor span measured from the text covers a spelled-out match', () => {
    // Parser wrote "SunHaven"; the text spells it "Sun Haven". The client
    // name "Haven" sits inside that match and must not be counted.
    const out = resolveClientBrandRank(
      [{ brand: 'SunHaven', rank: 1, snippet: 'x' }],
      'Sun Haven Retreat takes bookings all year.',
      { brandName: 'Haven' }
    )
    expect(out.client_brand_rank).toBeNull()
  })

  it('the snippet stays on the client even after many "&" in the text', () => {
    const raw =
      'Barfoot & Thompson, Bayleys & Co, Ray & White, Harcourts & Sons, ' +
      'Tall & Co, Smith & Sons all operate here. Acme Realty covers the eastern bays.'
    const out = resolveClientBrandRank([], raw, { brandName: 'Acme Realty' })
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands[0].snippet).toContain('Acme Realty')
  })

  it('an alias that is also the domain root keeps the stronger source', () => {
    const out = resolveClientBrandRank(
      [{ brand: 'Kiwi Tours', rank: 1, snippet: 'x' }],
      'Kiwi Tours is popular, but Acme runs the small-group departures.',
      { brandName: 'Acme Tours', aliases: ['Acme'], domain: 'acme.co.nz' }
    )
    expect(out.client_brand_rank).toBe(2)
  })

  it('8ce9055d: a short alias inside an unlisted company name is not evidence', () => {
    // Real row: an itinerary that "utilizes CTS Bus for intercity travel" in
    // China. The parser never extracted that operator, so the alias occurrence
    // has no competing brand to be disambiguated against — it still is not the
    // NZ client. A short alias only counts through an extracted client brand.
    const identity = { brandName: 'CTS Tours', domain: 'ctstours.co.nz', aliases: ['cts'] }
    const out = resolveClientBrandRank(
      [{ brand: 'Silk Road Echo', rank: 1, snippet: 'x' }],
      'Silk Road Echo: 12-day route. Utilizes CTS Bus for intercity travel.',
      identity
    )
    expect(out.client_brand_rank).toBeNull()

    // The same alias extracted as a brand of its own still counts.
    const solo = resolveClientBrandRank(
      [{ brand: 'CTS', rank: 1, snippet: 'x' }],
      'CTS runs small-group tours out of Auckland every week.',
      identity
    )
    expect(solo.client_brand_rank).toBe(1)
  })

  it('a short *formal brand name* is still evidence even when the parser misses it entirely', () => {
    // "Oztop" is under the 6-char single-token floor, but it is the client's
    // actual brand name (not an alias) — unlike a short alias, it must not
    // be excluded from standalone textual evidence just because it is short.
    const out = resolveClientBrandRank(
      [{ brand: 'Acme Supplies', rank: 1, snippet: 'x' }],
      'Try Oztop for building supplies, or Acme Supplies for delivery.',
      { brandName: 'Oztop' }
    )
    expect(out.client_brand_rank).toBe(1)
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['Oztop', 1],
      ['Acme Supplies', 2],
    ])
  })

  it('a short alias that also matches the domain root is still evidence against a colliding competitor', () => {
    // "Acme" is both the configured alias and the registrable domain-root
    // label of acme.co.nz. A competitor "Acme Logistics" must not make the
    // short-alias disambiguation drop this identifier: the domain root is
    // non-alias evidence and stands on its own.
    const out = resolveClientBrandRank(
      [{ brand: 'Acme Logistics', rank: 1, snippet: 'x' }],
      'For your trip, Acme is a great choice. For freight, try Acme Logistics.',
      { brandName: 'Acme Tours', aliases: ['Acme'], domain: 'acme.co.nz' }
    )
    expect(out.client_brand_rank).not.toBeNull()
  })

  it('drops multiple hallucinated client entries and closes rank gaps', () => {
    const out = resolveClientBrandRank(
      [
        { brand: 'Dixon Homes', rank: 1, snippet: 'x' },
        { brand: 'GJ Gardner', rank: 2, snippet: 'x' },
        { brand: 'Dixon Homes Ltd', rank: 3, snippet: 'x' },
        { brand: 'Signature Homes', rank: 4, snippet: 'x' },
      ],
      'Consider GJ Gardner and Signature Homes for a new build in Auckland.',
      { brandName: 'Dixon Homes' }
    )
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['GJ Gardner', 1],
      ['Signature Homes', 2],
    ])
  })
})

/**
 * Geo anchors (2026-09-20 CTS audit).
 *
 * `china travel service` is the group name the whole CTS group trades under.
 * Fifteen of 1,768 ranked CTS answers were about the Australian sibling
 * ("China Travel Service (Australia) Pty Ltd, established in Sydney in 1985")
 * and carried no NZ signal at all. Dropping the alias instead would cost the
 * 40 answers that spell the client "China Travel Service (NZ) Ltd", so the
 * gate is on the EVIDENCE, not on the alias list.
 *
 * Texts below are shortened from real answer bodies in `ai_visibility_runs`.
 */
describe('resolveClientBrandRank — geo anchors', () => {
  const CTS = {
    brandName: 'CTS Tours',
    domain: 'ctstours.co.nz',
    aliases: ['cts', 'cts tours nz', 'china travel service', '中国旅行社'],
  }
  const ANCHORED = { ...CTS, geoAnchors: ['new zealand', 'nz', 'aotearoa', 'auckland'] }

  const AU_TEXT =
    'Here are the major Chinese tour operators in Australia. China Travel Service ' +
    '(CTS), established in 1985, is a premier Australian travel agency with over ' +
    '35 years of experience, specialising in visa applications.'

  it('rejects the same-named sibling abroad: alias present, no anchor in the text', () => {
    const out = resolveClientBrandRank([], AU_TEXT, ANCHORED)
    expect(out.client_brand_rank).toBeNull()
  })

  it('without anchors configured, the very same answer still counts (rule is opt-in)', () => {
    expect(resolveClientBrandRank([], AU_TEXT, CTS).client_brand_rank).toBe(1)
  })

  it('keeps the sibling in brands_mentioned instead of deleting a real competitor', () => {
    const brands = [
      { brand: 'China Travel Service (Australia) Pty Ltd', rank: 1, snippet: 'x' },
      { brand: 'Equity Travel', rank: 2, snippet: 'x' },
    ]
    const out = resolveClientBrandRank(brands, AU_TEXT, ANCHORED)
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => b.brand)).toEqual([
      'China Travel Service (Australia) Pty Ltd',
      'Equity Travel',
    ])
  })

  it('accepts alias evidence once the answer carries an anchor', () => {
    const raw =
      'Certified inbound operators for New Zealand include A China Travel Company Ltd, ' +
      'China Travel Service (N.Z.) Ltd and Excel Travel Ltd.'
    const brands = [
      { brand: 'A China Travel Company Ltd', rank: 1, snippet: 'x' },
      { brand: 'Excel Travel Ltd', rank: 2, snippet: 'x' },
    ]
    expect(resolveClientBrandRank(brands, raw, ANCHORED).client_brand_rank).toBe(2)
  })

  it('never gates the official brand name, even with no anchor anywhere', () => {
    const raw = 'For small-group departures, CTS Tours runs weekly China itineraries.'
    expect(resolveClientBrandRank([], raw, ANCHORED).client_brand_rank).toBe(1)
  })

  it("never gates the client's own domain", () => {
    const raw = 'Compare Wendy Wu Tours and then check ctstours.co.nz for prices.'
    const brands = [{ brand: 'Wendy Wu Tours', rank: 1, snippet: 'x' }]
    expect(resolveClientBrandRank(brands, raw, ANCHORED).client_brand_rank).toBe(2)
  })

  it('matches a short anchor word-bounded only ("nz" is not inside "bonza")', () => {
    const bonza =
      'Bonza Travel and China Travel Service both sell Yangtze cruises out of Sydney.'
    expect(resolveClientBrandRank([], bonza, ANCHORED).client_brand_rank).toBeNull()
    const nz = 'China Travel Service sells Yangtze cruises to travellers from NZ.'
    expect(resolveClientBrandRank([], nz, ANCHORED).client_brand_rank).toBe(1)
  })

  it('matches a CJK anchor with no word boundaries around it', () => {
    const cjk = { ...CTS, geoAnchors: ['新西兰'] }
    const brands = [{ brand: '中国旅行社', rank: 1, snippet: 'x' }]
    expect(
      resolveClientBrandRank(brands, '在澳洲，中国旅行社提供签证服务。', cjk).client_brand_rank
    ).toBeNull()
    expect(
      resolveClientBrandRank(brands, '在新西兰，中国旅行社提供签证服务。', cjk).client_brand_rank
    ).toBe(1)
  })

  // 魏征's adversarial review, 2026-09-20: the anchor must come from prose.
  it('a cited link is not geo evidence — not even the answer\u2019s own', () => {
    const thirdParty =
      'China Travel Service (Australia) Pty Ltd, Sydney, is a premier Australian ' +
      'agency. See https://tourism-review.co.nz/a/1 for reviews.'
    expect(resolveClientBrandRank([], thirdParty, ANCHORED).client_brand_rank).toBeNull()
    const ownLink = 'China Travel Service sells tours. https://explorechinaholidays.com.au/x'
    expect(resolveClientBrandRank([], ownLink, ANCHORED).client_brand_rank).toBeNull()
    // …but prose plus a foreign link is still prose.
    const prose = 'New Zealand travellers use China Travel Service. https://x.com.au/y'
    expect(resolveClientBrandRank([], prose, ANCHORED).client_brand_rank).toBe(1)
  })

  it('finds a short anchor spelled out with separators ("N.Z.")', () => {
    const raw = 'China Travel Service (N.Z.) Limited is the licensed operator.'
    expect(resolveClientBrandRank([], raw, ANCHORED).client_brand_rank).toBe(1)
    // The word-boundary check still holds: "in Zurich" must not satisfy "nz".
    const zurich = 'China Travel Service runs departures in Zurich and Milan.'
    expect(resolveClientBrandRank([], zurich, ANCHORED).client_brand_rank).toBeNull()
  })

  it('an all-blank anchor list behaves like no anchors at all', () => {
    expect(
      resolveClientBrandRank([], AU_TEXT, { ...CTS, geoAnchors: ['  ', ''] }).client_brand_rank
    ).toBe(1)
  })

  // Codex review, 2026-09-20: a short anchor must not be satisfied by two
  // real, independently-typed words that merely happen to spell it out end
  // to end once every space is stripped.
  it('a short anchor is not satisfied by unrelated words that spell it out across a real space', () => {
    const raw = 'For a scenic detour, book a U-turn loop before China Travel Service picks you up.'
    expect(
      resolveClientBrandRank([], raw, { ...CTS, geoAnchors: ['au'] }).client_brand_rank
    ).toBeNull()
    // …but the same short anchor still finds a genuine punctuation-spelled form.
    const withParens = 'China Travel Service (AU) is the local operator.'
    expect(
      resolveClientBrandRank([], withParens, { ...CTS, geoAnchors: ['au'] }).client_brand_rank
    ).toBe(1)
  })

  it('a multi-word anchor is not satisfied by unrelated words that spell it out across real spaces', () => {
    const raw =
      'China Travel Service brings new zeal and enthusiasm to every Sydney city tour.'
    expect(resolveClientBrandRank([], raw, ANCHORED).client_brand_rank).toBeNull()
  })
})

describe('admissibleIdentifiersForAnswer', () => {
  const CTS = {
    brandName: 'CTS Tours',
    domain: 'ctstours.co.nz',
    aliases: ['china travel service'],
    geoAnchors: ['new zealand', 'nz'],
  }

  it('drops alias identifiers when the answer carries no anchor', () => {
    expect(
      admissibleIdentifiersForAnswer(CTS, 'Chinese tour operators in Australia include CTS.')
    ).toEqual(['cts tours', 'ctstours co nz', 'ctstours'])
  })

  it('keeps them when the answer does carry one', () => {
    expect(
      admissibleIdentifiersForAnswer(CTS, 'Inbound operators for New Zealand include CTS.')
    ).toContain('china travel service')
  })

  it('ignores a CJK anchor too short to ever match, instead of closing the gate', () => {
    const twoChar = { ...CTS, geoAnchors: ['澳洲'] }
    // '澳洲' can never match (CJK needs 3+ chars), so the gate must stay OFF
    // rather than silently rejecting every alias-grounded mention.
    expect(admissibleIdentifiersForAnswer(twoChar, '任何文本')).toContain('china travel service')
  })
})
