/**
 * Regression test for the P0 hotfix that prevented the kanban from crashing
 * with `TypeError: Cannot read properties of undefined (reading 'color')` when
 * DAPE W5 wrote `status='superseded'` to execution_items but the frontend
 * `STATUS_META` map only knew about 4 statuses.
 *
 * We test the `statusMetaOf` helper extracted from `_client.tsx`:
 *  1. All known statuses (incl. `superseded`) resolve to a real entry.
 *  2. Unknown future statuses (e.g. `'archived'`) fall back to a safe shape
 *     instead of throwing — `.color` and `.label` are always defined.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const executionPageSource = readFileSync(
  join(process.cwd(), 'src', 'app', 'dashboard', 'clients', '[id]', 'execution', '_client.tsx'),
  'utf8',
).replace(/\r\n/g, '\n')

// Extract STATUS_META + statusMetaOf as a self-contained snippet so we can
// transpile and exec it without dragging in React imports.
const statusMetaStart = executionPageSource.indexOf('const STATUS_META')
const statusMetaEnd   = executionPageSource.indexOf('const STATUS_FLOW')

if (statusMetaStart === -1 || statusMetaEnd === -1) {
  throw new Error('Failed to locate STATUS_META block in _client.tsx')
}

const snippet = executionPageSource.slice(statusMetaStart, statusMetaEnd).trim()

const compiled = ts.transpileModule(
  `${snippet}\nreturn { STATUS_META, statusMetaOf }`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText

const { STATUS_META, statusMetaOf } = new Function(compiled)() as {
  STATUS_META: Record<string, { label: string; color: string }>
  statusMetaOf: (status: string) => { label: string; color: string }
}

describe('STATUS_META map', () => {
  it('includes superseded (the DAPE W5 system-only terminal status)', () => {
    expect(STATUS_META.superseded).toBeDefined()
    expect(STATUS_META.superseded.label).toBe('已取代')
    expect(STATUS_META.superseded.color).toContain('bg-')
  })

  it('still includes all four FDE-facing statuses', () => {
    for (const status of ['pending', 'in_progress', 'completed', 'skipped'] as const) {
      expect(STATUS_META[status]).toBeDefined()
      expect(STATUS_META[status].label).toBeTruthy()
      expect(STATUS_META[status].color).toContain('bg-')
    }
  })
})

describe('statusMetaOf defensive lookup', () => {
  it('returns the real entry for a known status', () => {
    expect(statusMetaOf('pending').label).toBe('待处理')
    expect(statusMetaOf('superseded').label).toBe('已取代')
  })

  it('returns a safe fallback (never undefined) for an unknown status', () => {
    // Simulate backend adding a new lifecycle state before frontend types catch up.
    const result = statusMetaOf('archived_by_audit_tool')

    // Must NOT be undefined — that's the bug we're guarding against.
    expect(result).toBeDefined()
    // .color must exist or React `${m.color}` interpolation crashes the page.
    expect(result.color).toBeTruthy()
    expect(typeof result.color).toBe('string')
    // .label falls back to the raw status so FDE at least sees what backend sent.
    expect(result.label).toBe('archived_by_audit_tool')
  })

  it('does not throw for empty / weird inputs', () => {
    expect(() => statusMetaOf('')).not.toThrow()
    expect(() => statusMetaOf('__proto__')).not.toThrow()
    expect(statusMetaOf('').color).toBeTruthy()
  })
})
