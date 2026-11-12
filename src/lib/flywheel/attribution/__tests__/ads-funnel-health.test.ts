/**
 * Funnel health check — weakest segment, thin sample, winner floor,
 * plan/actual mismatch, and the inactive candidate lesson.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_METRIC_KEY } from '../../vocabulary'
import {
  FUNNEL_REASON,
  TENDENCY_MIN_LEADS,
  TENDENCY_MIN_LINK_CLICKS,
  WINNER_MIN_LEADS,
  aggregateDelivery,
  checkAdsFunnel,
  selectWinner,
  toLessonInput,
  type DeliveryDay,
  type DeliverySide,
  type FunnelCheckInput,
  type FunnelUnit,
} from '../ads-funnel-health'
import { mapInsightRow, persistCandidateLesson, recordAdsFunnelCheck } from '../ads-funnel-record'

const lessons: Record<string, unknown>[] = []

function chain(data: unknown) {
  const builder: Record<string, unknown> = {}
  const passthrough = () => builder
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'not', 'limit', 'is']) builder[method] = passthrough
  builder.range = () => Promise.resolve({ data, error: null })
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
  builder.upsert = async (row: Record<string, unknown>) => {
    lessons.push(row)
    return { error: null }
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'ad_daily_insights') return chain([])
      if (table === 'global_learned_lessons') return chain(null)
      if (table === 'clients') return { select: async () => ({ data: [], error: null }) }
      if (table === 'contacts') {
        return { select: () => ({ not: () => ({ limit: async () => ({ data: [], error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

function unit(over: Partial<FunnelUnit> & Pick<FunnelUnit, 'id'>): FunnelUnit {
  return {
    adAccountId: 'acct-a',
    spend: 250,
    impressions: 10_000,
    linkClicks: 500,
    leads: 25,
    formOpens: null,
    videoP100: null,
    videoThruPlay: null,
    ...over,
  }
}

function check(subject: FunnelUnit, peers: FunnelUnit[], plan: DeliverySide | null = null, actual: DeliverySide | null = null) {
  const input: FunnelCheckInput = { plan, actual, subject, peers }
  return checkAdsFunnel(input)
}

const winner = unit({ id: 'ad-win' })

beforeEach(() => {
  lessons.length = 0
})

describe('ads funnel health', () => {
  it('flags the weakest segment against the account winner', () => {
    const subject = unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20 })
    const result = check(subject, [winner])
    expect(result.weakestSegment).toBe('link_ctr')
    expect(result.verdict).toBe('reversed')
    expect(result.strength).toBe('decided')
    expect(result.reading).toBe('reversed')
    expect(result.winnerId).toBe('ad-win')
    expect(['confirmed', 'inconclusive', 'reversed']).toContain(result.verdict)
  })

  it('treats fewer than 100 link clicks or 5 leads as a tendency only', () => {
    const thinClicks = unit({ id: 'ad-sub', impressions: 4950, spend: 198, linkClicks: TENDENCY_MIN_LINK_CLICKS - 1, leads: 10 })
    const byClicks = check(thinClicks, [winner])
    expect(byClicks.strength).toBe('tendency')
    expect(byClicks.verdict).toBe('inconclusive')
    expect(byClicks.reasonCode).toBe(FUNNEL_REASON.below_min_sample)
    expect(byClicks.reading).toBe('reversed')
    expect(byClicks.weakestSegment).toBe('link_ctr')

    const thinLeads = unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: TENDENCY_MIN_LEADS - 1 })
    const byLeads = check(thinLeads, [winner])
    expect(byLeads.strength).toBe('tendency')
    expect(byLeads.verdict).toBe('inconclusive')

    const enough = unit({ id: 'ad-edge', impressions: 2500, spend: 100, linkClicks: TENDENCY_MIN_LINK_CLICKS, leads: TENDENCY_MIN_LEADS })
    const decided = check(enough, [unit({ id: 'ad-win', spend: 200, linkClicks: 400, leads: 20 })])
    expect(decided.strength).toBe('decided')
    expect(decided.verdict).toBe('reversed')
    expect(decided.weakestSegment).toBe('cpm')
  })

  it('refuses a winner baseline below 20 leads and accepts one at 20', () => {
    const subject = unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20 })
    const tooSmall = unit({ id: 'ad-small', leads: WINNER_MIN_LEADS - 1 })
    expect(selectWinner([tooSmall], subject.id)).toBeNull()
    expect(check(subject, [tooSmall]).verdict).toBe('inconclusive')
    expect(check(subject, [tooSmall]).reasonCode).toBe(FUNNEL_REASON.no_baseline)
    expect(check(subject, [tooSmall]).weakestSegment).toBeNull()

    const exactly = unit({ id: 'ad-exact', leads: WINNER_MIN_LEADS, spend: 200, linkClicks: 400 })
    expect(selectWinner([exactly, tooSmall], null)?.id).toBe('ad-exact')
    expect(check(subject, [exactly]).winnerId).toBe('ad-exact')
  })

  it('is inconclusive when the plan and the delivery disagree', () => {
    const subject = unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20 })
    const plan = { objective: 'OUTCOME_LEADS', destinationType: 'ON_AD', entityId: 'ad-sub', adAccountId: 'acct-a' }
    const actual = { ...plan, objective: 'OUTCOME_AWARENESS' }
    const result = check(subject, [winner], plan, actual)
    expect(result.verdict).toBe('inconclusive')
    expect(result.reasonCode).toBe(FUNNEL_REASON.plan_actual_mismatch)
    expect(result.weakestSegment).toBeNull()
    expect(result.strength).toBeNull()
    expect(result.verdict).not.toBe('unknown')
  })

  it('uses link_click from actions, keeps form opens when reported, and does not mix video counts', () => {
    const row = mapInsightRow({
      ad_account_id: 'acct-a',
      entity_id: 'ad-sub',
      spend: 10,
      impressions: 1000,
      clicks: 999,
      ctr: 0.9,
      leads: 2,
      actions: [
        { action_type: 'link_click', value: '4' },
        { action_type: 'onsite_conversion.leadgen_form_open', value: '3' },
      ],
      video_p100: 11,
      video_thruplays: 80,
    })
    expect(row?.actions?.find((entry) => entry.action_type === 'link_click')?.value).toBe('4')
    const [summed] = aggregateDelivery([row as DeliveryDay])
    expect(summed.linkClicks).toBe(4)
    expect(summed.formOpens).toBe(3)
    expect(summed.videoP100).toBe(11)
    expect(summed.videoThruPlay).toBe(80)
    const hole = aggregateDelivery([{
      adAccountId: 'acct-a', entityId: 'ad-sub', spend: 10, impressions: 100, leads: 1,
      actions: null, videoP100: null, videoThruPlay: null,
    }])
    expect(hole[0].linkClicks).toBeNull()
    expect(check(unit({ id: 'ad-sub', linkClicks: null }), [winner]).reasonCode).toBe(FUNNEL_REASON.missing_data)

    const opened = unit({ id: 'ad-sub', linkClicks: 500, formOpens: 50, leads: 5, spend: 250 })
    const openedWinner = unit({ id: 'ad-win', formOpens: 100 })
    const withOpens = check(opened, [openedWinner])
    expect(withOpens.formCompletionBasis).toBe('form_open')
    expect(withOpens.weakestSegment).toBe('form_completion')

    const swapped = check(
      unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20, videoP100: 80, videoThruPlay: 11 }),
      [unit({ id: 'ad-win', videoP100: 11, videoThruPlay: 80 })],
    )
    const original = check(
      unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20, videoP100: 11, videoThruPlay: 80 }),
      [winner],
    )
    expect(swapped.weakestSegment).toBe(original.weakestSegment)
    expect(swapped.verdict).toBe(original.verdict)
    expect(swapped.subjectVideoP100).toBe(80)
    expect(swapped.subjectVideoThruPlay).toBe(11)
    expect(swapped.videoP100Meaning).toContain('not ThruPlay')
    expect(swapped.videoThruPlayMeaning).toContain('not video_p100')
  })

  it('writes the prescription as an inactive candidate lesson', async () => {
    const result = check(unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20 }), [winner])
    const lesson = toLessonInput(result)
    expect(lesson?.isActive).toBe(false)
    expect(lesson?.evidence).toMatchObject({ candidate: true, kind: 'candidate', segment: 'link_ctr' })

    const upserted: Record<string, unknown>[] = []
    let stored = false
    const supabase = {
      from(table: string) {
        if (table === 'clients') return { select: async () => ({ data: [], error: null }) }
        if (table === 'contacts') return { select: () => ({ not: () => ({ limit: async () => ({ data: [], error: null }) }) }) }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored ? { lesson_key: lesson?.lessonKey } : null, error: null }) }) }),
          upsert: async (row: Record<string, unknown>) => {
            stored = true
            upserted.push(row)
            return { error: null }
          },
        }
      },
    } as unknown as SupabaseClient

    const saved = await persistCandidateLesson(supabase, lesson!)
    expect(saved.ok).toBe(true)
    expect(upserted).toHaveLength(1)
    expect(upserted[0].is_active).toBe(false)
    expect(upserted[0].evidence).toMatchObject({ candidate: true })

    const again = await persistCandidateLesson(supabase, { ...lesson!, isActive: true })
    expect(again).toMatchObject({ ok: true, skipped: true })
    expect(upserted).toHaveLength(1)
  })

  it('saves only the candidate lesson and leaves CPL attribution to the job', async () => {
    const subject = unit({ id: 'ad-sub', spend: 400, linkClicks: 200, leads: 20 })
    const recorded = await recordAdsFunnelCheck({
      id: 'action-1',
      client_id: 'client-1',
      expected_metric: ADS_METRIC_KEY.COST_PER_LEAD,
      executed_at: '2026-10-01T00:00:00.000Z',
      payload: { funnel_health: { plan: null, actual: null, subject, peers: [winner] } },
    }, 14)
    expect(recorded.checked).toBe(true)
    expect(recorded.errors).toEqual([])
    expect(lessons).toHaveLength(1)
    expect(lessons[0].is_active).toBe(false)

    const other = await recordAdsFunnelCheck({
      id: 'action-2',
      client_id: 'client-1',
      expected_metric: 'geo.query.mention_rate',
      executed_at: '2026-10-01T00:00:00.000Z',
      payload: null,
    }, 14)
    expect(other.checked).toBe(false)
    expect(lessons).toHaveLength(1)
  })
})
