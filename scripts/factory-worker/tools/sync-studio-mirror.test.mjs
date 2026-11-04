import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, statSync, utimesSync, rmSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planScope, applyScope, rebuildManifest, scopesFor, listFiles, defaultClientFolders, parseArgs, run, cleanStaleTemps, MANIFEST_NAME } from './sync-studio-mirror.mjs'

let tmp
let src
let mir

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mirror-sync-'))
  src = join(tmp, 'src')
  mir = join(tmp, 'mir')
  mkdirSync(src, { recursive: true })
  mkdirSync(mir, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function put(path, content, mtimeSec) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec)
}

function makeCtsSymlink() {
  const real = join(src, '03_Enterprise', 'CTS')
  mkdirSync(real, { recursive: true })
  symlinkSync(real, join(src, 'CTS'), 'dir')
  return real
}

describe('sync-studio-mirror', () => {
  it('copies a missing file and preserves mtime', async () => {
    const real = makeCtsSymlink()
    const srcFile = join(real, 'remotion-assets', 'clips', 'a.mp4')
    put(srcFile, 'hello', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.copy).toEqual([{ rel: 'clips/a.mp4', reason: 'missing', size: 5 }])
    applyScope(plan, mir)
    const mirrorFile = join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4')
    expect(readFileSync(mirrorFile, 'utf8')).toBe('hello')
    expect(Math.trunc(statSync(mirrorFile).mtimeMs)).toBe(Math.trunc(statSync(srcFile).mtimeMs))
  })

  it('is idempotent after apply', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    const plan1 = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    applyScope(plan1, mir)
    const plan2 = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan2.copy.length).toBe(0)
    expect(plan2.conflicts.length).toBe(0)
  })

  it('copies a changed file when source is newer', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'new-longer', 1_700_000_500)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'old', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.copy).toEqual([{ rel: 'clips/a.mp4', reason: 'changed', size: 10 }])
    applyScope(plan, mir)
    expect(readFileSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'utf8')).toBe('new-longer')
  })

  it('does not overwrite when mirror is newer', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'aaa', 1_700_000_000)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'bbbbbb', 1_700_000_500)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.copy).toEqual([])
    expect(plan.conflicts).toEqual([{ rel: 'clips/a.mp4', reason: 'mirror_newer' }])
    applyScope(plan, mir)
    expect(readFileSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'utf8')).toBe('bbbbbb')
  })

  it('never deletes files only in the mirror', async () => {
    const real = makeCtsSymlink()
    mkdirSync(join(real, 'remotion-assets'), { recursive: true })
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'old.mp4'), 'old', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.onlyInMirror).toEqual(['clips/old.mp4'])
    applyScope(plan, mir)
    expect(existsSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'old.mp4'))).toBe(true)
  })

  it('listFiles skips hidden, temp and symlinked files', () => {
    const root = join(tmp, 'list')
    mkdirSync(root, { recursive: true })
    put(join(root, 'keep.txt'), 'k', 1_700_000_000)
    put(join(root, '.DS_Store'), 'x', 1_700_000_000)
    put(join(root, 'a.sync-tmp-123'), 'x', 1_700_000_000)
    const target = join(tmp, 'target.txt')
    put(target, 't', 1_700_000_000)
    symlinkSync(target, join(root, 'link.txt'))
    const files = listFiles(root)
    expect([...files.keys()]).toEqual(['keep.txt'])
  })

  it('reports missing source scope', async () => {
    const real = makeCtsSymlink()
    mkdirSync(join(real, 'remotion-assets'), { recursive: true })
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/brandkit' })
    expect(plan.missingSource).toBe(true)
    expect(plan.copy).toEqual([])
  })

  it('rebuildManifest preserves header and other entries', async () => {
    put(join(mir, 'Music', 'x.mp3'), 'abc', 1_700_000_000)
    const manifestPath = join(mir, MANIFEST_NAME)
    writeFileSync(manifestPath, JSON.stringify({
      purpose: 'keep-me',
      files: [{ path: 'Other/keep.txt', bytes: 1, sha256: 'deadbeef' }],
    }))
    const files = await rebuildManifest({
      mirrorRoot: mir,
      scopes: ['Music'],
      copiedPaths: ['Music/x.mp3'],
      now: new Date('2026-11-03T00:00:00Z'),
    })
    const written = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(written.purpose).toBe('keep-me')
    expect(written.refreshed_at).toBe('2026-11-03T00:00:00.000Z')
    const x = written.files.find((f) => f.path === 'Music/x.mp3')
    expect(x).toEqual({
      path: 'Music/x.mp3',
      bytes: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      mtime_ms: 1_700_000_000_000,
    })
    expect(written.files.find((f) => f.path === 'Other/keep.txt')).toEqual({
      path: 'Other/keep.txt',
      bytes: 1,
      sha256: 'deadbeef',
    })
    expect(files.length).toBe(2)
  })

  it('scopesFor builds the expected scope list', () => {
    expect(scopesFor(['CTS'])).toEqual(['CTS/remotion-assets', 'CTS/brandkit', 'Music', '_shared/music'])
  })

  it('defaultClientFolders lists top-level dirs excluding shared and hidden', () => {
    for (const d of ['CTS', 'East_Inter', 'Music', '_shared', '.hidden']) {
      mkdirSync(join(mir, d), { recursive: true })
    }
    writeFileSync(join(mir, 'x.json'), '{}')
    expect(defaultClientFolders(mir)).toEqual(['CTS', 'East_Inter'])
  })

  it('parseArgs handles flags and rejects unknown ones', () => {
    expect(parseArgs(['--apply', '--clients', 'CTS, East_Inter'])).toEqual({
      apply: true,
      source: null,
      mirror: null,
      clients: ['CTS', 'East_Inter'],
    })
    expect(() => parseArgs(['--nope'])).toThrow()
  })

  it('run check/apply/check flow', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    mkdirSync(join(mir, 'CTS'), { recursive: true })
    const base = ['--source', src, '--mirror', mir, '--clients', 'CTS']
    const check1 = await run({ argv: base, env: {}, log: () => {} })
    expect(check1).toBe(1)
    expect(existsSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'))).toBe(false)
    const applied = await run({ argv: [...base, '--apply'], env: {}, log: () => {} })
    expect(applied).toBe(0)
    expect(readFileSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'utf8')).toBe('hello')
    expect(existsSync(join(mir, MANIFEST_NAME))).toBe(true)
    const check2 = await run({ argv: base, env: {}, log: () => {} })
    expect(check2).toBe(0)
  })

  it('run refuses a client folder name that could escape the mirror', async () => {
    makeCtsSymlink()
    const code = await run({
      argv: ['--source', src, '--mirror', mir, '--clients', '../escape'],
      env: {},
      log: () => {},
    })
    expect(code).toBe(2)
    expect(existsSync(join(tmp, 'escape'))).toBe(false)
  })

  it('run refuses when mirror is inside source', async () => {
    const inner = join(src, 'inner')
    mkdirSync(inner, { recursive: true })
    const code = await run({
      argv: ['--source', src, '--mirror', inner],
      env: {},
      log: () => {},
    })
    expect(code).toBe(2)
  })

  it('same size, newer source, identical bytes → touch only', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_700_000_500)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.copy).toEqual([])
    expect(plan.touch).toEqual([{ rel: 'clips/a.mp4' }])
    const result = applyScope(plan, mir)
    expect(result.copied).toEqual([])
    expect(result.touched).toEqual(['CTS/remotion-assets/clips/a.mp4'])
    const srcFile = join(real, 'remotion-assets', 'clips', 'a.mp4')
    const mirrorFile = join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4')
    expect(Math.trunc(statSync(mirrorFile).mtimeMs)).toBe(Math.trunc(statSync(srcFile).mtimeMs))
    const plan2 = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan2.touch).toEqual([])
    expect(plan2.copy).toEqual([])
  })

  it('same size, newer source, different bytes → copy', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'abcd', 1_700_000_500)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'wxyz', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.copy).toEqual([{ rel: 'clips/a.mp4', reason: 'changed', size: 4 }])
    expect(plan.touch).toEqual([])
    applyScope(plan, mir)
    expect(readFileSync(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'utf8')).toBe('abcd')
  })

  it('check run exits 0 when only mtimes differ', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_700_000_500)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_700_000_000)
    mkdirSync(join(mir, 'CTS'), { recursive: true })
    const code = await run({ argv: ['--source', src, '--mirror', mir, '--clients', 'CTS'], env: {}, log: () => {} })
    expect(code).toBe(0)
  })

  it('unreadable source dir fails the run', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    const locked = join(real, 'remotion-assets', 'clips')
    chmodSync(locked, 0o000)
    try {
      const code = await run({
        argv: ['--source', src, '--mirror', mir, '--clients', 'CTS', '--apply'],
        env: {},
        log: () => {},
      })
      expect(code).toBe(1)
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  it('missing source scope with mirror files fails', async () => {
    makeCtsSymlink()
    put(join(mir, 'CTS', 'brandkit', 'logo.png'), 'x', 1_700_000_000)
    const code = await run({
      argv: ['--source', src, '--mirror', mir, '--clients', 'CTS'],
      env: {},
      log: () => {},
    })
    expect(code).toBe(1)
  })

  it('music is add-only', async () => {    put(join(src, 'Music', 'x.mp3'), 'new-version', 1_700_000_500)
    put(join(mir, 'Music', 'x.mp3'), 'old', 1_700_000_000)
    put(join(src, 'Music', 'y.mp3'), 'fresh', 1_700_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'Music' })
    expect(plan.copy).toEqual([{ rel: 'y.mp3', reason: 'missing', size: 5 }])
    expect(plan.conflicts).toEqual([{ rel: 'x.mp3', reason: 'add_only_scope' }])
    applyScope(plan, mir)
    expect(readFileSync(join(mir, 'Music', 'x.mp3'), 'utf8')).toBe('old')
    expect(readFileSync(join(mir, 'Music', 'y.mp3'), 'utf8')).toBe('fresh')
  })

  it('older-mtime replacement copied when mirror untouched', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'v2!', 1_700_000_000)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'v1', 1_700_000_500)
    const dstHash = createHash('sha256').update('v1').digest('hex')
    const manifestByPath = new Map([
      ['CTS/remotion-assets/clips/a.mp4', { bytes: 2, sha256: dstHash, mtime_ms: 1_700_000_500_000 }],
    ])
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets', manifestByPath })
    expect(plan.copy).toEqual([{ rel: 'clips/a.mp4', reason: 'changed', size: 3 }])
    const planNoManifest = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(planNoManifest.copy).toEqual([])
    expect(planNoManifest.conflicts).toEqual([{ rel: 'clips/a.mp4', reason: 'mirror_newer' }])
  })

  it('refuses to write through a symlinked mirror dir', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    const outside = join(tmp, 'outside')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(mir, 'CTS', 'remotion-assets'), { recursive: true })
    symlinkSync(outside, join(mir, 'CTS', 'remotion-assets', 'clips'), 'dir')
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    const result = applyScope(plan, mir)
    expect(result.failed.length).toBe(1)
    expect(existsSync(join(outside, 'a.mp4'))).toBe(false)
  })

  it('sub-millisecond source mtimes do not cause a touch on every run', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_700_000_000.5518)
    put(join(mir, 'CTS', 'remotion-assets', 'clips', 'a.mp4'), 'same', 1_600_000_000)
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(plan.touch).toEqual([{ rel: 'clips/a.mp4' }])
    applyScope(plan, mir)
    const again = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    expect(again.touch).toEqual([])
    expect(again.copy).toEqual([])
  })

  it('creates no folder outside the mirror for a nested path under a symlinked dir', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'sub', 'a.mp4'), 'hello', 1_700_000_000)
    const outside = join(tmp, 'outside')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(mir, 'CTS', 'remotion-assets'), { recursive: true })
    symlinkSync(outside, join(mir, 'CTS', 'remotion-assets', 'clips'), 'dir')
    const plan = await planScope({ sourceRoot: src, mirrorRoot: mir, scope: 'CTS/remotion-assets' })
    const result = applyScope(plan, mir)
    expect(result.failed.length).toBe(1)
    expect(existsSync(join(outside, 'sub'))).toBe(false)
  })

  it('apply returns 1 when a copy fails', async () => {
    const real = makeCtsSymlink()
    put(join(real, 'remotion-assets', 'clips', 'a.mp4'), 'hello', 1_700_000_000)
    const outside = join(tmp, 'outside')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(mir, 'CTS', 'remotion-assets'), { recursive: true })
    symlinkSync(outside, join(mir, 'CTS', 'remotion-assets', 'clips'), 'dir')
    const code = await run({
      argv: ['--source', src, '--mirror', mir, '--clients', 'CTS', '--apply'],
      env: {},
      log: () => {},
    })
    expect(code).toBe(1)
  })

  it('cleanStaleTemps removes only old temp files', () => {
    const dir = join(tmp, 'temps')
    mkdirSync(dir, { recursive: true })
    put(join(dir, 'a.mp4.sync-tmp-1'), 'x', 1_700_000_000)
    put(join(dir, 'b.mp4.sync-tmp-2'), 'y')
    const removed = cleanStaleTemps(dir, 3600_000, Date.now())
    expect(removed).toEqual(['a.mp4.sync-tmp-1'])
    expect(existsSync(join(dir, 'b.mp4.sync-tmp-2'))).toBe(true)
  })

  it('manifest reuse requires same mtime', async () => {
    put(join(mir, 'Music', 'x.mp3'), 'abc', 1_700_000_000)
    const manifestPath = join(mir, MANIFEST_NAME)
    writeFileSync(manifestPath, JSON.stringify({
      files: [{ path: 'Music/x.mp3', bytes: 3, sha256: 'stale', mtime_ms: 1 }],
    }))
    const files = await rebuildManifest({
      mirrorRoot: mir,
      scopes: ['Music'],
      copiedPaths: [],
      now: new Date('2026-11-03T00:00:00Z'),
    })
    const x = files.find((f) => f.path === 'Music/x.mp3')
    expect(x.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
