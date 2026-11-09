import { describe, it, expect } from 'vitest'
import type { ChangeLogEntry } from '../store-edit'
import {
  ME_TEAM_LABEL,
  SYSTEM_LABEL,
  MAX_CHANGE_VIEWS,
  MAX_SUMMARY_LENGTH,
  parseActor,
  makeActorLabeler,
  maskActorText,
  redactEntryForEditor,
  summariseContributors,
  summariseEntry,
  buildChangeViews,
  trimDepartureForViewer,
} from '../changes-view'

const BATCH_A = 'b0000000-0000-0000-0000-000000000001'
const BATCH_B = 'b0000000-0000-0000-0000-000000000002'

function entry(partial: Partial<ChangeLogEntry>): ChangeLogEntry {
  return {
    id: 'e1',
    entity: 'tour',
    entityId: 't1',
    action: 'update',
    before: null,
    after: null,
    actor: 'edit by a@b.c',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('parseActor', () => {
  it('parses a manual edit', () => {
    expect(parseActor('edit by a@b.c')).toEqual({ email: 'a@b.c', source: 'manual', batchId: null })
  })

  it('parses an assistant edit', () => {
    expect(parseActor('edit by a@b.c (AI 助手)')).toEqual({
      email: 'a@b.c',
      source: 'assistant',
      batchId: null,
    })
  })

  it('parses an import', () => {
    expect(parseActor(`import:${BATCH_A} by a@b.c`)).toEqual({
      email: 'a@b.c',
      source: 'import',
      batchId: BATCH_A,
    })
  })

  it('parses a rollback', () => {
    expect(parseActor(`rollback:${BATCH_A} by a@b.c`)).toEqual({
      email: 'a@b.c',
      source: 'rollback',
      batchId: BATCH_A,
    })
  })

  it('lower-cases the email', () => {
    expect(parseActor('edit by A@B.C')).toEqual({ email: 'a@b.c', source: 'manual', batchId: null })
  })

  it('treats system as system', () => {
    expect(parseActor('system')).toEqual({ email: null, source: 'system', batchId: null })
  })

  it('treats an empty string as system', () => {
    expect(parseActor('')).toEqual({ email: null, source: 'system', batchId: null })
  })

  it('treats a bare edit-by as system', () => {
    expect(parseActor('edit by ')).toEqual({ email: null, source: 'system', batchId: null })
  })

  it('rejects a non-uuid batch id', () => {
    expect(parseActor('import:not-a-uuid by a@b.c')).toEqual({
      email: null,
      source: 'system',
      batchId: null,
    })
  })

  it('treats an unknown string as system', () => {
    expect(parseActor('whatever')).toEqual({ email: null, source: 'system', batchId: null })
  })
})

describe('makeActorLabeler', () => {
  const members = new Set(['staff@client.com'])

  it('shows emails to a global admin', () => {
    const label = makeActorLabeler('me_admin', members)
    expect(label('me@magic.com')).toBe('me@magic.com')
  })

  it('shows member emails to a client editor', () => {
    const label = makeActorLabeler('client_editor', members)
    expect(label('staff@client.com')).toBe('staff@client.com')
  })

  it('masks non-member emails for a client editor', () => {
    const label = makeActorLabeler('client_editor', members)
    expect(label('me@magic.com')).toBe(ME_TEAM_LABEL)
  })

  it('labels null as system', () => {
    const label = makeActorLabeler('client_editor', members)
    expect(label(null)).toBe(SYSTEM_LABEL)
  })
})

describe('maskActorText', () => {
  const label = makeActorLabeler('client_editor', new Set(['staff@client.com']))

  it('keeps the manual shape', () => {
    expect(maskActorText('edit by me@magic.com', label)).toBe(`edit by ${ME_TEAM_LABEL}`)
  })

  it('keeps the assistant shape', () => {
    expect(maskActorText('edit by me@magic.com (AI 助手)', label)).toBe(
      `edit by ${ME_TEAM_LABEL} (AI 助手)`,
    )
  })

  it('keeps the import shape', () => {
    expect(maskActorText(`import:${BATCH_A} by me@magic.com`, label)).toBe(
      `import:${BATCH_A} by ${ME_TEAM_LABEL}`,
    )
  })

  it('keeps the rollback shape', () => {
    expect(maskActorText(`rollback:${BATCH_A} by me@magic.com`, label)).toBe(
      `rollback:${BATCH_A} by ${ME_TEAM_LABEL}`,
    )
  })

  it('returns system for an unknown actor', () => {
    expect(maskActorText('whatever', label)).toBe(SYSTEM_LABEL)
  })
})

describe('redactEntryForEditor', () => {
  const label = makeActorLabeler('client_editor', new Set())

  it('removes the hidden keys from before and after', () => {
    const input = entry({
      before: { internal: { a: 1 }, status_source: 'manual', status_as_of: 'x', depart_on: '2026-01-01' },
      after: { internal: { a: 2 }, status_source: 'auto', status_as_of: 'y', depart_on: '2026-01-02' },
    })
    const out = redactEntryForEditor(input, label)
    expect(out.before).toEqual({ depart_on: '2026-01-01' })
    expect(out.after).toEqual({ depart_on: '2026-01-02' })
  })

  it('does not mutate the input', () => {
    const before = { internal: { a: 1 }, depart_on: '2026-01-01' }
    const input = entry({ before })
    redactEntryForEditor(input, label)
    expect(before).toEqual({ internal: { a: 1 }, depart_on: '2026-01-01' })
    expect(input.before).toBe(before)
  })

  it('keeps a null before as null', () => {
    const out = redactEntryForEditor(entry({ before: null }), label)
    expect(out.before).toBeNull()
  })

  it('masks the actor', () => {
    const out = redactEntryForEditor(entry({ actor: 'edit by me@magic.com' }), label)
    expect(out.actor).toBe(`edit by ${ME_TEAM_LABEL}`)
  })
})

describe('summariseContributors', () => {
  it('counts and sorts by count then label', () => {
    const label = makeActorLabeler('me_admin', new Set())
    const result = summariseContributors(
      ['edit by a@b.c', 'edit by a@b.c', 'edit by b@b.c'],
      label,
    )
    expect(result).toEqual([
      { actorLabel: 'a@b.c', changes: 2 },
      { actorLabel: 'b@b.c', changes: 1 },
    ])
  })

  it('merges two ME emails into one line for an editor', () => {
    const label = makeActorLabeler('client_editor', new Set())
    const result = summariseContributors(['edit by x@magic.com', 'edit by y@magic.com'], label)
    expect(result).toEqual([{ actorLabel: ME_TEAM_LABEL, changes: 2 }])
  })
})

describe('summariseEntry', () => {
  it('summarises a tour price change', () => {
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { display_price_text: 'NZD $7,999' },
      after: { display_price_text: 'NZD $8,111' },
    })
    expect(summariseEntry(e)).toBe('展示价：NZD $7,999 → NZD $8,111')
  })

  it('joins two changed fields with a semicolon', () => {
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { display_price_text: 'NZD $7,999', title: 'Old' },
      after: { display_price_text: 'NZD $8,111', title: 'New' },
    })
    expect(summariseEntry(e)).toBe('对外标题：Old → New；展示价：NZD $7,999 → NZD $8,111')
  })

  it('renders a boolean flip', () => {
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { is_active: true },
      after: { is_active: false },
    })
    expect(summariseEntry(e)).toBe('是否在售：在售 → 停售')
  })

  it('summarises an itinerary change', () => {
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { itinerary: [{ day: 1 }, { day: 2 }] },
      after: { itinerary: [{ day: 1 }, { day: 2 }, { day: 3 }] },
    })
    expect(summariseEntry(e)).toBe('行程安排：已修改（2 天 → 3 天）')
  })

  it('shows （空） for a null to value change', () => {
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { title: null },
      after: { title: 'New' },
    })
    expect(summariseEntry(e)).toBe('对外标题：（空） → New')
  })

  it('truncates a long description and caps the total length', () => {
    const long = 'x'.repeat(300)
    const e = entry({
      entity: 'tour',
      action: 'update',
      before: { short_description: null },
      after: { short_description: long },
    })
    const summary = summariseEntry(e)
    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('summarises a departure insert', () => {
    const e = entry({
      entity: 'departure',
      action: 'insert',
      after: { depart_on: '2026-03-01', status: 'open' },
    })
    expect(summariseEntry(e)).toBe('新增班期 2026-03-01（可订）')
  })

  it('summarises a departure insert with a price override', () => {
    const e = entry({
      entity: 'departure',
      action: 'insert',
      after: { depart_on: '2026-03-01', status: 'open', price_text_override: 'NZD $9,999' },
    })
    expect(summariseEntry(e)).toBe('新增班期 2026-03-01（可订，NZD $9,999）')
  })

  it('summarises a departure delete', () => {
    const e = entry({
      entity: 'departure',
      action: 'delete',
      before: { depart_on: '2026-03-01' },
    })
    expect(summariseEntry(e)).toBe('删除班期 2026-03-01')
  })

  it('summarises a departure status update', () => {
    const e = entry({
      entity: 'departure',
      action: 'update',
      before: { depart_on: '2026-03-01', status: 'open' },
      after: { depart_on: '2026-03-01', status: 'sold_out' },
    })
    expect(summariseEntry(e)).toBe('班期 2026-03-01：状态：可订 → 已满团')
  })

  it('reports no change for an identical update', () => {
    const e = entry({
      entity: 'departure',
      action: 'update',
      before: { depart_on: '2026-03-01', status: 'open' },
      after: { depart_on: '2026-03-01', status: 'open' },
    })
    expect(summariseEntry(e)).toBe('班期 2026-03-01：已保存（内容没有变化）')
  })
})

describe('buildChangeViews', () => {
  const label = makeActorLabeler('me_admin', new Set())

  function importEntry(id: string, action: 'insert' | 'update', tourId: string): ChangeLogEntry {
    return entry({
      id,
      entity: 'departure',
      entityId: id,
      action,
      actor: `import:${BATCH_A} by a@b.c`,
      after: { tour_id: tourId, depart_on: '2026-03-01' },
    })
  }

  it('collapses an import batch into one view at its newest position', () => {
    const entries: ChangeLogEntry[] = []
    for (let i = 0; i < 12; i += 1) {
      entries.push(importEntry(`i${i}`, 'insert', 't1'))
    }
    for (let i = 0; i < 3; i += 1) {
      entries.push(importEntry(`u${i}`, 'update', 't1'))
    }
    entries.push(entry({ id: 'manual1', actor: 'edit by a@b.c' }))
    const views = buildChangeViews(entries, { tourNames: new Map([['t1', 'Tour One']]), label })
    expect(views.length).toBe(2)
    expect(views[0].id).toBe('i0')
    expect(views[0].summary).toBe('出团表导入：新增 12 个班期、更新 3 个')
    expect(views[1].id).toBe('manual1')
  })

  it('summarises a rollback group', () => {
    const entries: ChangeLogEntry[] = []
    for (let i = 0; i < 15; i += 1) {
      entries.push(
        entry({
          id: `r${i}`,
          entity: 'departure',
          entityId: `r${i}`,
          action: 'update',
          actor: `rollback:${BATCH_A} by a@b.c`,
          after: { tour_id: 't1' },
        }),
      )
    }
    const views = buildChangeViews(entries, { tourNames: new Map([['t1', 'Tour One']]), label })
    expect(views.length).toBe(1)
    expect(views[0].summary).toBe('撤销导入：恢复 15 行')
  })

  it('keeps two batches separate', () => {
    const entries: ChangeLogEntry[] = [
      entry({
        id: 'a1',
        entity: 'departure',
        entityId: 'a1',
        action: 'insert',
        actor: `import:${BATCH_A} by a@b.c`,
        after: { tour_id: 't1' },
      }),
      entry({
        id: 'b1',
        entity: 'departure',
        entityId: 'b1',
        action: 'insert',
        actor: `import:${BATCH_B} by a@b.c`,
        after: { tour_id: 't1' },
      }),
    ]
    const views = buildChangeViews(entries, { tourNames: new Map([['t1', 'Tour One']]), label })
    expect(views.length).toBe(2)
    expect(views[0].summary).toBe('出团表导入：新增 1 个班期、更新 0 个')
    expect(views[1].summary).toBe('出团表导入：新增 1 个班期、更新 0 个')
  })

  it('does not collapse manual and assistant rows', () => {
    const entries: ChangeLogEntry[] = [
      entry({ id: 'm1', actor: 'edit by a@b.c' }),
      entry({ id: 'a1', actor: 'edit by a@b.c (AI 助手)' }),
    ]
    const views = buildChangeViews(entries, { tourNames: new Map(), label })
    expect(views.length).toBe(2)
    expect(views[0].source).toBe('manual')
    expect(views[1].source).toBe('assistant')
  })

  it('resolves a tour name from the map for a tour entry', () => {
    const entries: ChangeLogEntry[] = [entry({ id: 't', entity: 'tour', entityId: 't1' })]
    const views = buildChangeViews(entries, { tourNames: new Map([['t1', 'Tour One']]), label })
    expect(views[0].tourId).toBe('t1')
    expect(views[0].tourName).toBe('Tour One')
  })

  it('resolves a tour name for a departure via tour_id', () => {
    const entries: ChangeLogEntry[] = [
      entry({
        id: 'd',
        entity: 'departure',
        entityId: 'd1',
        action: 'insert',
        after: { tour_id: 't1', depart_on: '2026-03-01' },
      }),
    ]
    const views = buildChangeViews(entries, { tourNames: new Map([['t1', 'Tour One']]), label })
    expect(views[0].tourId).toBe('t1')
    expect(views[0].tourName).toBe('Tour One')
  })

  it('marks an unknown actor as system', () => {
    const entries: ChangeLogEntry[] = [entry({ id: 's', actor: 'whatever' })]
    const views = buildChangeViews(entries, { tourNames: new Map(), label })
    expect(views[0].source).toBe('system')
    expect(views[0].actorLabel).toBe(SYSTEM_LABEL)
  })

  it('caps the number of views at 100', () => {
    const entries: ChangeLogEntry[] = []
    for (let i = 0; i < 150; i += 1) {
      entries.push(entry({ id: `e${i}`, actor: 'edit by a@b.c' }))
    }
    const views = buildChangeViews(entries, { tourNames: new Map(), label })
    expect(views.length).toBe(MAX_CHANGE_VIEWS)
  })

  it('gives a collapsed group spanning two tours a null tour', () => {
    const entries: ChangeLogEntry[] = [
      entry({
        id: 'x1',
        entity: 'departure',
        entityId: 'x1',
        action: 'insert',
        actor: `import:${BATCH_A} by a@b.c`,
        after: { tour_id: 't1' },
      }),
      entry({
        id: 'x2',
        entity: 'departure',
        entityId: 'x2',
        action: 'insert',
        actor: `import:${BATCH_A} by a@b.c`,
        after: { tour_id: 't2' },
      }),
    ]
    const views = buildChangeViews(entries, {
      tourNames: new Map([
        ['t1', 'Tour One'],
        ['t2', 'Tour Two'],
      ]),
      label,
    })
    expect(views.length).toBe(1)
    expect(views[0].tourId).toBeNull()
    expect(views[0].tourName).toBe('')
  })
})

describe('buildChangeViews — system runs collapse (reading the website in)', () => {
  const ctx = { tourNames: new Map<string, string>([['t1', 'Tour One']]), label: makeActorLabeler('me_admin', new Set()) }

  /** n system rows one second apart, newest first, starting at `newestIso`. */
  function systemRows(
    prefix: string,
    newestIso: string,
    counts: { tours: number; departures: number },
  ): ChangeLogEntry[] {
    const newest = Date.parse(newestIso)
    const rows: ChangeLogEntry[] = []
    const total = counts.tours + counts.departures
    for (let i = 0; i < total; i += 1) {
      rows.push(
        entry({
          id: `${prefix}-${i}`,
          entity: i < counts.departures ? 'departure' : 'tour',
          entityId: `${prefix}-entity-${i}`,
          action: 'insert',
          after: { name: `Tour ${i}`, tour_id: 't1', depart_on: '2027-01-01', status: 'open' },
          actor: 'seed',
          createdAt: new Date(newest - i * 1000).toISOString(),
        }),
      )
    }
    return rows
  }

  it('54 system rows plus 1 manual edit become 2 views', () => {
    const manual = entry({ id: 'manual', actor: 'edit by a@b.c', createdAt: '2026-10-10T03:00:00.000Z' })
    const seeded = systemRows('s', '2026-10-10T02:00:53.000Z', { tours: 33, departures: 21 })
    const views = buildChangeViews([manual, ...seeded], ctx)
    expect(views).toHaveLength(2)
    expect(views[0].id).toBe('manual')
    expect(views[1]).toEqual({
      id: 's-0',
      createdAt: '2026-10-10T02:00:53.000Z',
      actorLabel: SYSTEM_LABEL,
      source: 'system',
      tourId: null,
      tourName: '',
      summary: '系统：新增 33 个团、21 个班期',
    })
  })

  it('two system batches ten minutes apart stay two views', () => {
    const later = systemRows('b', '2026-10-10T02:10:10.000Z', { tours: 2, departures: 0 })
    const earlier = systemRows('a', '2026-10-10T02:00:10.000Z', { tours: 3, departures: 1 })
    const views = buildChangeViews([...later, ...earlier], ctx)
    expect(views.map((view) => view.summary)).toEqual(['系统：新增 2 个团', '系统：新增 3 个团、1 个班期'])
    expect(views.map((view) => view.createdAt)).toEqual(['2026-10-10T02:10:10.000Z', '2026-10-10T02:00:10.000Z'])
  })

  it('a single system row is not collapsed', () => {
    const lone = entry({ id: 'lone', action: 'insert', actor: 'seed', after: { name: 'Solo' } })
    const views = buildChangeViews([lone], ctx)
    expect(views).toHaveLength(1)
    expect(views[0].summary).toBe('新增团')
    expect(views[0].tourId).toBe('t1')
  })

  it('rows exactly 120 seconds apart join; 121 seconds apart do not', () => {
    const at = (id: string, iso: string) => entry({ id, action: 'insert', actor: 'seed', createdAt: iso })
    const joined = buildChangeViews(
      [at('x2', '2026-10-10T02:02:00.000Z'), at('x1', '2026-10-10T02:00:00.000Z')],
      ctx,
    )
    expect(joined).toHaveLength(1)
    const apart = buildChangeViews(
      [at('y2', '2026-10-10T02:02:01.000Z'), at('y1', '2026-10-10T02:00:00.000Z')],
      ctx,
    )
    expect(apart).toHaveLength(2)
  })

  it('a manual edit in the middle splits a run, and only non-zero kinds are listed', () => {
    const mixed: ChangeLogEntry[] = [
      entry({ id: 'u1', entity: 'departure', action: 'update', actor: 'seed', createdAt: '2026-10-10T02:00:09.000Z' }),
      entry({ id: 'd1', entity: 'tour', action: 'delete', actor: 'seed', createdAt: '2026-10-10T02:00:08.000Z' }),
      entry({ id: 'u2', entity: 'tour', action: 'update', actor: 'seed', createdAt: '2026-10-10T02:00:07.000Z' }),
      entry({ id: 'm', actor: 'edit by a@b.c', createdAt: '2026-10-10T02:00:06.000Z' }),
      entry({ id: 'i1', entity: 'tour', action: 'insert', actor: 'seed', createdAt: '2026-10-10T02:00:05.000Z' }),
      entry({ id: 'i2', entity: 'tour', action: 'insert', actor: 'seed', createdAt: '2026-10-10T02:00:04.000Z' }),
    ]
    const views = buildChangeViews(mixed, ctx)
    expect(views.map((view) => view.summary)).toEqual([
      '系统：更新 1 个团、1 个班期、删除 1 个团',
      '已保存（内容没有变化）',
      '系统：新增 2 个团',
    ])
    expect(views[1].source).toBe('manual')
  })

  it('a client editor sees the same collapsed line, labelled 系统', () => {
    const editorCtx = { tourNames: new Map<string, string>(), label: makeActorLabeler('client_editor', new Set()) }
    const views = buildChangeViews(systemRows('s', '2026-10-10T02:00:10.000Z', { tours: 2, departures: 0 }), editorCtx)
    expect(views).toHaveLength(1)
    expect(views[0].actorLabel).toBe(SYSTEM_LABEL)
  })
})

describe('trimDepartureForViewer', () => {
  const departure = {
    id: 'd1',
    tourId: 't1',
    clientId: 'c1',
    departOn: '2027-01-01',
    returnOn: null,
    priceTextOverride: null,
    status: 'open' as const,
    internal: { airline: 'SECRET-AIR', capacity: 20, outboundRoute: 'AKL-PVG' },
    updatedAt: 'v1',
  }

  it('hands a Magic Engine admin the row as it is', () => {
    expect(trimDepartureForViewer('me_admin', departure)).toBe(departure)
  })

  it('empties internal for a client editor without touching the original', () => {
    const trimmed = trimDepartureForViewer('client_editor', departure)
    expect(trimmed.internal).toEqual({})
    expect(JSON.stringify(trimmed)).not.toContain('SECRET-AIR')
    expect({ ...trimmed, internal: departure.internal }).toEqual(departure)
    expect(departure.internal.airline).toBe('SECRET-AIR')
  })
})

describe('makeActorLabeler — the viewer always sees their own email', () => {
  it('shows a client editor their own email even when the access list no longer has it', () => {
    const label = makeActorLabeler('client_editor', new Set(['colleague@client.test']), 'me@client.test')
    expect(label('me@client.test')).toBe('me@client.test')
    expect(label('colleague@client.test')).toBe('colleague@client.test')
    expect(label('staff@magicengine.test')).toBe(ME_TEAM_LABEL)
  })
})
