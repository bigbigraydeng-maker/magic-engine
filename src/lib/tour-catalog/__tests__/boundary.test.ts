import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Boundary guard (design §6.8.1 item 10): the DRAFT may only be read by the catalog library and
 * its own admin API routes. Everything else (website feed, ads, content, chat) must go through
 * loadPublishedProducts, so unpublished edits can never leak outward.
 */

const SRC_ROOT = join(process.cwd(), 'src')

const ALLOWED_PREFIXES = [
  ['src', 'lib', 'tour-catalog'].join('/') + '/',
  ['src', 'app', 'api', 'clients', '[id]', 'tour-catalog'].join('/') + '/',
]

const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'loadDraftCatalog', pattern: /\bloadDraftCatalog\b/ },
  { label: ".from('tour_catalog_tours')", pattern: /\.from\(\s*['"`]tour_catalog_tours['"`]\s*\)/ },
  { label: ".from('tour_catalog_departures')", pattern: /\.from\(\s*['"`]tour_catalog_departures['"`]\s*\)/ },
]

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.includes('/__tests__/')
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out)
    } else if (/\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function toRepoPath(full: string): string {
  return relative(process.cwd(), full).split(sep).join('/')
}

function findViolations(): string[] {
  const violations: string[] = []
  for (const full of listSourceFiles(SRC_ROOT)) {
    const path = toRepoPath(full)
    if (isTestFile(path)) continue
    if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
    const text = readFileSync(full, 'utf8')
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) violations.push(`${path}: ${rule.label}`)
    }
  }
  return violations
}

describe('tour catalog draft boundary', () => {
  it('only the catalog library and its admin API routes read the draft', () => {
    expect(findViolations()).toEqual([])
  })

  it('the scan really sees the allowed readers (guards against a scan that matches nothing)', () => {
    const store = readFileSync(join(SRC_ROOT, 'lib', 'tour-catalog', 'store.ts'), 'utf8')
    expect(FORBIDDEN.every((rule) => rule.pattern.test(store))).toBe(true)
    expect(listSourceFiles(SRC_ROOT).length).toBeGreaterThan(100)
  })
})
