import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const root = join(process.cwd(), 'src/lib/reference-loop')

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(path)) files.push(path)
  }
  return files
}

function imports(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:\bfrom|\bimport|\brequire\s*\()\s*['"]([^'"]+)['"]/g),
    (match) => match[1],
  )
}

const production = walk(root).filter((path) => !path.includes('__tests__'))
const forbidden = [
  '@/lib/supabase',
  '@supabase/supabase-js',
  '@/lib/kernel',
  '@/lib/action-submission',
  '@/lib/execution',
  'execution_items',
  '/capabilities/',
  '@/lib/cms/',
  '@/lib/publer/',
  '@/lib/gbp/',
  '@/lib/gsc/',
  '@/lib/ga4/',
  '@/lib/geo-baseline',
  '@/lib/geo-measurement',
  '@/lib/flywheel',
  'openai',
  'anthropic',
]

describe('reference-loop architecture', () => {
  it('has production sources and no side-effect imports', () => {
    expect(production.length).toBeGreaterThan(0)
    for (const path of production) {
      const specifiers = imports(readFileSync(path, 'utf8'))
      for (const needle of forbidden) {
        expect(specifiers.some((specifier) => specifier.includes(needle))).toBe(false)
      }
    }
  })

  it('exports only the pure prepare function at runtime', async () => {
    expect(Object.keys(await import('../index')).sort()).toEqual([
      'isValidatedReferenceLoopPreparation',
      'prepareReferenceLoopChange',
    ])
  })

  it('contains no explicit any', () => {
    const offenders = production.filter((path) =>
      /:\s*any\b|<any>|as\s+any\b/.test(readFileSync(path, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
