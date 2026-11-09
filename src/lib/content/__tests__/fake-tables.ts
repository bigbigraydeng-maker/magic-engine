export type FakeRow = Record<string, unknown>

export interface FakeQuery {
  eq: (column: string, value: unknown) => FakeQuery
  maybeSingle: () => Promise<{ data: FakeRow | null; error: { message: string } | null }>
}

export interface FakeTables {
  from: (table: string) => { select: (cols?: string) => FakeQuery }
  calls: string[]
}

export function createFakeTables(
  tables: Record<string, FakeRow[]>,
  opts?: { errorOnTable?: string },
): FakeTables {
  const calls: string[] = []
  const errorOnTable = opts?.errorOnTable

  return {
    calls,
    from(table: string) {
      calls.push(table)
      return {
        select(_cols?: string): FakeQuery {
          const predicates: Array<{ column: string; value: unknown }> = []

          const query: FakeQuery = {
            eq(column: string, value: unknown): FakeQuery {
              predicates.push({ column, value })
              return query
            },
            async maybeSingle() {
              if (errorOnTable !== undefined && errorOnTable === table) {
                return { data: null, error: { message: 'boom' } }
              }

              const rows = tables[table] ?? []
              const match = rows.find((row) =>
                predicates.every((p) => row[p.column] === p.value),
              )

              return { data: match ?? null, error: null }
            },
          }

          return query
        },
      }
    },
  }
}
