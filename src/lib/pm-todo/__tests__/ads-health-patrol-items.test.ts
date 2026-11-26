import { describe, expect, it } from 'vitest'
import { buildAdsHealthPatrolItem } from '../ads-health-patrol-items'
import { buildNarrativePayload } from '@/lib/ads-strategy/evaluate'

describe('buildAdsHealthPatrolItem', () => {
  it('同一客户同一天只生成一条待办文案', () => {
    const payload = buildNarrativePayload(new Map(), '2026-11-13', undefined, null, 10)
    payload.overall_verdict = 'watch'
    payload.headline = '有系列走弱'
    payload.campaigns = [{
      campaign_id: 'c1',
      campaign_name: '系列一',
      verdict: 'watch',
      headline: '走弱',
      metrics: [],
      ctr_series: [],
      latest_spend_7d: 50,
      latest_results_7d: 2,
      frequency_7d: 2.1,
      prescription: {
        kind: 'refresh_creatives',
        title: '补新素材',
        why: '素材老化',
        executable: false,
      },
    }]
    const a = buildAdsHealthPatrolItem('client_a', '演示客户', '2026-11-13', payload)
    const b = buildAdsHealthPatrolItem('client_a', '演示客户', '2026-11-13', payload)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a?.what).toBe(b?.what)
    expect(a?.kind).toBe('ads_health_patrol_alert')
    expect(a?.href).toContain('client_a')
  })

  it('健康日不产生待办', () => {
    const payload = buildNarrativePayload(new Map(), '2026-11-13')
    payload.overall_verdict = 'healthy'
    expect(buildAdsHealthPatrolItem('client_a', '演示客户', '2026-11-13', payload)).toBeNull()
  })
})

describe('pushAdsHealthPatrolItems 去重', () => {
  it('同一客户 duplicate 行只 push 一条', async () => {
    const payload = buildNarrativePayload(new Map(), '2026-11-15')
    payload.overall_verdict = 'alert'
    payload.headline = '警报'
    const bucket: import('../manual-item-types').ManualItem[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({
            data: [
              { client_id: 'client_a', insight_date: '2026-11-15', payload },
              { client_id: 'client_a', insight_date: '2026-11-15', payload },
            ],
            error: null,
          }),
        }),
      }),
    }
    const { pushAdsHealthPatrolItems } = await import('../ads-health-patrol-items')
    await pushAdsHealthPatrolItems(supabase as never, bucket, new Date('2026-11-15T20:00:00Z'), () => '演示客户')
    expect(bucket).toHaveLength(1)
  })
})