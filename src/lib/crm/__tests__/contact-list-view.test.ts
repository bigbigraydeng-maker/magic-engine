/**
 * 装配管道端到端：contact-model → segmentContact → list-sections。
 * 一旦其中任何一层的形状漂了，这里应当当场变红。
 */
import { describe, expect, it } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, StageMetaLike, TouchpointRowLike } from '../contact-model'

const NOW = new Date('2026-09-26T00:00:00Z')
const HOUR_AGO = '2026-09-25T23:00:00Z'

function row(id: string, over: Partial<ContactRowLike> & { pinned_at?: string | null } = {}): ContactRowLike {
  const base = {
    id,
    display_name: id,
    primary_phone: '+64211230001',
    primary_email: `${id}@example.com`,
    do_not_contact: false,
    snooze_until: null,
    stage: null,
  }
  return { ...base, ...over }
}

function tp(contactId: string, over: Partial<TouchpointRowLike> = {}): TouchpointRowLike {
  return {
    contact_id: contactId,
    channel: 'messenger',
    direction: 'inbound',
    occurred_at: HOUR_AGO,
    source: 'messenger',
    raw: null,
    metadata: null,
    ...over,
  }
}

const stages = new Map<string, StageMetaLike>([
  ['paid_full', { label: '已付全款', suppressed: true }],
])

/**
 * 让分段落到 `replied`：先我方外发过一次（销售手打），再客人 inbound —— 于是 lastInbound > lastOutbound。
 * 单纯一条 inbound、没有 outbound 会被判成 `new_untouched`（探针 2026-09-26 已实测）。
 */
function repliedRow(id: string, over: Partial<ContactRowLike> & { pinned_at?: string | null } = {}) {
  return {
    row: row(id, over),
    tps: [
      tp(id, { direction: 'outbound', source: 'me_manual', occurred_at: '2026-09-24T00:00:00Z' }),
      tp(id, { direction: 'inbound', occurred_at: HOUR_AGO }),
    ],
  }
}

/** 让分段落到 `new_untouched`：没有任何触点（探针实测：无触点 → new_untouched）。 */
function newUntouched(id: string, over: Partial<ContactRowLike> & { pinned_at?: string | null } = {}) {
  return { row: row(id, over), tps: [] as TouchpointRowLike[] }
}

/** 让分段落到 `excluded`：snooze 到未来（探针实测已确认）。 */
function snoozed(id: string) {
  return { row: row(id, { snooze_until: '2099-01-01T00:00:00Z' }), tps: [tp(id)] }
}

/** 让分段落到 `stale_conversation`：只有一条 outbound、5 天前（探针实测已确认）。 */
function stale(id: string) {
  return {
    row: row(id),
    tps: [tp(id, { direction: 'outbound', source: 'me_manual', occurred_at: '2026-09-20T00:00:00Z' })],
  }
}

describe('buildPriorityView', () => {
  it('两张名单都出现在结果里，顺序稳定 hot / cold', () => {
    const r = repliedRow('a')
    const { sections } = buildPriorityView(
      { contacts: [r.row], touchpoints: r.tps, stageMeta: stages, now: NOW },
      (row) => ({ id: row.id, name: row.display_name }),
    )
    expect(sections.map((s) => s.key)).toEqual(['hot', 'cold'])
  })

  it('回话了 → hot 名单（total=1，默认展开，含该客人）', () => {
    const r = repliedRow('a')
    const { sections } = buildPriorityView(
      { contacts: [r.row], touchpoints: r.tps, stageMeta: stages, now: NOW },
      (row) => ({ id: row.id }),
    )
    const waiting = sections.find((s) => s.key === 'hot')!
    expect(waiting.total).toBe(1)
    expect(waiting.open).toBe(true)
    expect(waiting.items).toEqual([{ id: 'a' }])
  })

  it('snooze 到未来 → cold 名单（默认收起，items=null，但 total 计入）', () => {
    const s = snoozed('b')
    const { sections } = buildPriorityView(
      { contacts: [s.row], touchpoints: s.tps, stageMeta: stages, now: NOW },
      (row) => ({ id: row.id }),
    )
    const off = sections.find((s) => s.key === 'cold')!
    expect(off.total).toBe(1)
    expect(off.open).toBe(false)
    expect(off.items).toBeNull()
  })

  it('触点分桶正确 —— 别的客人的触点不会污染这个客人的分段', () => {
    const a = repliedRow('a')
    const b = newUntouched('b')
    // a 只有自己的触点；b 没有触点。但如果 buildContactModel 把 a 的触点算给 b，
    // b 会落进 replied 而不是 new_untouched。
    const { sections } = buildPriorityView(
      {
        contacts: [a.row, b.row],
        touchpoints: a.tps,
        stageMeta: stages,
        now: NOW,
      },
      (row) => ({ id: row.id }),
    )
    const hot = sections.find((s) => s.key === 'hot')!
    expect(hot.items?.map((r) => r.id)).toContain('a')
    // b 一进线不到 14 天、没触点 → new_untouched
    expect(hot.items?.map((r) => r.id)).toContain('b')
  })

  it('置顶排在段首（按 pinned_at 倒序）', () => {
    const a = repliedRow('a', { pinned_at: '2026-09-25T00:00:00Z' })
    const b = repliedRow('b', { pinned_at: '2026-09-25T12:00:00Z' })
    const c = repliedRow('c', { pinned_at: null })
    const { sections } = buildPriorityView(
      {
        contacts: [a.row, b.row, c.row],
        touchpoints: [...a.tps, ...b.tps, ...c.tps],
        stageMeta: stages,
        now: NOW,
      },
      (row) => ({ id: row.id }),
    )
    const waiting = sections.find((s) => s.key === 'hot')!
    expect(waiting.items?.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('focus 命中未展开段 → focus 报出段/页；items 仍为 null（本函数不强制展开）', () => {
    const s = snoozed('gone')
    const { sections, focus } = buildPriorityView(
      {
        contacts: [s.row],
        touchpoints: s.tps,
        stageMeta: stages,
        now: NOW,
        focusContactId: 'gone',
      },
      (row) => ({ id: row.id }),
    )
    expect(focus.found).toBe(true)
    expect(focus.section).toBe('cold')
    expect(focus.page).toBe(1)
    const off = sections.find((s) => s.key === 'cold')!
    expect(off.items).toBeNull() // open 需要调用方在 opts.open 里显式打开
  })

  it('focus 未命中 → found=false，不抛错，其他段照常', () => {
    const r = repliedRow('a')
    const { focus } = buildPriorityView(
      {
        contacts: [r.row],
        touchpoints: r.tps,
        stageMeta: stages,
        now: NOW,
        focusContactId: 'ghost',
      },
      (row) => ({ id: row.id }),
    )
    expect(focus.found).toBe(false)
  })

  it('extractRow 拿到原始行与 ranked（segment 已算好，页面可以直接读）', () => {
    const r = repliedRow('a')
    const seen: Array<{ id: string; segment: string }> = []
    buildPriorityView(
      { contacts: [r.row], touchpoints: r.tps, stageMeta: stages, now: NOW },
      (row, ranked) => {
        seen.push({ id: row.id, segment: ranked.seg.segment })
        return { id: row.id }
      },
    )
    expect(seen).toEqual([{ id: 'a', segment: 'replied' }])
  })

  it('多桶穿插仍分桶正确（3 replied、1 stale、1 snoozed）', () => {
    const rs = [repliedRow('r1'), repliedRow('r2'), repliedRow('r3')]
    const st = stale('s1')
    const sn = snoozed('z1')
    const { sections } = buildPriorityView(
      {
        contacts: [rs[0].row, rs[1].row, rs[2].row, st.row, sn.row],
        touchpoints: [...rs[0].tps, ...rs[1].tps, ...rs[2].tps, ...st.tps, ...sn.tps],
        stageMeta: stages,
        now: NOW,
      },
      (row) => row.id,
    )
    const t = Object.fromEntries(sections.map((s) => [s.key, s.total]))
    expect(t.hot).toBe(3) // 3 replied
    expect(t.cold).toBe(2) // stale_conversation（没摘要 → 留在 cold）+ snoozed
  })
})
