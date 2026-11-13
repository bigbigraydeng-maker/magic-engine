// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

const BASE = '/work/lib'

describe('parseManifest', () => {
  it('reads the example manifest that ships with the script', () => {
    const raw: unknown = JSON.parse(readFileSync(path.resolve(__dirname, 'manifest.example.json'), 'utf8'))
    const result = parseManifest(raw, BASE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map(e => e.path)).toEqual(['/work/lib/Annual-Brochure-2027.pdf', '/absolute/path/to/Product-Sheet.pdf'])
    expect(result.entries[0]).toMatchObject({ category: 'brochure', visibility: 'client', versionLabel: 'v1', title: 'Annual brochure 2027' })
    expect(result.entries[1]).toMatchObject({ category: 'sheet', visibility: 'internal', versionLabel: null, title: null })
  })

  it('makes the operator decide who can download: visibility has no default', () => {
    const result = parseManifest({ files: [{ path: 'a.pdf', category: 'sheet' }] }, BASE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('visibility')
  })

  it('reports every problem with the entry number', () => {
    const result = parseManifest({ files: [{ path: 'a.pdf', category: 'secret', visibility: 'public' }, 'text', { category: 'sheet', visibility: 'client' }] }, BASE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.startsWith('files[0]') && e.includes('category'))).toBe(true)
    expect(result.errors.some(e => e.startsWith('files[0]') && e.includes('visibility'))).toBe(true)
    expect(result.errors.some(e => e.startsWith('files[1]'))).toBe(true)
    expect(result.errors.some(e => e.startsWith('files[2]') && e.includes('path'))).toBe(true)
  })

  it('refuses a malformed manifest, an empty list, too many files and the same file twice', () => {
    expect(parseManifest(null, BASE).ok).toBe(false)
    expect(parseManifest({ files: 'a.pdf' }, BASE).ok).toBe(false)
    expect(parseManifest({ files: [] }, BASE).ok).toBe(false)
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.pdf`, category: 'sheet', visibility: 'internal' }))
    expect(parseManifest({ files: many }, BASE).ok).toBe(false)
    const twice = parseManifest({ files: [{ path: 'a.pdf', category: 'sheet', visibility: 'internal' }, { path: './a.pdf', category: 'brand', visibility: 'client' }] }, BASE)
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.errors.join(' ')).toContain('duplicate')
  })
})
