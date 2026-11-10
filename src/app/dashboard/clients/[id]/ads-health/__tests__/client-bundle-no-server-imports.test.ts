import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'

// The ads-health page is a client component tree. If any value import reaches a server-only
// module (the service-role Supabase client throws when its key is missing in the browser),
// the whole page renders blank. Type-only imports are erased at build time and are ignored.

const ROOT = resolve(__dirname, '../../../../../../..')
const PAGE_DIR = resolve(__dirname, '..')
const SERVER_ONLY = /(^|\/)supabase(-admin|-server)?$|^next\/headers$|^server-only$/
const VALUE_IMPORT = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'|^import\s+'([^']+)'/gm

function resolveSpec(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? join(ROOT, 'src', spec.slice(2))
    : spec.startsWith('.')
      ? join(dirname(from), spec)
      : null
  if (!base) return null
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext
  }
  return null
}

function findServerImports(): string[] {
  const seen = new Set<string>()
  const hits: string[] = []
  const walk = (file: string, trail: string[]): void => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    for (const m of src.matchAll(VALUE_IMPORT)) {
      const spec = m[1] ?? m[2]
      if (SERVER_ONLY.test(spec)) {
        hits.push([...trail, file, spec].map(p => p.replace(ROOT + '/', '')).join(' > '))
        continue
      }
      const next = resolveSpec(spec, file)
      if (next) walk(next, [...trail, file])
    }
  }
  for (const name of readdirSync(PAGE_DIR)) {
    if (/\.tsx?$/.test(name)) walk(join(PAGE_DIR, name), [])
  }
  return hits
}

describe('ads-health client bundle', () => {
  it('does not pull server-only modules into the browser', () => {
    expect(findServerImports()).toEqual([])
  })
})
