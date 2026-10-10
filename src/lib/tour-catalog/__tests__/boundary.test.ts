import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
  'src/app/tc-local-preview/',
]

const DB_OBJECT_PREFIX = ['tour', 'catalog', ''].join('_')

/** Modules anyone may import from freely (they hold types / response shapes only). */
const OPEN_MODULES = new Set(['publish-contract', 'types', 'api-contract'])
/** store-publish is importable only for these names. */
const PUBLISHED_READER_MODULE = 'store-publish'
const PUBLISHED_READER_NAMES = new Set(['loadPublishedProducts', 'PublishedProductsRead'])

const SOURCE_FILE = /\.(tsx?|mjs|js)$/

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(tsx?|mjs|js)$/.test(path) || path.includes('/__tests__/')
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out)
    } else if (SOURCE_FILE.test(name)) {
      out.push(full)
    }
  }
  return out
}

function toRepoPath(full: string): string {
  return relative(process.cwd(), full).split(sep).join('/')
}

function allSourceFiles(): string[] {
  const files: string[] = []
  for (const root of ROOTS) {
    const dir = join(process.cwd(), root)
    if (existsSync(dir)) listSourceFiles(dir, files)
  }
  return files
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
  for (const full of allSourceFiles()) {
    const path = toRepoPath(full)
    if (isTestFile(path) || isInsideCatalog(path)) continue
    violations.push(...violationsIn(path, readFileSync(full, 'utf8')))
  }
  return violations
}

describe('tour catalog draft boundary', () => {
  it('nothing outside the catalog folders touches the catalog tables or its draft-capable modules', () => {
    expect(findViolations()).toEqual([])
  })

  it('the scan really sees files and the catalog really contains what it forbids elsewhere', () => {
    const files = allSourceFiles().map(toRepoPath)
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((path) => path.startsWith('scripts/'))).toBe(true)
    const store = readFileSync(join(process.cwd(), 'src', 'lib', 'tour-catalog', 'store.ts'), 'utf8')
    expect(store.includes(DB_OBJECT_PREFIX)).toBe(true)
    // Applied to the catalog's own route, the rules DO fire — so a pass above is not vacuous.
    const routePath = 'src/app/api/clients/[id]/tour-catalog/publish/route.ts'
    const route = readFileSync(join(process.cwd(), routePath), 'utf8')
    expect(violationsIn('x.ts', route).length).toBeGreaterThan(0)
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
