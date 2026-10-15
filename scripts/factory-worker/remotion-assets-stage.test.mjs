import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RemotionOrderError, stageRemotionAssets, wakeCloudFile, isCloudOnly, classifyStageError,
} from './remotion-branch.mjs'

const dirs = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-test-'))
  dirs.push(root)
  const lib = join(root, 'assets')
  mkdirSync(join(lib, 'clips'), { recursive: true })
  const brand = join(root, 'brand')
  mkdirSync(join(brand, 'assets'), { recursive: true })
  writeFileSync(join(brand, 'assets', 'watermark.png'), 'png')
  return { root, lib, brand, stage: join(root, 'stage') }
}
function run(env, files) {
  return stageRemotionAssets({
    props: { logoFile: 'logo.png', musicFile: null },
    files: ['logo.png', ...files],
    stageDir: env.stage,
    brandkitDir: env.brand,
    assetLibDir: env.lib,
    clientRootDir: realpathSync(env.root),
  })
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { chmodSync(join(d, 'assets', 'clips', 'locked.mp4'), 0o644) } catch { /* not created in this test */ }
    rmSync(d, { recursive: true, force: true })
  }
})

describe('stageRemotionAssets error reasons', () => {
  it('stages files that are present', () => {
    const env = setup()
    writeFileSync(join(env.lib, 'clips', 'a.mp4'), 'clip-a')
    expect(() => run(env, ['clips/a.mp4'])).not.toThrow()
  })

  it('reports a really missing file as missing, not unreadable', () => {
    const env = setup()
    let msg = ''
    try { run(env, ['clips/gone.mp4']) } catch (e) { msg = e.message }
    expect(msg).toContain('缺少素材文件')
    expect(msg).toContain('clips/gone.mp4')
    expect(msg).not.toContain('读不出来')
  })

  it.skipIf(process.getuid?.() === 0)('reports an existing but unreadable file as unreadable, not missing', () => {
    const env = setup()
    const f = join(env.lib, 'clips', 'locked.mp4')
    writeFileSync(f, 'clip-locked')
    chmodSync(f, 0o000)
    let err
    try { run(env, ['clips/locked.mp4']) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('读不出来')
    expect(err.message).toContain('clips/locked.mp4')
    expect(err.message).not.toContain('缺少素材文件')
  })

  it.skipIf(process.getuid?.() === 0)('reports both reasons separately when both happen', () => {
    const env = setup()
    const f = join(env.lib, 'clips', 'locked.mp4')
    writeFileSync(f, 'clip-locked')
    chmodSync(f, 0o000)
    let msg = ''
    try { run(env, ['clips/gone.mp4', 'clips/locked.mp4']) } catch (e) { msg = e.message }
    expect(msg).toContain('缺少素材文件：clips/gone.mp4')
    expect(msg).toContain('读不出来')
  })
})

describe('wake helpers', () => {
  it('classifies errors', () => {
    expect(classifyStageError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('missing')
    expect(classifyStageError(new Error('bad'))).toBe('missing')
    expect(classifyStageError(Object.assign(new Error('x'), { code: 'EIO' }))).toBe('unreadable')
    expect(classifyStageError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe('unreadable')
    expect(classifyStageError(new RemotionOrderError('y'))).toBe('fatal')
  })

  it('wakeCloudFile reads a normal file to the end', () => {
    const env = setup()
    const f = join(env.lib, 'clips', 'a.mp4')
    writeFileSync(f, Buffer.alloc(3_000_000, 1))
    expect(wakeCloudFile(f)).toEqual({ ok: true })
  })

  it('wakeCloudFile never throws on a missing file', () => {
    const r = wakeCloudFile(join(tmpdir(), 'definitely-not-here.mp4'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ENOENT')
  })

  it('wakeCloudFile gives up after the deadline', () => {
    const env = setup()
    const f = join(env.lib, 'clips', 'big.mp4')
    writeFileSync(f, Buffer.alloc(3_000_000, 1))
    let t = 0
    const r = wakeCloudFile(f, { deadlineMs: 1000, now: () => (t += 600) })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('超过')
  })

  it('isCloudOnly is false for a normal file and for a missing one', () => {
    const env = setup()
    const f = join(env.lib, 'clips', 'a.mp4')
    writeFileSync(f, 'abc')
    expect(isCloudOnly(f)).toBe(false)
    expect(isCloudOnly(join(env.lib, 'nope.mp4'))).toBe(false)
  })
})
