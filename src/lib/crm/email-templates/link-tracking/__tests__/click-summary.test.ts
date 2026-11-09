import { describe, expect, it } from 'vitest'
import { clickLabel } from '../click-summary'

describe('clickLabel', () => {
  const tour = { name: 'Best of China', destination: 'china', tier: 'discovery', slug: 'essentials', departOn: '2027-03-11' }

  it.each([
    ['catalogue', null, 'https://x/b.pdf', '目录'],
    ['all_tours', null, 'https://x/china-tours', '全部团页面'],
    ['tour', tour, 'https://x/tours/china/discovery/essentials?date=2027-03-11', 'Best of China（11 Mar 出发）'],
    ['tour', { ...tour, departOn: null }, 'https://x/tours/china/discovery/essentials', 'Best of China'],
    ['other', null, 'https://www.x.com/contact?a=1', '/contact'],
    ['other', null, 'www.x.com/about', '/about'],
  ] as const)('%s → %s', (kind, t, url, label) => {
    expect(clickLabel(kind, t, url)).toBe(label)
  })
})
