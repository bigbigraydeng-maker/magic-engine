import { describe, expect, it } from 'vitest'
import { groupVersions, type VersionRow } from '../version-groups'

function row(
  id: string,
  created_at: string,
  extra?: Partial<Pick<VersionRow, 'brief' | 'overlay'>>,
): VersionRow {
  return {
    id,
    created_at,
    brief: extra?.brief ?? {},
    overlay: extra?.overlay ?? null,
  }
}

describe('groupVersions', () => {
  it('groups rows linked by variant_of', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-02T00:00:00Z', {
        brief: { variant_of: { base_work_order_id: 'a1' } },
      }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1', 'a2'])
    expect(result.groups[0].latestId).toBe('a2')
  })

  it('groups rows linked by reopened_from', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-02T00:00:00Z', { brief: { reopened_from: 'a1' } }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1', 'a2'])
    expect(result.groups[0].latestId).toBe('a2')
  })

  it('groups rows with matching normalised overlay text', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z', { overlay: '  Hello   World ' }),
      row('a2', '2026-11-02T00:00:00Z', { overlay: 'hello world' }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1', 'a2'])
  })

  it('does not group rows with null overlays', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-02T00:00:00Z'),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(2)
  })

  it('does not group rows with empty or whitespace-only overlays', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z', { overlay: '' }),
      row('a2', '2026-11-02T00:00:00Z', { overlay: '   ' }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(2)
  })

  it('groups a transitive chain of three rows', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-02T00:00:00Z', {
        brief: { variant_of: { base_work_order_id: 'a1' } },
      }),
      row('a3', '2026-11-03T00:00:00Z', { brief: { reopened_from: 'a2' } }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1', 'a2', 'a3'])
    expect(result.groups[0].latestId).toBe('a3')
  })

  it('breaks created_at ties by lexicographically greatest id', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-01T00:00:00Z', { brief: { reopened_from: 'a1' } }),
    ]
    const result = groupVersions(rows)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].latestId).toBe('a2')
  })

  it('reports unparseable created_at as bad_created_at and excludes it', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z'),
      row('bad', 'not-a-date'),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([
      { ids: ['bad'], reason: 'bad_created_at' },
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1'])
  })

  it('reports conflicting_links when overlay and id links disagree', () => {
    const rows: VersionRow[] = [
      row('x1', '2026-11-01T00:00:00Z', { overlay: 'same text' }),
      row('x2', '2026-11-02T00:00:00Z', {
        overlay: 'same text',
        brief: { reopened_from: 'x3' },
      }),
      row('x3', '2026-11-03T00:00:00Z', { overlay: 'different text' }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toContainEqual({
      ids: ['x1', 'x2', 'x3'],
      reason: 'conflicting_links',
    })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['x1', 'x2', 'x3'])
  })

  it('returns empty output for empty input', () => {
    expect(groupVersions([])).toEqual({ groups: [], ambiguous: [] })
  })

  it('ignores references to unknown ids', () => {
    const rows: VersionRow[] = [
      row('a1', '2026-11-01T00:00:00Z', {
        brief: { reopened_from: 'missing' },
      }),
    ]
    const result = groupVersions(rows)
    expect(result.ambiguous).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].memberIds).toEqual(['a1'])
    expect(result.groups[0].latestId).toBe('a1')
  })
})
