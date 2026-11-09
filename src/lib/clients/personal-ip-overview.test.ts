import { describe, it, expect } from 'vitest'
import {
  buildPersonalIpTiles,
  formatCount,
  formatSocialFollowers,
  PERSONAL_IP_UNREADABLE,
  PERSONAL_IP_TILE_LABELS,
} from './personal-ip-overview'
import { socialFollowersFromDiscovery } from './personal-ip-overview-load'

describe('formatCount', () => {
  it('读不到时不显示 0', () => {
    expect(formatCount(null)).toBe(PERSONAL_IP_UNREADABLE)
    expect(formatCount(undefined)).toBe(PERSONAL_IP_UNREADABLE)
  })

  it('有数就格式化', () => {
    expect(formatCount(12_000)).toBe('12.0K')
  })
})

describe('formatSocialFollowers', () => {
  it('两边都没有 → 整格读不到', () => {
    expect(formatSocialFollowers(null, null)).toBe(PERSONAL_IP_UNREADABLE)
  })

  it('只有一边有时另一边写读不到', () => {
    expect(formatSocialFollowers(500, null)).toBe('FB 500 · TikTok 读不到')
  })
})

describe('buildPersonalIpTiles', () => {
  it('个人 IP 固定五格', () => {
    const tiles = buildPersonalIpTiles({
      postsOnSchedule: 3,
      facebookFollowers: 100,
      tiktokFollowers: 200,
      websitePageviews: 900,
      dmsAndEnquiries: 4,
      leads: 2,
    })
    expect(tiles).toHaveLength(5)
    expect(tiles.map((t) => t.key)).toEqual([
      'posts_on_schedule',
      'social_followers',
      'website_views',
      'dms_enquiries',
      'leads',
    ])
    expect(tiles[0].label).toBe(PERSONAL_IP_TILE_LABELS.posts_on_schedule)
    expect(tiles[0].value).toBe('3')
  })

  it('缺数据时各格读不到', () => {
    const tiles = buildPersonalIpTiles({
      postsOnSchedule: null,
      facebookFollowers: null,
      tiktokFollowers: null,
      websitePageviews: null,
      dmsAndEnquiries: null,
      leads: null,
    })
    expect(tiles.every((t) => t.value === PERSONAL_IP_UNREADABLE || t.value.includes('读不到'))).toBe(true)
  })
})

describe('socialFollowersFromDiscovery', () => {
  it('从张骞 payload 取 FB / TikTok 粉丝', () => {
    const out = socialFollowersFromDiscovery({
      social_profiles: [
        { platform: 'facebook', followers_count: 111 },
        { platform: 'tiktok', followers_count: 222 },
      ],
    })
    expect(out).toEqual({ facebook: 111, tiktok: 222 })
  })
})
