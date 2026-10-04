import { describe, expect, it } from 'vitest'
import { executionItemDedupKey, SEO_PLAN_LOOP, transitionSeoPlanItem, writeSeoPlanItems, type SeoPlanItemInsert } from '@/lib/zhuge/action-persister'
import { supersedeStaleZhugeCards } from '@/lib/zhuge/card-expiry'
import { buildCardSuppression } from '@/lib/seo-patrol/job'
import { FakeDb } from './fake-supabase'

const CID = 'c1'
const item = (keyword: string | null, url: string | null, actionType = 'seo.plan.draft_post'): SeoPlanItemInsert => ({
  actionType, title: `t-${keyword ?? url}`, description: 'd', keyword, url, dueDate: '2026-10-06', initiativeId: 'ini-1',
  stepsJson: { loop: SEO_PLAN_LOOP, keyword, url },
})

describe('writeSeoPlanItems', () => {
  it('inserts source=zhuge pending rows with initiative, due date and the loop marker', async () => {
    const db = new FakeDb()
    const r = await writeSeoPlanItems(db.client(), CID, [item('alpha', null), item(null, 'https://x.com/p', 'seo.plan.strengthen_page')])
    expect(r.inserted).toBe(2)
    const rows = db.rows('execution_items')
    expect(rows.every(x => x.source === 'zhuge' && x.status === 'pending' && x.dimension === 'seo' && x.initiative_id === 'ini-1')).toBe(true)
    expect(rows.every(x => (x.steps_json as { loop: string }).loop === SEO_PLAN_LOOP)).toBe(true)
  })

  it('a still-open item with the same key is skipped (never superseded); a different keyword of the same type is not', async () => {
    const db = new FakeDb()
    await writeSeoPlanItems(db.client(), CID, [item('alpha', null)])
    const again = await writeSeoPlanItems(db.client(), CID, [item('alpha', null), item('beta', null)])
    expect(again).toMatchObject({ inserted: 1, duplicates: 1 })
    expect(db.rows('execution_items').filter(r => r.status === 'superseded')).toHaveLength(0)
    expect(db.rows('execution_items')).toHaveLength(2)
  })

  it('does not collide with a patrol card of the same keyword (different action_type)', async () => {
    const db = new FakeDb({ execution_items: [{ id: 'p1', client_id: CID, dimension: 'seo', status: 'pending', source: 'zhuge', action_type: 'seo.refresh_blog', steps_json: { keyword: 'alpha', rule_id: 'stale_content' } }] })
    const r = await writeSeoPlanItems(db.client(), CID, [item('alpha', null)])
    expect(r.inserted).toBe(1)
    expect(db.rows('execution_items').find(x => x.id === 'p1')?.status).toBe('pending')
  })

  it('dedup key reads TOP-LEVEL keyword/url (the guard the design depends on)', () => {
    expect(executionItemDedupKey('seo.plan.draft_post', 'Alpha', null)).not.toBe(executionItemDedupKey('seo.plan.draft_post', 'Beta', null))
  })
})

describe('transitionSeoPlanItem', () => {
  const open = () => new FakeDb({ execution_items: [{ id: 'i1', client_id: CID, dimension: 'seo', status: 'pending', source: 'zhuge', steps_json: { loop: SEO_PLAN_LOOP } }] })

  it('writes the audit row, then flips status; completed gets completed_at', async () => {
    const db = open()
    await transitionSeoPlanItem(db.client(), { id: 'i1', clientId: CID, to: 'completed', reason: 'ok', stepsJson: { loop: SEO_PLAN_LOOP, verify: { state: 'pass' } }, now: new Date('2026-10-12T00:00:00Z') })
    const row = db.rows('execution_items')[0]
    expect(row.status).toBe('completed')
    expect(row.completed_at).toBe('2026-10-12T00:00:00.000Z')
    const log = db.rows('execution_logs')[0]
    expect(log).toMatchObject({ execution_item_id: 'i1', author: 'system', kind: 'status_change' })
    expect((log.meta as { verified: boolean }).verified).toBe(true)
  })

  it('if the audit row cannot be written, the card is NOT completed', async () => {
    const db = open()
    db.writeErrors.execution_logs = 'boom'
    await expect(transitionSeoPlanItem(db.client(), { id: 'i1', clientId: CID, to: 'completed', reason: 'ok', stepsJson: {} })).rejects.toThrow(/audit log/)
    expect(db.rows('execution_items')[0].status).toBe('pending')
  })

  it('skipped does not set completed_at and is not marked verified', async () => {
    const db = open()
    await transitionSeoPlanItem(db.client(), { id: 'i1', clientId: CID, to: 'skipped', reason: 'expired_no_action', stepsJson: { skip_reason: 'expired_no_action' } })
    expect(db.rows('execution_items')[0].completed_at).toBeUndefined()
    expect((db.rows('execution_logs')[0].meta as { verified: boolean }).verified).toBe(false)
  })
})

describe('isolation from the old card machinery', () => {
  it('14-day auto-expiry supersedes an old patrol card but never an old list item', async () => {
    const old = '2026-01-01T00:00:00Z'
    const db = new FakeDb({
      execution_items: [
        { id: 'patrol', status: 'pending', source: 'zhuge', created_at: old, steps_json: { rule_id: 'stale_content', keyword: 'k' } },
        { id: 'noMeta', status: 'pending', source: 'zhuge', created_at: old, steps_json: null },
        { id: 'plan', status: 'pending', source: 'zhuge', created_at: old, steps_json: { loop: SEO_PLAN_LOOP, keyword: 'k' } },
      ],
    })
    const r = await supersedeStaleZhugeCards(db.client(), new Date('2026-10-05T00:00:00Z'))
    expect(r.superseded).toBe(2)
    expect(db.rows('execution_items').find(x => x.id === 'plan')?.status).toBe('pending')
    expect(db.rows('execution_items').find(x => x.id === 'patrol')?.status).toBe('superseded')
  })

  it('list items do not consume the patrol weekly card cap (no rule_id) and do not block patrol keys', () => {
    const now = new Date('2026-10-05T00:00:00Z')
    const plan = { action_type: 'seo.plan.draft_post', status: 'pending', source: 'zhuge', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'alpha' }, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }
    const s = buildCardSuppression([plan], now)
    expect(s.openedLast7Days).toBe(0)
    expect(s.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'alpha', null))).toBe(false)
  })
})

describe('review hardening', () => {
  it('writeExecutionItems for a patrol action never supersedes a list item, even on the same keyword', async () => {
    const { writeExecutionItems } = await import('@/lib/zhuge/action-persister')
    const db = new FakeDb()
    await writeSeoPlanItems(db.client(), CID, [item('alpha', null)])
    await writeExecutionItems(db.client(), CID, null, [{
      rank: 1, dimension: 'seo', action_type: 'seo.refresh_blog', why_now: 'w', evidence_refs: [], expected_impact: 'high', effort: 'low',
      execution_mode: 'in_house', executable_by: null, metadata: { keyword: 'alpha', rule_id: 'stale_content' },
    }])
    const plan = db.rows('execution_items').find(r => r.action_type === 'seo.plan.draft_post')!
    expect(plan.status).toBe('pending')
  })

  it('transition returns false and leaves a correcting audit row when the card was already closed by someone else', async () => {
    const db = new FakeDb({ execution_items: [{ id: 'i1', client_id: CID, dimension: 'seo', status: 'superseded', source: 'zhuge', steps_json: {} }] })
    const ok = await transitionSeoPlanItem(db.client(), { id: 'i1', clientId: CID, to: 'completed', reason: 'ok', stepsJson: {} })
    expect(ok).toBe(false)
    expect(db.rows('execution_items')[0].status).toBe('superseded')
    expect(db.rows('execution_logs').some(l => (l.meta as { applied?: boolean }).applied === false)).toBe(true)
  })

  it('transition is scoped to the client: another client\'s card id cannot be closed', async () => {
    const db = new FakeDb({ execution_items: [{ id: 'i1', client_id: 'other', dimension: 'seo', status: 'pending', source: 'zhuge', steps_json: {} }] })
    const ok = await transitionSeoPlanItem(db.client(), { id: 'i1', clientId: CID, to: 'skipped', reason: 'x', stepsJson: {} })
    expect(ok).toBe(false)
    expect(db.rows('execution_items')[0].status).toBe('pending')
  })

  it('two overlapping runs that both pass the "already open?" read end with ONE open item (smallest id wins, loser skipped with a reason)', async () => {
    const db = new FakeDb()
    // simulate the race: run A inserted just before run B's insert (B's read happened earlier)
    await writeSeoPlanItems(db.client(), CID, [item('alpha', null)])
    const winner = db.rows('execution_items')[0].id as string
    // run B bypasses its (stale) dedup read by inserting directly, then resolves
    db.rows('execution_items').push({ id: 'zzz-late', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.draft_post', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'alpha', url: null } })
    const { resolveSeoPlanDuplicateRace } = await import('@/lib/zhuge/action-persister')
    await resolveSeoPlanDuplicateRace(db.client(), CID, ['zzz-late'])
    const open = db.rows('execution_items').filter(r => r.status === 'pending')
    expect(open.map(r => r.id)).toEqual([winner])
    const loser = db.rows('execution_items').find(r => r.id === 'zzz-late')!
    expect(loser.status).toBe('skipped')
    expect((loser.steps_json as { skip_reason: string }).skip_reason).toBe('duplicate_race')
  })
})

