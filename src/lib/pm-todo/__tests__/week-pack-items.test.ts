import { describe, expect, it } from 'vitest'

import { weekPackSubject } from '@/lib/social/week-pack/facts'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import {
  buildWeekPackTodoItems,
  notesForClients,
  openUnpublishedNotes,
  pushWeekPackItems,
  readHandledPack,
  recoveryKey,
  stillNeedsReminder,
  type ItemRecovery,
  type UnpublishedNote,
  type WeekPackTodoSource,
} from '../week-pack-items'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const FRIDAY_NZ = new Date('2026-11-05T21:00:00.000Z')
const MONDAY_NZ = new Date('2026-11-08T21:00:00.000Z')

function source(overrides: Partial<WeekPackTodoSource> = {}): WeekPackTodoSource {
  return {
    configs: [{ id: CLIENT, name: '示例客户', config: null }],
    pending: [],
    handled: [],
    held: [],
    unpublished: [],
    ...overrides,
  }
}

describe('week pack todos', () => {
  it('stays quiet while the switch is off', () => {
    expect(buildWeekPackTodoItems(source(), FRIDAY_NZ, false)).toEqual([])
  })

  it('asks for the pack on the approve day, and says unreadable instead of nothing', () => {
    const due = buildWeekPackTodoItems(source(), FRIDAY_NZ, true)
    expect(due.map((item) => item.kind)).toEqual(['week_pack_needs_approval'])
    expect(due[0].href).toContain('#approve-week')
    expect(due[0].what).toContain('还没批')
    const quiet = buildWeekPackTodoItems(source(), MONDAY_NZ, true)
    expect(quiet).toEqual([])
    const unread = buildWeekPackTodoItems(source({ pending: 'unread' }), MONDAY_NZ, true)
    expect(unread[0].what).toContain('读不到')
    expect(unread[0].what).not.toContain('没有人待批的 0')
  })

  it('surfaces held rows without rolling the pack back in the wording', () => {
    const items = buildWeekPackTodoItems(source({
      held: [{ clientId: CLIENT, stories: 2, reels: 1 }],
    }), MONDAY_NZ, true)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('week_pack_items_held')
    expect(items[0].what).toContain('单独拦下 3 条')
    expect(items[0].how).toContain('视频工厂')
    expect(items[0].href).toContain('/story')
  })

  it('does not remind when this week was already approved or turned down', () => {
    const subject = weekPackSubject(CLIENT, '2026-11-09')
    const approved = buildWeekPackTodoItems(source({
      handled: [{ clientId: CLIENT, subjectKey: subject }],
    }), FRIDAY_NZ, true)
    expect(approved.filter((item) => item.kind === 'week_pack_needs_approval')).toEqual([])
    const otherWeek = buildWeekPackTodoItems(source({
      handled: [{ clientId: CLIENT, subjectKey: weekPackSubject(CLIENT, '2026-11-02') }],
    }), FRIDAY_NZ, true)
    expect(otherWeek.map((item) => item.kind)).toEqual(['week_pack_needs_approval'])
    expect(readHandledPack({
      clientId: CLIENT, status: 'authorized', subjectKey: subject, reason: '',
    })?.subjectKey).toBe(subject)
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: 'OPC不做',
    })).not.toBeNull()
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: '过了 30 分钟没人点，这张卡作废了',
    })).toBeNull()
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: '要确认的内容变了，这张旧卡作废',
    })).toBeNull()
  })

  it('reminds about each unpublished failure after the pack was already approved', () => {
    const subject = weekPackSubject(CLIENT, '2026-11-09')
    const items = buildWeekPackTodoItems(source({
      handled: [{ clientId: CLIENT, subjectKey: subject }],
      unpublished: [
        { clientId: CLIENT, kind: 'story', text: 'Story 没授权：这一点仍要全局管理员来点。' },
        { clientId: CLIENT, kind: 'reel', text: '有一条视频还没预览，没有公开。' },
      ],
    }), FRIDAY_NZ, true)
    expect(items.map((item) => item.kind)).toEqual(['week_pack_items_held', 'week_pack_items_held'])
    expect(items[0].what).toContain('已经点过同意')
    expect(items[0].what).toContain('全局管理员')
    expect(items[0].href).toContain('/story')
    expect(items[1].what).toContain('还没预览')
    expect(items[1].href).toContain('#approve-week')
    const quietDay = buildWeekPackTodoItems(source({
      unpublished: [{ clientId: CLIENT, kind: 'reel', text: '有一条视频还没预览，没有公开。' }],
    }), MONDAY_NZ, true)
    expect(quietDay).toHaveLength(1)
  })

  it('does not touch the database when the switch is off', async () => {
    const supabase = { from: () => { throw new Error('should not query') } }
    const bucket: unknown[] = []
    await pushWeekPackItems(supabase as never, bucket as never, FRIDAY_NZ, () => '示例客户', {}, [CLIENT])
    expect(bucket).toEqual([])
  })

  it('keeps Friday failures visible on Monday until that item is recovered', async () => {
    expect(targetWeek(MONDAY_NZ).weekStart).toBe('2026-11-16')
    const fridaySubject = weekPackSubject(CLIENT, '2026-11-09')
    const parsed = notesForClients([{
      clientId: CLIENT,
      subjectKey: fridaySubject,
      evidence: heldBlock([
        line('reel', REEL, 'preview_required', '有一条视频还没预览，没有公开。'),
      ]),
    }], [CLIENT], MONDAY_NZ)
    expect(parsed).not.toBe('unread')
    if (parsed === 'unread') return
    expect(parsed.map((note) => note.stableId)).toEqual([REEL])

    const bucket: Array<{ what: string; how: string; href: string }> = []
    await pushWeekPackItems(todoDb({
      clients: { rows: [{ id: CLIENT, publishing_calendar_config: null }] },
      action_runs: { rows: [approvedCard(fridaySubject)] },
      story_items: { rows: [] },
      story_packs: { rows: [{ id: PACK, client_id: CLIENT, authorized_at: null, revoked_at: null }] },
      content_work_orders: { rows: [
        { id: REEL, client_id: CLIENT, status: 'published', published_ref: { video_state: 'PUBLISHED' } },
        {
          id: COMMENT, client_id: CLIENT, status: 'published',
          published_ref: { video_state: 'PUBLISHED', first_comment_pending: true },
        },
      ] },
    }) as never, bucket as never, MONDAY_NZ, () => '示例客户', { WEEKLY_PACK_APPROVAL_ENABLED: 'true' }, [CLIENT])
    expect(bucket.map((item) => item.what).join('\n')).not.toContain('还没预览')
    expect(bucket.map((item) => item.what).join('\n')).toContain('这一条没有发出去')
    expect(bucket.map((item) => item.href).join('\n')).toContain('/story')
    const comment = bucket.find((item) => item.what.includes('第一条评论'))
    expect(comment?.what).toContain('视频已经公开')
    expect(comment?.what).not.toContain('这一条没有发出去')
    expect(comment?.how).toBe('视频已经公开。打开视频工厂，给这条补发第一条评论。')
    expect(comment?.href).toContain('/dashboard/factory')
  })

  it('stops reminding only when the same client item has actually recovered', () => {
    const story = openNote('story', PACK, 'story_forbidden', 'Story 没授权：这一点仍要全局管理员来点。')
    const reel = openNote('reel', REEL, 'preview_required', '有一条视频还没预览，没有公开。')
    const comment = openNote('reel', COMMENT, 'first_comment_failed', '视频已经公开，第一条评论没有发出去。')
    const unread = openNote('story', null, 'story_unread', 'Story 读不到，没有当成 0 条。')
    const facts = new Map<string, ItemRecovery>([
      [recoveryKey(CLIENT, 'story', PACK), storyFact(CLIENT, '2026-11-06T00:00:00.000Z', null)],
      [recoveryKey(CLIENT, 'reel', REEL), reelFact(CLIENT, 'PUBLISHED', false)],
      [recoveryKey(CLIENT, 'reel', COMMENT), reelFact(CLIENT, 'PUBLISHED', true)],
    ])
    expect(openUnpublishedNotes([story, reel, comment, unread], facts).map((note) => note.code)).toEqual([
      'first_comment_failed', 'story_unread',
    ])
    expect(stillNeedsReminder(story, storyFact(OTHER, '2026-11-06T00:00:00.000Z', null))).toBe(true)
    expect(stillNeedsReminder(story, storyFact(CLIENT, '2026-11-06T00:00:00.000Z', '2026-11-07T00:00:00.000Z'))).toBe(true)
    expect(stillNeedsReminder(story, null)).toBe(true)
    expect(stillNeedsReminder(reel, reelFact(CLIENT, 'DRAFT', false))).toBe(true)
    expect(stillNeedsReminder(comment, reelFact(CLIENT, 'PUBLISHED', false))).toBe(false)
    expect(stillNeedsReminder(comment, null)).toBe(true)
  })

  it('does not treat an unreadable recovery check as zero failures', async () => {
    const bucket: Array<{ what: string }> = []
    await pushWeekPackItems(todoDb({
      clients: { rows: [{ id: CLIENT, publishing_calendar_config: null }] },
      action_runs: { rows: [approvedCard(weekPackSubject(CLIENT, '2026-11-09'))] },
      story_items: { rows: [] },
      story_packs: { rows: [], error: { message: 'down' } },
      content_work_orders: { rows: [] },
    }) as never, bucket as never, MONDAY_NZ, () => '示例客户', { WEEKLY_PACK_APPROVAL_ENABLED: 'true' }, [CLIENT])
    expect(bucket.map((item) => item.what).join('\n')).toContain('读不到')
    expect(bucket.map((item) => item.what).join('\n')).not.toContain('还没预览')
  })
})

const PACK = '44444444-4444-4444-8444-444444444444'
const REEL = '33333333-3333-4333-8333-333333333333'
const COMMENT = '55555555-5555-4555-8555-555555555555'
const OTHER = '22222222-2222-4222-8222-222222222222'

function line(kind: 'story' | 'reel', stableId: string, code: string, text: string) {
  return { kind, stable_id: stableId, code, ok: false, text }
}

function heldBlock(items: Array<ReturnType<typeof line>>) {
  return { week_pack_unpublished: { recorded_at: '2026-11-06T00:00:00.000Z', items } }
}

function approvedCard(subjectKey: string) {
  return {
    client_id: CLIENT,
    status: 'authorized',
    action_key: 'governance.p0_confirmation',
    input: { subject_key: subjectKey },
    evidence: heldBlock([
      line('story', PACK, 'story_forbidden', 'Story 没授权：这一点仍要全局管理员来点。'),
      line('reel', REEL, 'preview_required', '有一条视频还没预览，没有公开。'),
      line('reel', COMMENT, 'first_comment_failed', '视频已经公开，第一条评论没有发出去。'),
    ]),
  }
}

function openNote(kind: UnpublishedNote['kind'], stableId: string | null, code: string, text: string): UnpublishedNote {
  return { clientId: CLIENT, kind, stableId, code, text }
}

function storyFact(clientId: string, authorizedAt: string | null, revokedAt: string | null): ItemRecovery {
  return { clientId, storyAuthorizedAt: authorizedAt, storyRevokedAt: revokedAt, videoState: null, commentPending: false }
}

function reelFact(
  clientId: string,
  videoState: 'DRAFT' | 'PUBLISHED',
  commentPending: boolean,
): ItemRecovery {
  return { clientId, storyAuthorizedAt: null, storyRevokedAt: null, videoState, commentPending }
}

function todoDb(tables: Record<string, { rows: Array<Record<string, unknown>>; error?: { message: string } }>) {
  return {
    from(table: string) {
      const spec = tables[table] ?? { rows: [] }
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          return chain
        },
        in: (column: string, values: readonly unknown[]) => {
          filters.push((row) => values.includes(row[column]))
          return chain
        },
        gte: () => chain,
        lt: () => chain,
        limit: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: null, error: spec.error ?? null }),
        then: (resolve: (value: { data: Array<Record<string, unknown>>; error: { message: string } | null }) => void) => {
          const data = spec.error ? [] : spec.rows.filter((row) => filters.every((keep) => keep(row)))
          resolve({ data, error: spec.error ?? null })
        },
      }
      return chain
    },
  }
}
