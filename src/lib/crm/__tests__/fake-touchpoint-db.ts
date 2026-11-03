/**
 * 只够 `touchpoint-metadata` / `call-stance` 用的假 contact_touchpoints 表（替换 `supabaseAdmin`）。
 *
 * 支持：select(...).eq(...).maybeSingle()、select('id').eq(...)（列表）、
 * update(...).eq(...).select('id')；`eq('metadata', json)` 按 jsonb 内容比较（不看键顺序，
 * 跟 Postgres jsonb 的 = 一样），`eq('metadata->>k', v)` 按单个键比较。
 * `interfere` 次数内，每次 update 落库前模拟「别人先改了一次 metadata」。
 */

export interface FakeRow { id: string; client_id: string; metadata: Record<string, unknown> }

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

function columnOf(row: FakeRow, k: string): unknown {
  if (k === 'id') return row.id
  if (k === 'client_id') return row.client_id
  return undefined
}

export function makeFakeTouchpointDb(rows: FakeRow[], opts: { interfere?: number; failList?: boolean } = {}) {
  let interfere = opts.interfere ?? 0
  const updates: Array<{ id: string; metadata: Record<string, unknown> }> = []
  const guards: string[] = []

  const matches = (row: FakeRow, filters: Array<[string, unknown]>) =>
    filters.every(([k, v]) => {
      if (k === 'metadata') return canonical(row.metadata) === canonical(JSON.parse(String(v)))
      if (k.startsWith('metadata->>')) return String(row.metadata[k.slice('metadata->>'.length)] ?? '') === v
      return columnOf(row, k) === v
    })

  function runUpdate(filters: Array<[string, unknown]>, patch: Record<string, unknown>) {
    if (interfere > 0) {
      interfere--
      for (const r of rows) r.metadata = { ...r.metadata, other_writer: (Number(r.metadata.other_writer) || 0) + 1 }
    }
    const hit = rows.filter((r) => matches(r, filters))
    for (const r of hit) {
      r.metadata = structuredClone(patch)
      updates.push({ id: r.id, metadata: r.metadata })
    }
    return { data: hit.map((r) => ({ id: r.id })), error: null }
  }

  function builder() {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const q = {
      select: () => q,
      update: (p: { metadata: Record<string, unknown> }) => {
        patch = p.metadata
        return q
      },
      eq: (k: string, v: unknown) => {
        if (k === 'metadata') guards.push(String(v))
        filters.push([k, v])
        return q
      },
      maybeSingle: async () => {
        const row = rows.find((r) => matches(r, filters))
        return { data: row ? { id: row.id, metadata: structuredClone(row.metadata) } : null, error: null }
      },
      then: (resolve: (v: { data: unknown; error: { message: string } | null }) => void) => {
        if (patch) return resolve(runUpdate(filters, patch))
        if (opts.failList) return resolve({ data: null, error: { message: 'list boom' } })
        return resolve({ data: rows.filter((r) => matches(r, filters)).map((r) => ({ id: r.id })), error: null })
      },
    }
    return q
  }

  return { from: () => builder(), rows, updates, guards }
}
