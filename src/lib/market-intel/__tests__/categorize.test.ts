import { describe, it, expect } from 'vitest'
import { hasBoundedPhrase, hasPhrase, hasWord, matchCategory } from '../categorize'
import type { RawFeedItem } from '../types'

function item(title: string, excerpt = ''): RawFeedItem {
  return { title, url: 'https://example.com/x', publishedAt: null, excerpt }
}

describe('hasPhrase', () => {
  it('matches case-insensitively', () => {
    expect(hasPhrase('Meta ADS manager update', 'meta ads')).toBe(true)
  })

  it('requires the full phrase, not just the individual tokens', () => {
    // 关键场景（魏征审查指出的具体风险）：拆词匹配会让"Meta 财报"这类泛科技新闻
    // 误判进 meta_ads——完整短语匹配则不会，因为 "meta ads" 不是子串。
    expect(hasPhrase('Meta reports quarterly ads revenue growth', 'meta ads')).toBe(false)
  })
})

describe('hasWord', () => {
  it('matches whole words case-insensitively', () => {
    expect(hasWord('Meta rolls out a new ad format', 'ad')).toBe(true)
    expect(hasWord("TikTok's new ad tools", 'TikTok')).toBe(true)
    expect(hasWord('meta expands reels', 'Meta')).toBe(true)
  })

  it('does not match substrings inside other words', () => {
    // "ad" 不能命中 "add"/"ads"/"read"；"Meta" 不能命中 "metadata"/"metaverse"。
    expect(hasWord('Meta added a feature', 'ad')).toBe(false)
    expect(hasWord('New ads incoming', 'ad')).toBe(false)
    expect(hasWord('Read the report', 'ad')).toBe(false)
    expect(hasWord('New metadata standards', 'Meta')).toBe(false)
    expect(hasWord('Exploring the metaverse', 'Meta')).toBe(false)
  })
})

describe('matchCategory', () => {
  it('requires a whitelist phrase hit for gated categories like meta_ads', () => {
    const hit = item('Meta rolls out new Advantage+ audience controls')
    expect(matchCategory(hit, ['meta_ads'])).toBe('meta_ads')

    const miss = item('Meta reports record quarterly earnings')
    expect(matchCategory(miss, ['meta_ads'])).toBeNull()
  })

  it('passes through ungated categories (ai_startup / marketing / llm_news / chatgpt_ads / china_outbound) without a phrase check', () => {
    const anything = item('A small company announced something unrelated to ads')
    expect(matchCategory(anything, ['ai_startup'])).toBe('ai_startup')
    expect(matchCategory(anything, ['llm_news'])).toBe('llm_news')
    expect(matchCategory(anything, ['chatgpt_ads'])).toBe('chatgpt_ads')
    expect(matchCategory(anything, ['china_outbound'])).toBe('china_outbound')
  })

  it('matches Instagram-specific ad phrases under meta_ads', () => {
    const hit = item('Instagram Ads adds new carousel format for Reels')
    expect(matchCategory(hit, ['meta_ads'])).toBe('meta_ads')
  })

  it('tries candidate categories in order and returns the first hit when both match', () => {
    // 标题同时命中 meta_ads 和 google_ads 的白名单短语，声明顺序决定归属。
    const both = item('New Meta Ads and Google Ads integration launches')
    expect(matchCategory(both, ['google_ads', 'meta_ads'])).toBe('google_ads')
    expect(matchCategory(both, ['meta_ads', 'google_ads'])).toBe('meta_ads')
  })

  it('returns null when nothing matches', () => {
    const irrelevant = item('Local council approves new bike lane')
    expect(matchCategory(irrelevant, ['meta_ads', 'google_ads', 'tiktok_ads'])).toBeNull()
  })

  // --- v2 召回增强（2026-09-03）：平台词 + 广告词共现 ---

  it('classifies platform + ad co-occurrence even without an exact product phrase', () => {
    // 真实标题（生产实测）：不含 "Meta Ads" 完整短语，但 Meta + ad 共现。
    expect(matchCategory(item('Meta removes option to exclude ad placements'), ['meta_ads'])).toBe('meta_ads')
    expect(matchCategory(item('TikTok adds new advertising controls for creators'), ['tiktok_ads'])).toBe('tiktok_ads')
    expect(matchCategory(item('Instagram expands ad formats in Reels'), ['meta_ads'])).toBe('meta_ads')
  })

  it('does not classify platform news that never mentions advertising', () => {
    expect(matchCategory(item('Meta launches a new Mac app for AI chats'), ['meta_ads'])).toBeNull()
    expect(matchCategory(item('TikTok tests longer video uploads'), ['tiktok_ads'])).toBeNull()
    // "added" 不是 "ad"，不该被词边界误判。
    expect(matchCategory(item('Meta added new privacy settings'), ['meta_ads'])).toBeNull()
  })

  it('prioritizes gated categories over ungated ones regardless of declared order', () => {
    // Digiday 声明 ['marketing', 'tiktok_ads']——真正的 TikTok 广告新闻必须落 tiktok_ads，
    // 不能被无白名单的 marketing 先吃掉（v1 的实际 bug）。
    const tiktokAd = item('TikTok rolls out new Spark Ads placements for brands')
    expect(matchCategory(tiktokAd, ['marketing', 'tiktok_ads'])).toBe('tiktok_ads')

    // 非广告条目仍正常回落到 marketing。
    const notAd = item('Why brands are turning to older creators for authenticity')
    expect(matchCategory(notAd, ['marketing', 'tiktok_ads'])).toBe('marketing')
  })

  // --- 复审（魏征 2026-09-03）挑出的误判用例，锁定修复 ---

  it('does not let short strong phrases substring-match into other words', () => {
    // 'IG Ads' 不能命中 "big ads"；'Ads Manager' 不能命中 "leads manager"。
    expect(matchCategory(item('Small brands, big ads at the Super Bowl'), ['meta_ads'])).toBeNull()
    expect(matchCategory(item('New AI sales leads manager launches'), ['meta_ads'])).toBeNull()
    // 但真正带词边界的 "IG Ads" 仍然命中。
    expect(matchCategory(item('Using IG Ads to reach Gen Z'), ['meta_ads'])).toBe('meta_ads')
  })

  it('treats "Reels" as an ad signal only when written as a Reels ad phrase', () => {
    // 裸动词 "reels" 不该把无关新闻拉进 meta_ads。
    expect(matchCategory(item('Ad industry reels from new privacy rules'), ['meta_ads'])).toBeNull()
    // "Reels ad" / "Reels ads" 是真实广告短语，命中。
    expect(matchCategory(item('Meta ships a new Reels ad format'), ['meta_ads'])).toBe('meta_ads')
    expect(matchCategory(item('Reels ads now support shopping tags'), ['meta_ads'])).toBe('meta_ads')
  })

  it('keeps generic Google news out of google_ads (Google is deliberately not a platform word)', () => {
    // google_ads 只认 STRONG_PHRASES，不做 "Google + ad" 共现——否则泛科技新闻全灌进来。
    expect(matchCategory(item('Google launches ad-free YouTube tier'), ['google_ads'])).toBeNull()
    expect(matchCategory(item('Google Ads adds new Performance Max controls'), ['google_ads'])).toBe('google_ads')
  })

  it('breaks a two-gated-category tie by declared order', () => {
    // Social Media Today 声明 ['meta_ads', 'tiktok_ads']；同时命中时按声明顺序。
    const both = item('Meta and TikTok both expand ad targeting tools')
    expect(matchCategory(both, ['meta_ads', 'tiktok_ads'])).toBe('meta_ads')
    expect(matchCategory(both, ['tiktok_ads', 'meta_ads'])).toBe('tiktok_ads')
  })

  it('matches platform + ad co-occurrence across title and excerpt', () => {
    // 平台词在标题、广告词在摘要里也算共现（正文很短，跨字段判定是有意为之）。
    const crossField = item('TikTok unveils its 2026 roadmap', 'The update includes new ad formats for brands.')
    expect(matchCategory(crossField, ['tiktok_ads'])).toBe('tiktok_ads')
  })
})

describe('hasBoundedPhrase', () => {
  it('requires word boundaries at the phrase edges', () => {
    expect(hasBoundedPhrase('Using IG Ads today', 'IG Ads')).toBe(true)
    expect(hasBoundedPhrase('Small brands, big ads', 'IG Ads')).toBe(false)
    expect(hasBoundedPhrase('New leads manager tool', 'Ads Manager')).toBe(false)
    expect(hasBoundedPhrase('Open your Ads Manager dashboard', 'Ads Manager')).toBe(true)
  })

  it('matches multi-word phrases and phrases with regex-special chars literally', () => {
    expect(hasBoundedPhrase('the new TikTok for Business hub', 'TikTok for Business')).toBe(true)
    expect(hasBoundedPhrase('rolling out Advantage+ campaigns', 'Advantage+')).toBe(true)
  })
})
