// Tests for the import script's argument and path guards (real temp directories, no DB).
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside, parseArgs, pathsAreSafe } from '../cli-guards'

const CID = 'c0000000-0000-0000-0000-000000000000'

describe('parseArgs', () => {
  it('accepts client id, input and optional --out', () => {
    expect(parseArgs([CID, 'in.json'])).toEqual({ clientId: CID, inputPath: 'in.json', outPath: null })
    expect(parseArgs([CID, 'in.json', '--out', 'p.json'])?.outPath).toBe('p.json')
  })
  it('rejects unknown flags, --out=x, --out followed by a flag, bad client id', () => {
    expect(parseArgs([CID, 'in.json', '--apply'])).toBeNull()
    expect(parseArgs([CID, 'in.json', '--apply=1'])).toBeNull()
    expect(parseArgs([CID, 'in.json', '--out=x.json'])).toBeNull()
    expect(parseArgs([CID, 'in.json', '--out', '--apply'])).toBeNull()
    expect(parseArgs(['not-a-uuid', 'in.json'])).toBeNull()
    expect(parseArgs([CID])).toBeNull()
  })
})

describe('isInside', () => {
  it('only a real .. segment means outside', () => {
    expect(isInside('/r', '/r/..data/x.json')).toBe(true)
    expect(isInside('/r', '/r/a/x.json')).toBe(true)
    expect(isInside('/r', '/other/x.json')).toBe(false)
    expect(isInside('/r', '/r')).toBe(true)
  })
})

describe('pathsAreSafe', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'guards-')))
  const repo = join(base, 'repo')
  const outside = join(base, 'outside')
  mkdirSync(repo)
  mkdirSync(outside)
  mkdirSync(join(repo, '..data'))
  const input = join(outside, 'guests.json')
  writeFileSync(input, '[]')
  writeFileSync(join(repo, 'secret.json'), '[]')
  writeFileSync(join(repo, '..data', 'g.json'), '[]')
  symlinkSync(join(repo, 'secret.json'), join(outside, 'link.json'))
  const roots = [repo]
  const args = (inputPath: string, outPath: string | null = null) => ({ clientId: CID, inputPath, outPath })

  it('accepts input outside and a new .json out outside', () => {
    expect(pathsAreSafe(args(input, join(outside, 'plan.json')), roots)).toBe(true)
    expect(pathsAreSafe(args(input), roots)).toBe(true)
  })
  it('rejects input inside the repo, including a ..data directory and a symlink into it', () => {
    expect(pathsAreSafe(args(join(repo, 'secret.json')), roots)).toBe(false)
    expect(pathsAreSafe(args(join(repo, '..data', 'g.json')), roots)).toBe(false)
    expect(pathsAreSafe(args(join(outside, 'link.json')), roots)).toBe(false)
  })
  it('rejects out inside any root (worktree or main checkout), existing, non-json, or equal to input', () => {
    expect(pathsAreSafe(args(input, join(repo, 'plan.json')), roots)).toBe(false)
    expect(pathsAreSafe(args(input, join(repo, '..data', 'plan.json')), roots)).toBe(false)
    expect(pathsAreSafe(args(input, join(outside, 'plan.json')), [outside, repo])).toBe(false)
    expect(pathsAreSafe(args(input, input), roots)).toBe(false)
    expect(pathsAreSafe(args(input, join(outside, 'plan.txt')), roots)).toBe(false)
    expect(pathsAreSafe(args(join(outside, 'missing.json')), roots)).toBe(false)
  })
})
