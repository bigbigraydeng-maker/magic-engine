import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Boundary guard (design §6.8.1 item 10), written as an ALLOW-list.
 *
 * Unpublished edits must never leak outward, so outside the catalog's own folders:
 *  1. no file may mention a `tour_catalog_*` database object at all — in any quoting, template
 *     string or constant (plain substring match, so `.from(TABLE)` tricks do not get past it);
 *  2. the only things importable from `@/lib/tour-catalog/…` are the published reader
 *     `loadPublishedProducts` (from store-publish) and the type-only contract modules.
 *     Everything else (store, store-edit, seed, publish, …) can reach the draft.
 */

const ROOTS = ['src', 'scripts']

const CATALOG_PREFIXES = [
  'src/lib/tour-catalog/',
  'src/app/api/clients/[id]/tour-catalog/',
  'src/app/dashboard/clients/[id]/tour-catalog/',
]

/**
 * Official public website feed. It is outside the admin folders, but it is the
 * published-only HTTP exit for one client. `loadPublishedProducts` returns the
 * first-party shape and would change this JSON, so the route stays as it is and
 * is allow-listed here. The pin test below refuses any draft import.
 */
const PUBLISHED_WEBSITE_ROUTES = new Set([
  'src/app/api/public/tour-catalog/[clientId]/route.ts',
])

const DB_OBJECT_PREFIX = ['tour', 'catalog', ''].join('_')

/**
 * Modules anyone may import from freely: type / response-shape modules, plus `publish-request-feed`,
 * which reads only the open "please publish" requests (who / when / note) for the daily to-do list
 * and has no way to reach the draft. `booking-facts` is read-only, reads just the two catalog tables
 * with fixed column lists, and its facts are shown only to the client's own staff — the self-test
 * below pins that down. `sales-facts` is the sales-progress page's reader: it reads only the same two tables with
 * fixed column lists, never writes, and returns just the internal seat NUMBER (never the internal JSON) — its own
 * self-test below pins that down too.
 */
const OPEN_MODULES = new Set(['publish-contract', 'types', 'api-contract', 'catalog-contract', 'publish-request-feed', 'booking-facts', 'sales-facts'])
/** store-publish is importable only for these names. */
const PUBLISHED_READER_MODULE = 'store-publish'
const PUBLISHED_READER_NAMES = new Set(['loadPublishedProducts', 'PublishedProductsRead'])

const SOURCE_FILE = /\.(tsx?|mjs|js)$/

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(tsx?|mjs|js)$/.test(path) || path.includes('/__tests__/')
}

/** Paths that exist only on a developer's machine for local trials and must never be committed. */
const LOCAL_ONLY_PATHS = ['src/app/tc-local-preview', 'local-test/']

/** Tracked files only (repo-relative, forward slashes): untracked local trial pages take no part. */
function trackedFiles(...paths: string[]): string[] {
  const out = execFileSync('git', ['ls-files', '-z', ...paths], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter((path) => path !== '')
}

function allSourceFiles(): string[] {
  return trackedFiles(...ROOTS).filter((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return SOURCE_FILE.test(name) && !path.split('/').some((part) => part === 'node_modules' || part.startsWith('.'))
  })
}

function isInsideCatalog(path: string): boolean {
  return CATALOG_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** `tour-catalog/<module>` out of a module specifier, whether aliased (`@/lib/…`) or relative. */
function catalogModuleOf(specifier: string): string | null {
  const match = /(?:^|\/)tour-catalog(?:\/([^'"`]*))?$/.exec(specifier)
  if (match === null) return null
  const rest = match[1] ?? ''
  return rest.replace(/\.(tsx?|mjs|js)$/, '')
}

function namedImports(clause: string): string[] | null {
  const trimmed = clause.trim().replace(/^type\s+/, '')
  const match = /^\{([\s\S]*)\}$/.exec(trimmed)
  if (match === null) return null // default / namespace import: cannot be checked name by name
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter((name) => name !== '')
}

/** Violations for one file's text. Exported shape kept tiny so the self-tests can call it. */
function violationsIn(path: string, text: string): string[] {
  const violations: string[] = []
  if (text.includes(DB_OBJECT_PREFIX)) {
    violations.push(`${path}: mentions a ${DB_OBJECT_PREFIX}* database object`)
  }

  const seen = new Set<number>()
  const staticImport = /\b(?:import|export)\s+([^'"`;]*?)\s*from\s*['"`]([^'"`]+)['"`]/g
  for (let m = staticImport.exec(text); m !== null; m = staticImport.exec(text)) {
    const module = catalogModuleOf(m[2])
    if (module === null) continue
    seen.add(m.index + m[0].lastIndexOf(m[2]))
    if (OPEN_MODULES.has(module)) continue
    if (module === PUBLISHED_READER_MODULE) {
      const names = namedImports(m[1])
      if (names !== null && names.every((name) => PUBLISHED_READER_NAMES.has(name))) continue
      violations.push(`${path}: imports ${names === null ? 'everything' : names.join(', ')} from tour-catalog/${module}`)
      continue
    }
    violations.push(`${path}: imports from tour-catalog/${module === '' ? '(index)' : module}`)
  }

  // Anything else that names a catalog module in a string — import('…'), require('…'),
  // side-effect imports, vi.mock, path constants — is refused outright unless the module is open.
  const anySpecifier = /['"`]([^'"`\n]*\btour-catalog\/[A-Za-z0-9_.-]+)['"`]/g
  for (let m = anySpecifier.exec(text); m !== null; m = anySpecifier.exec(text)) {
    if (seen.has(m.index + 1)) continue
    // Only module paths (aliased or relative) count; URLs such as '/dashboard/…/tour-catalog/x' do not.
    if (!/(?:^|\/)lib\/tour-catalog\/|^\.{1,2}\/(?:.*\/)?tour-catalog\//.test(m[1])) continue
    const module = catalogModuleOf(m[1])
    if (module === null || OPEN_MODULES.has(module)) continue
    violations.push(`${path}: refers to tour-catalog/${module} outside a checked import`)
  }
  return violations
}

function findViolations(): string[] {
  const violations: string[] = []
  for (const path of allSourceFiles()) {
    if (isTestFile(path) || isInsideCatalog(path) || PUBLISHED_WEBSITE_ROUTES.has(path)) continue
    violations.push(...violationsIn(path, readFileSync(join(process.cwd(), path), 'utf8')))
  }
  return violations
}

describe('tour catalog draft boundary', () => {
  it('nothing outside the catalog folders touches the catalog tables or its draft-capable modules', () => {
    expect(findViolations()).toEqual([])
  })

  it('the open request feed only reads the request table and imports nothing from the catalog', () => {
    const feed = readFileSync(join(process.cwd(), 'src', 'lib', 'tour-catalog', 'publish-request-feed.ts'), 'utf8')
    const tables = feed.match(new RegExp(`${DB_OBJECT_PREFIX}[a-z_]+`, 'g')) ?? []
    expect(Array.from(new Set(tables))).toEqual([`${DB_OBJECT_PREFIX}publish_requests`])
    expect(/from\s+['"]\.\//.test(feed)).toBe(false)
    expect(/\.(insert|update|upsert|delete|rpc)\(/.test(feed)).toBe(false)
  })

  it('the booking facts reader only reads the two catalog tables, never writes, and imports no CRM code', () => {
    const facts = readFileSync(join(process.cwd(), 'src', 'lib', 'tour-catalog', 'booking-facts.ts'), 'utf8')
    const tables = facts.match(new RegExp(`${DB_OBJECT_PREFIX}[a-z_]+`, 'g')) ?? []
    expect(Array.from(new Set(tables)).sort()).toEqual([
      `${DB_OBJECT_PREFIX}departures`,
      `${DB_OBJECT_PREFIX}tours`,
    ])
    expect(/\.(insert|update|upsert|delete|rpc)\(/.test(facts)).toBe(false)
    expect(/from\s+['"][^'"]*\/crm\//.test(facts)).toBe(false)
    // The selected columns are the minimal ones, named once each: widening them fails here.
    expect(facts).toContain(`BOOKING_FACT_TOUR_COLUMNS = 'id, name, duration_text'`)
    expect(facts).toContain(`BOOKING_FACT_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, return_on, status'`)
    expect(facts).toContain(`BOOKING_OPTION_TOUR_COLUMNS = 'id, name, duration_text, is_active'`)
    expect(facts).toContain(`BOOKING_OPTION_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, return_on, status'`)
    // Nothing selects anything other than those four constants.
    const selects = Array.from(facts.matchAll(/\.select\(([^)]*)\)/g)).map((m) => m[1].trim())
    expect(Array.from(new Set(selects)).sort()).toEqual([
      'BOOKING_FACT_DEPARTURE_COLUMNS',
      'BOOKING_FACT_TOUR_COLUMNS',
      'BOOKING_OPTION_DEPARTURE_COLUMNS',
      'BOOKING_OPTION_TOUR_COLUMNS',
    ])
  })

  it('the sales facts reader only reads the two catalog tables, never writes, imports no CRM code and never returns the internal JSON', () => {
    const facts = readFileSync(join(process.cwd(), 'src', 'lib', 'tour-catalog', 'sales-facts.ts'), 'utf8')
    const tables = facts.match(new RegExp(`${DB_OBJECT_PREFIX}[a-z_]+`, 'g')) ?? []
    expect(Array.from(new Set(tables)).sort()).toEqual([
      `${DB_OBJECT_PREFIX}departures`,
      `${DB_OBJECT_PREFIX}tours`,
    ])
    expect(/\.(insert|update|upsert|delete|rpc)\(/.test(facts)).toBe(false)
    expect(/from\s+['"][^'"]*\/crm\//.test(facts)).toBe(false)
    // The selected columns are named once each: widening them fails here.
    expect(facts).toContain(`SALES_FACT_TOUR_COLUMNS = 'id, name, slug, max_group_size'`)
    expect(facts).toContain(`SALES_FACT_DEPARTURE_COLUMNS = 'id, tour_id, depart_on, status, internal'`)
    const selects = Array.from(facts.matchAll(/\.select\(([^)]*)\)/g)).map((m) => m[1].trim())
    expect(Array.from(new Set(selects)).sort()).toEqual(['SALES_FACT_DEPARTURE_COLUMNS', 'SALES_FACT_TOUR_COLUMNS'])
    // The `internal` JSON is reduced to its `capacity` key inside the module and never handed out.
    expect(facts).toContain('internalCapacity: internalCapacityOf(row.internal)')
    expect(/internal:\s*row\.internal/.test(facts)).toBe(false)
  })

  it('the scan really sees files and the catalog really contains what it forbids elsewhere', () => {
    const files = allSourceFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((path) => path.startsWith('scripts/'))).toBe(true)
    const store = readFileSync(join(process.cwd(), 'src', 'lib', 'tour-catalog', 'store.ts'), 'utf8')
    expect(store.includes(DB_OBJECT_PREFIX)).toBe(true)
    // Applied to the catalog's own route, the rules DO fire — so a pass above is not vacuous.
    const routePath = 'src/app/api/clients/[id]/tour-catalog/publish/route.ts'
    const route = readFileSync(join(process.cwd(), routePath), 'utf8')
    expect(violationsIn('x.ts', route).length).toBeGreaterThan(0)
  })

  it('the public website route is allow-listed and still cannot reach a draft', () => {
    const path = 'src/app/api/public/tour-catalog/[clientId]/route.ts'
    const text = readFileSync(join(process.cwd(), path), 'utf8')
    expect(PUBLISHED_WEBSITE_ROUTES.has(path)).toBe(true)
    expect(isInsideCatalog(path)).toBe(false)
    expect(violationsIn(path, text).length).toBeGreaterThan(0)
    const imports = Array.from(text.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((match) => match[1])
    expect(imports).toEqual([
      'next/server',
      '@/lib/auth/api-key-access',
      '@/lib/supabase',
      '@/lib/tour-catalog/dates',
      '@/lib/tour-catalog/store-publish',
      '@/lib/tour-catalog/website-output',
      '@/lib/meta/ai/contract',
    ])
    expect(text).toContain('{ loadPublished }')
    expect(text).not.toContain('loadDraftCatalog')
    expect(/\.(insert|update|upsert|delete|rpc)\(/.test(text)).toBe(false)
  })

  it('the local trial page and its data are not tracked, and get no exemption if they ever are', () => {
    const tracked = trackedFiles()
    expect(tracked.length).toBeGreaterThan(100)
    expect(tracked.filter((path) => LOCAL_ONLY_PATHS.some((local) => path.startsWith(local)))).toEqual([])
    // Not on the allow-list: a committed copy would be scanned like any other file and fail.
    const sample = `import { loadDraftCatalog } from '@/lib/tour-catalog/store'`
    expect(isInsideCatalog('src/app/tc-local-preview/page.tsx')).toBe(false)
    expect(violationsIn('src/app/tc-local-preview/page.tsx', sample).length).toBeGreaterThan(0)
  })

  it('refuses every way of naming a catalog table', () => {
    const table = `${DB_OBJECT_PREFIX}tours`
    const samples = [
      `db.from('${table}')`,
      `db.from("${table}")`,
      'db.from(`' + table + '`)',
      `const T = '${table}'; db.from(T)`,
      `db.rpc('${DB_OBJECT_PREFIX}publish', {})`,
      `sql\`select * from public.${DB_OBJECT_PREFIX}published\``,
    ]
    for (const sample of samples) {
      expect(violationsIn('src/lib/other/x.ts', sample), sample).toHaveLength(1)
    }
  })

  it('allows only the published reader and the type-only contract modules', () => {
    const allowed = [
      `import { loadPublishedProducts } from '@/lib/tour-catalog/store-publish'`,
      `import { loadPublishedProducts, type PublishedProductsRead } from '@/lib/tour-catalog/store-publish'`,
      `import type { PublishedProductsRead } from '@/lib/tour-catalog/store-publish'`,
      `import type { PublishChange } from '@/lib/tour-catalog/publish-contract'`,
      `import type { CatalogTour } from '@/lib/tour-catalog/types'`,
      `import type { CatalogResponse } from '../tour-catalog/api-contract'`,
      `import type { CatalogPermissions } from '@/lib/tour-catalog/catalog-contract'`,
      `import { listOpenPublishRequests } from '@/lib/tour-catalog/publish-request-feed'`,
      `const href = '/dashboard/clients/' + id + '/tour-catalog'`,
    ]
    for (const sample of allowed) {
      expect(violationsIn('src/lib/other/x.ts', sample), sample).toEqual([])
    }
  })

  it('refuses the draft-capable modules and anything else from store-publish', () => {
    const refused = [
      `import { loadDraftCatalog } from '@/lib/tour-catalog/store'`,
      `import { loadDraftCatalog } from '../tour-catalog/store'`,
      `import { requireCatalogAccess } from '@/lib/tour-catalog/access'`,
      `import { listMembers, saveSettings } from '@/lib/tour-catalog/store-access'`,
      `import { listRecentChanges } from '@/lib/tour-catalog/store-edit'`,
      `import { updateTour } from '@/lib/tour-catalog/store-edit'`,
      `import { seedCatalog } from '@/lib/tour-catalog/seed'`,
      `import { diffCatalog } from '@/lib/tour-catalog/publish'`,
      `import { loadPublished } from '@/lib/tour-catalog/store-publish'`,
      `import { loadPublishedProducts, publishDraft } from '@/lib/tour-catalog/store-publish'`,
      `import { loadPublishedProducts as x, buildPublishPreview } from '@/lib/tour-catalog/store-publish'`,
      `import * as sp from '@/lib/tour-catalog/store-publish'`,
      `export * from '@/lib/tour-catalog/store-publish'`,
      `const m = await import('@/lib/tour-catalog/store')`,
      `const m = require('@/lib/tour-catalog/store-publish')`,
      `import {\n  loadDraftCatalog,\n} from '@/lib/tour-catalog/store'`,
    ]
    for (const sample of refused) {
      expect(violationsIn('src/lib/other/x.ts', sample).length, sample).toBeGreaterThan(0)
    }
  })
})
