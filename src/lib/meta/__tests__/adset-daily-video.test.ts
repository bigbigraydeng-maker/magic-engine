/**
 * 广告组级日数据 + 视频完播解析（ads IMPACT 阶段 1 §2.2）。
 * Graph 返回用 NAL 2026-08-17~09-13 只读实拉（level=adset，time_increment=1），不自编形状。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import nalAdsetDaily from '@/lib/ads-strategy/portfolio/__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import { getAdsetDailyInsights } from '../client'

afterEach(() => vi.unstubAllGlobals())

function stubGraph(data: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('getAdsetDailyInsights', () => {
  it('请求 level=adset 且带上视频完播字段', async () => {
    const fetchMock = stubGraph([])
    await getAdsetDailyInsights('act_953025114498626', 't', '2026-09-11', '2026-09-13')
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
    expect(url.searchParams.get('level')).toBe('adset')
    const fields = url.searchParams.get('fields') ?? ''
    for (const f of ['adset_id', 'video_thruplay_watched_actions', 'video_p95_watched_actions', 'video_avg_time_watched_actions', 'actions']) {
      expect(fields.split(',')).toContain(f)
    }
  })

  it('NAL「Thruplay-物流-200/cbm」2026-09-13：ThruPlay 723、p25 725、p95 128、平均 34 秒、3 秒播放 745', async () => {
    stubGraph(nalAdsetDaily)
    const { rows, complete } = await getAdsetDailyInsights('act_953025114498626', 't', '2026-08-17', '2026-09-13')
    expect(complete).toBe(true)
    expect(rows).toHaveLength(61)
    const r = rows.find(x => x.adset_id === '52596939123725' && x.insight_date === '2026-09-13')
    expect(r).toMatchObject({
      campaign_id: '52596939123525',
      spend: 13.85,
      video_thruplays: 723,
      video_p25: 725,
      video_p95: 128,
      video_p100: 122,
      video_avg_watch_seconds: 34,
      video_3s_views: 745,
      leads: 0,
    })
    expect(Array.isArray(r?.actions)).toBe(true)
  })

  it('非视频广告组（没有视频字段）→ 视频列是 null，不伪造 0', async () => {
    stubGraph(nalAdsetDaily)
    const { rows } = await getAdsetDailyInsights('act_953025114498626', 't', '2026-08-17', '2026-09-13')
    const noVideo = rows.find(x => x.video_thruplays === null)
    expect(noVideo).toBeDefined()
    expect(noVideo?.video_p95).toBeNull()
  })

  it('没有 video_view 动作的行 → 3 秒播放是 null，不记 0', async () => {
    // 取真实一行，只去掉 video_view 这一个动作（其它 actions 原样保留）
    type RawRow = { actions?: Array<{ action_type: string }> }
    const real = (nalAdsetDaily as RawRow[]).find(x => (x.actions ?? []).some(a => a.action_type === 'video_view'))!
    const stripped = { ...real, actions: (real.actions ?? []).filter(a => a.action_type !== 'video_view') }
    stubGraph([real, stripped])
    const { rows } = await getAdsetDailyInsights('act_953025114498626', 't', '2026-08-17', '2026-09-13')
    expect(rows[0].video_3s_views).toBeGreaterThan(0)
    expect(rows[1].video_3s_views).toBeNull()
  })
})
