import { describe, expect, it } from 'vitest'
import { buildNarrativePayload } from '../../evaluate'
import { surfaceAdHealthForPatrol } from '../patrol-ad-health'

describe('surfaceAdHealthForPatrol', () => {
  it('overall alert + 处方 → 进巡察结论', () => {
    const payload = buildNarrativePayload(new Map(), '2026-11-13', undefined, null, 10)
    payload.overall_verdict = 'alert'
    payload.headline = '有广告该动手了'
    payload.campaigns = [{
      campaign_id: 'c1',
      campaign_name: '系列一',
      verdict: 'alert',
      headline: '素材疲劳',
      metrics: [],
      ctr_series: [],
      latest_spend_7d: 100,
      latest_results_7d: 5,
      frequency_7d: 1.2,
      prescription: {
        kind: 'refresh_creatives',
        title: '补新素材',
        why: '点击率在掉',
        executable: true,
      },
    }]
    const s = surfaceAdHealthForPatrol('2026-11-13', payload)
    expect(s).not.toBeNull()
    expect(s?.patrolLine).toContain('有广告该动手了')
    expect(s?.patrolLine).toContain('补新素材')
    expect(s?.prescriptionLine).toContain('补新素材')
  })

  it('整体健康、无处方 → 不 surface', () => {
    const payload = buildNarrativePayload(new Map(), '2026-11-13')
    payload.overall_verdict = 'healthy'
    payload.headline = '都健康'
    const s = surfaceAdHealthForPatrol('2026-11-13', payload)
    expect(s).toBeNull()
  })
})