// Tests for the fail-closed music vocal gate. All IO is injected.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_BGM_WINDOW_SEC,
  MusicVocalGateError,
  assertBgmFileVocalClear,
  assertLegacyBgmVocalGate,
  assertMusicVocalClear,
  loadMusicVocalRegistry,
  parseMusicVocalRegistry,
  sha256File,
  usedWindowFromProps,
} from './music-vocal-gate.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function entry(overrides = {}) {
  return {
    sha256: SHA_A,
    name: 'soft-piano.mp3',
    verdict: 'none',
    signedBy: 'human:Ray',
    signedAt: '2026-01-02T03:04:05Z',
    evidence: 'scan report #1',
    ...overrides,
  }
}

describe('parseMusicVocalRegistry', () => {
  it('valid registry parses', () => {
    const reg = parseMusicVocalRegistry([entry()])
    expect(reg).toHaveLength(1)
    expect(reg[0].sha256).toBe(SHA_A)
  })
  it('unknown key rejected', () => {
    expect(() => parseMusicVocalRegistry([entry({ extra: 1 })])).toThrow(/未知字段/)
  })
  it('duplicate sha rejected', () => {
    expect(() => parseMusicVocalRegistry([entry(), entry()])).toThrow(/重复/)
  })
  it('bad sha rejected', () => {
    expect(() => parseMusicVocalRegistry([entry({ sha256: 'XYZ' })])).toThrow(/sha256/)
  })
  it('cleanUntilSec on present rejected', () => {
    expect(() =>
      parseMusicVocalRegistry([entry({ verdict: 'present', cleanUntilSec: 10 })]),
    ).toThrow(/present/)
  })
  it('signedBy "claude" rejected for none/unknown', () => {
    expect(() => parseMusicVocalRegistry([entry({ signedBy: 'claude' })])).toThrow(/signedBy/)
    expect(() => parseMusicVocalRegistry([entry({ verdict: 'unknown', signedBy: 'claude' })])).toThrow(/signedBy/)
  })
  it('signedBy "claude" accepted for present', () => {
    expect(() => parseMusicVocalRegistry([entry({ verdict: 'present', signedBy: 'claude' })])).not.toThrow()
  })
  it('PM审片@abcdef12 and human:Ray accepted', () => {
    expect(() => parseMusicVocalRegistry([entry({ signedBy: 'PM审片@abcdef12' })])).not.toThrow()
    expect(() => parseMusicVocalRegistry([entry({ signedBy: 'human:Ray' })])).not.toThrow()
  })
  it('non-array rejected', () => {
    expect(() => parseMusicVocalRegistry({})).toThrow(/数组/)
  })
})

describe('loadMusicVocalRegistry', () => {
  it('missing file throws, never returns []', () => {
    expect(() =>
      loadMusicVocalRegistry('/nope.json', { readFileFn: () => { throw new Error('ENOENT') } }),
    ).toThrow(MusicVocalGateError)
  })
  it('bad JSON throws', () => {
    expect(() => loadMusicVocalRegistry('/x.json', { readFileFn: () => '{not json' })).toThrow(/JSON/)
  })
  it('invalid content throws', () => {
    expect(() =>
      loadMusicVocalRegistry('/x.json', { readFileFn: () => JSON.stringify([entry({ sha256: 'bad' })]) }),
    ).toThrow(/sha256/)
  })
  it('valid content returns entries', () => {
    const reg = loadMusicVocalRegistry('/x.json', { readFileFn: () => JSON.stringify([entry()]) })
    expect(reg).toHaveLength(1)
  })
})

describe('assertMusicVocalClear', () => {
  const base = { startSec: 0, durationSec: 10, marginSec: 1 }
  it('unregistered -> UNREGISTERED', () => {
    try {
      assertMusicVocalClear({ registry: [], sha256: SHA_A, ...base })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_UNREGISTERED')
    }
  })
  it('present -> PRESENT', () => {
    const reg = [entry({ verdict: 'present' })]
    try {
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_PRESENT')
    }
  })
  it('none whole-file passes any window', () => {
    const reg = [entry()]
    expect(() => assertMusicVocalClear({ registry: reg, sha256: SHA_A, startSec: 999, durationSec: 5 })).not.toThrow()
  })
  it('none with cleanUntilSec: exactly equal passes', () => {
    const reg = [entry({ cleanUntilSec: 11 })]
    expect(() => assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })).not.toThrow()
  })
  it('none with cleanUntilSec: 0.01s over throws', () => {
    const reg = [entry({ cleanUntilSec: 10.99 })]
    try {
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_UNKNOWN')
    }
  })
  it('none with cleanUntilSec: start 20 dur 10 margin 1 cleanUntilSec 31 passes', () => {
    const reg = [entry({ cleanUntilSec: 31 })]
    expect(() =>
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, startSec: 20, durationSec: 10, marginSec: 1 }),
    ).not.toThrow()
  })
  it('none with cleanUntilSec: start 20 dur 10 margin 1 cleanUntilSec 30.9 throws', () => {
    const reg = [entry({ cleanUntilSec: 30.9 })]
    try {
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, startSec: 20, durationSec: 10, marginSec: 1 })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_UNKNOWN')
    }
  })
  it('unknown without cleanUntilSec throws', () => {
    const reg = [entry({ verdict: 'unknown' })]
    try {
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_UNKNOWN')
    }
  })
  it('unknown with enough cleanUntilSec passes and strength reflects approval-only', () => {
    const reg = [entry({ verdict: 'unknown', cleanUntilSec: 20, strength: 'approval-only' })]
    const receipt = assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })
    expect(receipt.strength).toBe('approval-only')
    expect(receipt.verdict).toBe('unknown')
    expect(receipt.window).toEqual([0, 10])
    expect(receipt.cleanUntilSec).toBe(20)
  })
  it('derivedFrom never changes a verdict', () => {
    const reg = [entry({ verdict: 'present', derivedFrom: SHA_B })]
    try {
      assertMusicVocalClear({ registry: reg, sha256: SHA_A, ...base })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('MUSIC_VOCAL_PRESENT')
    }
  })
  it('bad window args -> TypeError', () => {
    expect(() => assertMusicVocalClear({ registry: [], sha256: SHA_A, startSec: -1, durationSec: 5 })).toThrow(TypeError)
    expect(() => assertMusicVocalClear({ registry: [], sha256: SHA_A, startSec: 0, durationSec: 0 })).toThrow(TypeError)
  })
})

describe('usedWindowFromProps', () => {
  it('math', () => {
    expect(usedWindowFromProps({ totalFrames: 300, fps: 30 })).toEqual({ startSec: 0, durationSec: 10 })
    expect(usedWindowFromProps({ musicStartSec: 2, totalFrames: 150, fps: 30 })).toEqual({ startSec: 2, durationSec: 5 })
  })
  it('bad args -> TypeError', () => {
    expect(() => usedWindowFromProps({ totalFrames: 0, fps: 30 })).toThrow(TypeError)
    expect(() => usedWindowFromProps({ totalFrames: 300, fps: 0 })).toThrow(TypeError)
    expect(() => usedWindowFromProps({ totalFrames: 300, fps: NaN })).toThrow(TypeError)
  })
})

describe('sha256File', () => {
  it('matches node:crypto on a tiny temp file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvg-'))
    const file = join(dir, 'tiny.bin')
    const bytes = Buffer.from('hello vocal gate')
    try {
      writeFileSync(file, bytes)
      const expected = createHash('sha256').update(bytes).digest('hex')
      await expect(sha256File(file)).resolves.toBe(expected)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('assertBgmFileVocalClear (legacy / recipe paths)', () => {
  const sha = createHash('sha256').update('bgm-bytes').digest('hex')
  const reg = (entry) => JSON.stringify([{ name: 'bgm', signedAt: '2026-10-16T00:00:00.000Z', evidence: 'doc:x', sha256: sha, ...entry }])
  const read = (registryText) => (p, enc) => (String(p).endsWith('.json') ? registryText : Buffer.from('bgm-bytes'))
  it('passes a signed whole-file vocal-free track', () => {
    const r = assertBgmFileVocalClear('/m.mp3', '/r.json', { readFileFn: read(reg({ verdict: 'none', signedBy: 'human:Ray' })) })
    expect(r.verdict).toBe('none')
  })
  it('refuses a track only verified for 30 s (needs the first 60 s)', () => {
    expect(() => assertBgmFileVocalClear('/m.mp3', '/r.json', { readFileFn: read(reg({ verdict: 'none', cleanUntilSec: 30, signedBy: 'human:Ray' })) })).toThrow(/人声窗口未覆盖/)
    expect(LEGACY_BGM_WINDOW_SEC).toBe(60)
  })
  it('refuses unregistered and vocal tracks and a broken registry', () => {
    expect(() => assertBgmFileVocalClear('/m.mp3', '/r.json', { readFileFn: read('[]') })).toThrow(/未登记/)
    expect(() => assertBgmFileVocalClear('/m.mp3', '/r.json', { readFileFn: read(reg({ verdict: 'present', signedBy: 'auto-scan' })) })).toThrow(/含人声/)
    expect(() => assertBgmFileVocalClear('/m.mp3', '/r.json', { readFileFn: read('not json') })).toThrow(/解析失败/)
  })
})

describe('assertLegacyBgmVocalGate (legacy assemble rule)', () => {
  const sha = createHash('sha256').update('bgm-bytes').digest('hex')
  const regText = (verdict, extra = {}) => JSON.stringify([{ sha256: sha, name: 'bgm', verdict, signedBy: verdict === 'present' ? 'auto-scan' : 'human:Ray', signedAt: '2026-10-16T00:00:00.000Z', evidence: 'doc:x', ...extra }])
  const read = (text) => (p) => (String(p).endsWith('.json') ? text : Buffer.from('bgm-bytes'))
  it('unregistered file BGM is refused', () => {
    expect(() => assertLegacyBgmVocalGate({ bgm: '/m.mp3', musicMood: null, registryPath: '/r.json', readFileFn: read('[]') })).toThrow(/未登记/)
  })
  it('vocal file BGM is refused', () => {
    expect(() => assertLegacyBgmVocalGate({ bgm: '/m.mp3', musicMood: null, registryPath: '/r.json', readFileFn: read(regText('present')) })).toThrow(/含人声/)
  })
  it('registered vocal-free file BGM passes', () => {
    expect(assertLegacyBgmVocalGate({ bgm: '/m.mp3', musicMood: null, registryPath: '/r.json', readFileFn: read(regText('none')) }).verdict).toBe('none')
  })
  it('mood-only request (renderer picks the track) is refused', () => {
    expect(() => assertLegacyBgmVocalGate({ bgm: null, musicMood: 'calm', registryPath: '/r.json', readFileFn: read(regText('none')) })).toThrow(/music_mood/)
  })
  it('no music and no mood passes (make_promo renders without a music bed)', () => {
    expect(assertLegacyBgmVocalGate({ bgm: null, musicMood: null, registryPath: '/r.json' })).toBeNull()
  })
})
