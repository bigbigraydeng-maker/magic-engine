/**
 * Y3 (魏征) — physical isolation lock between client & admin query paths.
 *
 * The #1 risk 子牙 named is "复用诱惑": someone refactoring later writes
 * `createScopedQueries(adminClientId)` inside admin code, welding the admin
 * path onto the client-only innermost-isolation layer. Comments + grep are
 * soft. These static tests FAIL THE BUILD if either side imports the other.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = join(process.cwd(), 'src', 'lib', 'mcp')

function read(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
}

describe('admin / client query path isolation (Y3)', () => {
  it('admin-scoped-queries.ts must NOT import scoped-queries', () => {
    const src = read('admin-scoped-queries.ts')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/mcp\/scoped-queries['"]/)
    expect(src).not.toMatch(/from\s+['"]\.\/scoped-queries['"]/)
  })

  it('admin-tools.ts must NOT import scoped-queries (only admin-scoped-queries)', () => {
    const src = read('admin-tools.ts')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/mcp\/scoped-queries['"]/)
    expect(src).not.toMatch(/from\s+['"]\.\/scoped-queries['"]/)
  })

  it('scoped-queries.ts must NOT import admin paths (reverse lock)', () => {
    const src = read('scoped-queries.ts')
    expect(src).not.toMatch(/admin-scoped-queries/)
    expect(src).not.toMatch(/admin-tools/)
  })

  it('tools.ts (client) must NOT import admin paths', () => {
    const src = read('tools.ts')
    expect(src).not.toMatch(/admin-scoped-queries/)
    expect(src).not.toMatch(/admin-tools/)
  })
})
