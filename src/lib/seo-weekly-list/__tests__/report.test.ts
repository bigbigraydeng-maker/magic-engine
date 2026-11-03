import { describe, expect, it } from 'vitest'
import { gatherSeoListWeekly, median, seoListLines } from '../report'
import { SEO_PLAN_LOOP } from '@/lib/zhuge/action-persister'
import { FakeDb } from './fake-supabase'

const NOW = new Date('2026-10-12T00:00:00Z')

describe('report', () => {
  it('median', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('counts only system-verified completions; a human-only completion is shown separately', async () => {
    const mk = (id: string, status: string, steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      id, client_id: 'c1', dimension: 'seo', source: 'zhuge', title: `item ${id}`, status, due_date: '2026-10-06',
      created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', completed_at: null, steps_json: { loop: SEO_PLAN_LOOP, ...steps }, ...extra,
    })
    const db = new FakeDb({
      goals: [{ client_id: 'c1', primary_metric_key: 'seo_gsc_clicks_28d', status: 'active', title: 'G', baseline_value: 1042, target_value: 1340, current_value: 1100, period_end: '2027-01-03', created_at: 'x' }],
      execution_items: [
        mk('a', 'completed', { verify: { state: 'pass' } }, { completed_at: '2026-10-09T00:00:00Z' }),
        mk('b', 'completed', {}, { completed_at: '2026-10-09T00:00:00Z' }),
        mk('c', 'pending', {}),
        mk('d', 'skipped', { skip_reason: 'expired_no_action' }),
      ],
    })
    const d = await gatherSeoListWeekly(db.client(), 'c1', NOW)
    if (!d || 'error' in d) throw new Error('expected data')
    expect(d.verified_pass_week).toBe(1)
    expect(d.claimed_not_verified).toBe(1)
    expect(d.open_now).toBe(1)
    expect(d.abandoned_week).toHaveLength(1)
    expect(d.median_days_to_verified).toBe(3)
    const lines = seoListLines(d, 'https://app/board').join('\n')
    expect(lines).toContain('系统核对通过 <b>1</b>')
    expect(lines).toContain('人点了完成但系统没核对通过 1')
    expect(lines).toContain('不把涨跌算到某一件事头上')
  })

  it('no active seo goal → null (nothing rendered); read error → visible message; titles are HTML-escaped', async () => {
    expect(await gatherSeoListWeekly(new FakeDb({ goals: [], execution_items: [] }).client(), 'c1', NOW)).toBeNull()
    expect(seoListLines(null, 'x')).toEqual([])
    expect(seoListLines({ error: 'x<y' }, 'x')[0]).toContain('x&lt;y')
    const html = seoListLines({
      goal_title: 'G<b>', goal_current: null, goal_target: 1, goal_baseline: 0, goal_period_end: '2027-01-03',
      listed_this_week: [{ title: '<script>', due_date: null }], open_now: 0, verified_pass_week: 0, claimed_not_verified: 0,
      abandoned_week: [], median_days_to_verified: null,
    }, 'x').join('\n')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(seoListLines({ error: 'a"b' }, 'x')[0]).toContain('a&quot;b')
  })
})
