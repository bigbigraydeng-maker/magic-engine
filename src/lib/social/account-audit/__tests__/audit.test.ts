import { describe, expect, it } from 'vitest'
import { auditAccount, inferFormat, normaliseMusic, TRAVEL_THRESHOLDS, type AuditReel } from '../audit'

const reel = (id: string, createdOn: string, over: Partial<AuditReel> = {}): AuditReel => ({
  id, createdOn, template: 'postcard', engine: 'remotion', music: `m${id}.mp3`, scenes: 3, brandColor: '#B61E2E', variantOf: null, format: null, pillar: null, ...over,
})
const status = (r: ReturnType<typeof auditAccount>, key: string) => r.metrics.find((m) => m.key === key)?.status

describe('normaliseMusic', () => {
  it('drops folder, extension, case, underscores and the _n suffix', () => {
    expect(normaliseMusic('music/Jade_River_Journey.mp3')).toBe('jade-river-journey')
    expect(normaliseMusic('music/second-hand-sunrise_n.mp3')).toBe('second-hand-sunrise')
    expect(normaliseMusic(null)).toBeNull()
    expect(normaliseMusic('')).toBeNull()
  })
})

describe('inferFormat', () => {
  it('factory templates are destination content; an external upload is people; unknown stays unknown', () => {
    expect(inferFormat({ format: null, template: 'list', engine: 'remotion' })).toBe('destination')
    expect(inferFormat({ format: null, template: null, engine: 'external_upload' })).toBe('people')
    expect(inferFormat({ format: null, template: 'mystery', engine: 'remotion' })).toBeNull()
    expect(inferFormat({ format: 'explainer', template: 'list', engine: 'remotion' })).toBe('explainer')
  })
})

describe('auditAccount', () => {
  it('a varied account passes every measurable check', () => {
    const t = ['postcard', 'list', 'qa', 'guest', 'postcard', 'qa', 'list', 'guest', 'qa', 'postcard']
    const reels = t.map((tpl, i) => reel(`r${i}`, `2026-10-${String(10 + i * 2).padStart(2, '0')}`, {
      template: tpl, scenes: 2 + (i % 4), brandColor: i % 2 ? '#112233' : '#B61E2E',
      format: tpl === 'qa' ? 'explainer' : tpl === 'guest' ? 'people' : 'destination',
    }))
    const r = auditAccount(reels, '2026-10-30')
    for (const k of ['D1', 'D2', 'D3', 'D4', 'D6']) expect(status(r, k), k).toBe('ok')
    expect(r.findings.filter((f) => f.tier !== 'C')).toEqual([])
  })

  it('three of the same template in a row is over even when the share is low', () => {
    const tpls = ['a', 'a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const reels = tpls.map((tpl, i) => reel(`r${i}`, `2026-10-${String(30 - i).padStart(2, '0')}`, { template: tpl }))
    expect(status(auditAccount(reels, '2026-10-30'), 'D1')).toBe('over')
  })

  it('the same track within 7 days is over; the same track weeks apart is fine', () => {
    const close = [reel('a', '2026-10-20', { music: 'x.mp3' }), reel('b', '2026-10-24', { music: 'music/x.mp3' }), reel('c', '2026-10-01', { music: 'y.mp3' })]
    expect(status(auditAccount(close, '2026-10-30'), 'D2')).toBe('over')
    const apart = [
      reel('a', '2026-10-01', { music: 'x.mp3' }), reel('b', '2026-10-20', { music: 'x.mp3' }),
      ...['y', 'z', 'w', 'v', 'u', 't'].map((m, i) => reel(`o${i}`, `2026-10-${String(5 + i * 2).padStart(2, '0')}`, { music: `${m}.mp3` })),
    ]
    expect(status(auditAccount(apart, '2026-10-30'), 'D2')).toBe('ok')
  })

  it('variants of one reel made within 7 days are over; a lone original is not', () => {
    const crowd = [reel('base0001', '2026-10-20'), reel('v1', '2026-10-22', { variantOf: 'base0001' })]
    expect(status(auditAccount(crowd, '2026-10-30'), 'D3')).toBe('over')
    expect(status(auditAccount([reel('solo0001', '2026-10-20')], '2026-10-30'), 'D3')).toBe('ok')
  })

  it('fields that cannot be read are "not_measured", never a pass or a zero', () => {
    const blind = [reel('a', '2026-10-20', { template: null, music: null, scenes: null })]
    const r = auditAccount(blind, '2026-10-30')
    for (const k of ['D1', 'D2', 'D4', 'D5', 'D6']) expect(status(r, k), k).toBe('not_measured')
    expect(r.findings.filter((f) => f.tier === 'C').length).toBeGreaterThanOrEqual(5)
  })

  it('a missing form the factory can make is a tier B order; one it cannot make is tier C', () => {
    const only = [reel('a', '2026-10-20', { format: 'people' }), reel('b', '2026-10-21', { format: 'explainer' })]
    const r = auditAccount(only, '2026-10-30')
    const d4 = r.findings.filter((f) => f.key === 'D4')
    expect(d4).toHaveLength(1)
    expect(d4[0]).toMatchObject({ tier: 'B' })
    expect(d4[0].what).toContain('destination')
  })

  it('industry thresholds can be overridden per client', () => {
    const reels = ['a', 'a', 'b', 'b'].map((tpl, i) => reel(`r${i}`, `2026-10-${20 + i}`, { template: tpl }))
    const strict = auditAccount(reels, '2026-10-30', { ...TRAVEL_THRESHOLDS, maxTemplateShare: 0.4, maxSameTemplateRun: 5 })
    const loose = auditAccount(reels, '2026-10-30', { ...TRAVEL_THRESHOLDS, maxTemplateShare: 0.9, maxSameTemplateRun: 5 })
    expect(status(strict, 'D1')).toBe('over')
    expect(status(loose, 'D1')).toBe('ok')
  })

  describe('each BGM and variant rule on its own', () => {
    const spread = (tracks: string[], start = 1) => tracks.map((m, i) => reel(`s${i}`, `2026-10-${String(start + i * 3).padStart(2, '0')}`, { music: `${m}.mp3` }))
    it('a repeat inside 7 days is over even when no track dominates', () => {
      const reels = [...spread(['a', 'b', 'c', 'd', 'e', 'f']), reel('dup', '2026-10-02', { music: 'a.mp3' })]
      const r = auditAccount(reels, '2026-10-30')
      expect(r.metrics.find((m) => m.key === 'D2')?.value).toContain('7 天内重复 1 次')
      expect(status(r, 'D2')).toBe('over')
    })
    it('three tracks dominating is over even when no repeat is close together', () => {
      const reels = [...spread(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'], 1)]
      const r = auditAccount(reels, '2026-10-30')
      expect(r.metrics.find((m) => m.key === 'D2')?.value).toContain('7 天内重复 0 次')
      expect(status(r, 'D2')).toBe('over')
    })
    it('variants of one reel made weeks apart are fine', () => {
      const reels = [reel('base0001', '2026-10-01'), reel('v1', '2026-10-25', { variantOf: 'base0001' })]
      expect(status(auditAccount(reels, '2026-10-30'), 'D3')).toBe('ok')
    })
  })
})

