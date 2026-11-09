import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CatalogCapability } from '@/lib/tour-catalog/catalog-contract'

/**
 * Every tour-catalog route handler must declare, as a string literal, the one capability it needs
 * (design §6.10.1 item 2). This test walks the folder, so a new route.ts or a new exported HTTP
 * method that is not written into EXPECTED below turns it red — nobody can add an endpoint and
 * forget to decide who may call it.
 */

const ROUTES_DIR = join(process.cwd(), 'src', 'app', 'api', 'clients', '[id]', 'tour-catalog')

/** "<path relative to the tour-catalog folder> <METHOD>" → capability. */
const EXPECTED: Record<string, CatalogCapability> = {
  'route.ts GET': 'view',
  'tours/[tourId]/route.ts PATCH': 'edit',
  'tours/[tourId]/departures/route.ts POST': 'edit',
  'departures/[departureId]/route.ts PATCH': 'edit',
  'changes/route.ts GET': 'view',
  'assistant/route.ts POST': 'assistant',
  'aliases/route.ts POST': 'aliases',
  'aliases/route.ts DELETE': 'aliases',
  'preview/route.ts POST': 'import',
  'batches/[batchId]/apply/route.ts POST': 'import',
  'batches/[batchId]/rollback/route.ts POST': 'import',
  'seed/route.ts POST': 'seed',
  'tours/route.ts POST': 'import',
  'publish/route.ts GET': 'view',
  'publish/route.ts POST': 'publish',
  'publish/history/route.ts GET': 'view',
  'publish/revert/route.ts GET': 'publish',
  'publish/revert/route.ts POST': 'publish',
  'members/route.ts GET': 'manage_members',
  'members/route.ts POST': 'manage_members',
  'members/route.ts DELETE': 'manage_members',
  'settings/route.ts PUT': 'manage_settings',
  'site-diff/route.ts GET': 'manage_settings',
  'export/route.ts GET': 'view',
  'publish-requests/route.ts POST': 'request_publish',
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
/** `export async function GET(`, `export function GET(`, `export const GET =`, `export { x as GET }`. */
const EXPORT_RE = new RegExp(
  `export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODS.join('|')})\\b|export\\s+const\\s+(${HTTP_METHODS.join('|')})\\b|\\bas\\s+(${HTTP_METHODS.join('|')})\\b`,
  'g',
)

function listRouteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') listRouteFiles(full, out)
    } else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

interface Handler {
  key: string
  /** Source from this handler's export up to the next exported handler (or the end of the file). */
  body: string
}

function handlersIn(full: string): Handler[] {
  const path = relative(ROUTES_DIR, full).split(sep).join('/')
  const source = readFileSync(full, 'utf8')
  const marks: Array<{ method: string; index: number }> = []
  for (let m = EXPORT_RE.exec(source); m !== null; m = EXPORT_RE.exec(source)) {
    marks.push({ method: m[1] ?? m[2] ?? m[3], index: m.index })
  }
  return marks.map((mark, i) => ({
    key: `${path} ${mark.method}`,
    body: source.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : source.length),
  }))
}

function allHandlers(): Handler[] {
  return listRouteFiles(ROUTES_DIR).flatMap(handlersIn)
}

const ACCESS_CALL_RE = /requireCatalogAccess\(\s*clientId\s*,\s*'([a-z_]+)'\s*\)/g

describe('tour-catalog routes declare their capability', () => {
  it('finds exactly the handlers that are registered — a new route or method must be added to EXPECTED', () => {
    const found = allHandlers().map((h) => h.key).sort()
    expect(found).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('%s requires %s', (key, capability) => {
    const handler = allHandlers().find((h) => h.key === key)
    expect(handler, `${key} not found`).toBeDefined()
    if (handler === undefined) return
    const calls = Array.from(handler.body.matchAll(ACCESS_CALL_RE)).map((m) => m[1])
    // Exactly one gate per handler, with the expected literal.
    expect(calls).toEqual([capability])
  })

  it.each(Object.keys(EXPECTED))('%s checks access before it reads the body or touches the database', (key) => {
    const handler = allHandlers().find((h) => h.key === key)
    if (handler === undefined) throw new Error(`${key} not found`)
    const gate = handler.body.search(ACCESS_CALL_RE)
    ACCESS_CALL_RE.lastIndex = 0
    const denied = handler.body.indexOf('if (!access.ok)')
    expect(gate).toBeGreaterThan(-1)
    expect(denied).toBeGreaterThan(gate)
    for (const early of ['supabaseAdmin', 'readJsonBody(', '.text()', '.json()', 'searchParams']) {
      const at = handler.body.indexOf(early)
      if (at !== -1) expect(at, `${key}: "${early}" appears before the access check`).toBeGreaterThan(denied)
    }
  })

  it('no route file passes a capability that is not a string literal', () => {
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      const all = source.match(/requireCatalogAccess\(/g) ?? []
      const literal = source.match(ACCESS_CALL_RE) ?? []
      expect(literal.length, full).toBe(all.length)
    }
  })

  it('the old admin-only gate is gone from every file under the routes folder and the library', () => {
    const oldName = ['requireCatalog', 'Admin'].join('')
    const roots = [ROUTES_DIR, join(process.cwd(), 'src', 'lib', 'tour-catalog')]
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(tsx?|mjs|js)$/.test(name) && readFileSync(full, 'utf8').includes(oldName)) offenders.push(full)
      }
    }
    roots.forEach(walk)
    expect(offenders).toEqual([])
  })

  it('every capability in the contract is used by at least one route', () => {
    const used = new Set(Object.values(EXPECTED))
    const all: CatalogCapability[] = [
      'view', 'edit', 'assistant', 'request_publish', 'import', 'aliases', 'seed', 'publish', 'manage_members', 'manage_settings',
    ]
    expect(all.filter((c) => !used.has(c))).toEqual([])
    // `edit_site` is deliberately not a route gate: it is a second tier INSIDE the `edit` route
    // (PATCH tours/[tourId] passes permissions.edit_site to the validator). Pin that wiring here.
    const patchTour = allHandlers().find((h) => h.key === 'tours/[tourId]/route.ts PATCH')
    expect(patchTour?.body).toContain('access.permissions.edit_site')
  })
})
