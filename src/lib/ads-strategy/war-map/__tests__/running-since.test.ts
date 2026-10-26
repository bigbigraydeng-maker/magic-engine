import { describe, it, expect } from 'vitest'

import { computeRunningSince, type SnapRowLite } from '../running-since'

function adset(over: Partial<SnapRowLite> & { entityId: string; capturedAt: string }): SnapRowLite {
  return { campaignId: 'c1', effectiveStatus: 'ACTIVE', captureReason: 'first_seen', ...over }
}

function campaign(over: Partial<SnapRowLite> & { entityId: string; capturedAt: string }): SnapRowLite {
  return { campaignId: null, effectiveStatus: 'ACTIVE', captureReason: 'first_seen', ...over }
}

describe('computeRunningSince', () => {
  it('广告组和系列都 ACTIVE，起算取 first_seen 那天（新西兰）', () => {
    const adsets = [adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z' })]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-19T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBe('2026-10-20')
  })

  it('广告组 ACTIVE 但系列最新一行是 PAUSED → null', () => {
    const adsets = [adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z' })]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-19T00:00:00.000Z', effectiveStatus: 'PAUSED' })]
    expect(computeRunningSince(adsets, campaigns)).toBeNull()
  })

  it('广告组最新一行是 PAUSED → null', () => {
    const adsets = [adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z', effectiveStatus: 'PAUSED' })]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-19T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBeNull()
  })

  it('两个在跑广告组，取最早的那个日子', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z' }),
      adset({ entityId: 'a2', capturedAt: '2026-10-18T03:26:00.000Z' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-17T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBe('2026-10-18')
  })

  it('先 first_seen 时是 PAUSED，后来 changed 变 ACTIVE → 起算取那次 changed', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-10T03:26:00.000Z', effectiveStatus: 'PAUSED' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z', captureReason: 'changed', effectiveStatus: 'ACTIVE' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-09T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBe('2026-10-20')
  })

  it('最新一行是 disappeared → 不算在跑', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-10T03:26:00.000Z' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z', captureReason: 'disappeared' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-09T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBeNull()
  })

  it('乱序输入结果与有序输入一致', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z' }),
      adset({ entityId: 'a2', capturedAt: '2026-10-18T03:26:00.000Z' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-17T00:00:00.000Z' })]
    const shuffled = [adsets[1]!, adsets[0]!]
    expect(computeRunningSince(shuffled, campaigns)).toBe(computeRunningSince(adsets, campaigns))
  })

  it('空输入 → null', () => {
    expect(computeRunningSince([], [])).toBeNull()
  })

  it('10/20 开投、10/21 调预算（changed 且仍 ACTIVE）→ 开投日仍是 10/20，不是最后一次改设置的日子', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:26:00.000Z' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-21T01:00:00.000Z', captureReason: 'changed' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-21T20:00:00.000Z', captureReason: 'daily' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-19T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBe('2026-10-20')
  })

  it('先暂停再重新开：起点是重新开的那一行，不是更早的第一次开', () => {
    const adsets = [
      adset({ entityId: 'a1', capturedAt: '2026-10-10T03:00:00.000Z' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-12T03:00:00.000Z', captureReason: 'changed', effectiveStatus: 'PAUSED' }),
      adset({ entityId: 'a1', capturedAt: '2026-10-20T03:00:00.000Z', captureReason: 'changed' }),
    ]
    const campaigns = [campaign({ entityId: 'c1', capturedAt: '2026-10-09T00:00:00.000Z' })]
    expect(computeRunningSince(adsets, campaigns)).toBe('2026-10-20')
  })
})
