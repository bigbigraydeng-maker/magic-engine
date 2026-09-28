/**
 * The video-factory-only-publish-path guard (docs/PITFALLS.md D14).
 *
 * These tests reconstruct the *shape* of the 2026-09-28 East Inter incident
 * script — a file outside `src/lib/factory/` that calls a video-generation
 * provider and a video-publish endpoint — and assert the guard catches it,
 * then assert a real `src/lib/factory/` change with the same content is left
 * alone. This is the "当场试跑" evidence for a check that runs on every PR
 * rather than on a schedule: running this suite IS triggering the exact logic
 * `check-video-factory-bypass.mjs` runs in CI, against real diff shapes.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FACTORY_PREFIX,
  PUBLISH_SIGNATURES,
  SELF_PREFIX,
  VIDEO_PROVIDER_SIGNATURES,
  checkFile,
  checkVideoFactoryBypass,
} from '../src/video-factory-bypass.mjs'

/** Builds a GitHub PR-files-API-shaped entry with a unified-diff patch of pure additions. */
function file(filename: string, addedLines: string[]) {
  const patch = addedLines.map((l) => `+${l}`).join('\n')
  return { filename, patch }
}

describe('🔴 catches the East Inter incident shape', () => {
  it('flags a scratchpad script that calls Muapi then posts to Facebook /video_reels', () => {
    // Minimal reconstruction of scratchpad/make-eastinter-reels.mjs's shape:
    // generate via Muapi's pixverse i2v model, then publish straight to the
    // Graph API reel endpoint — no import of anything under src/lib/factory/.
    const bypassScript = file('scratchpad/make-eastinter-reels.mjs', [
      "const MUAPI_BASE = 'https://api.muapi.ai/api/v1'",
      "const res = await fetch(`${MUAPI_BASE}/pixverse-v5.5-i2v`, { method: 'POST', body })",
      "await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, { method: 'POST', body: startBody })",
    ])
    const result = checkVideoFactoryBypass({ files: [bypassScript] })
    expect(result.ok).toBe(false)
    expect(result.violations.join('\n')).toContain('scratchpad/make-eastinter-reels.mjs')
    expect(result.violations.join('\n')).toContain('Muapi')
    expect(result.violations.join('\n')).toContain('Facebook Reel')
  })

  it('flags the same shape wherever it is committed, not just under scratchpad/', () => {
    const bypass = file('src/app/api/clients/[id]/one-off-video/route.ts', [
      "const res = await fetch('https://api.atlascloud.ai/api/v1/model/generateVideo', opts)",
      "await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, opts2)",
    ])
    const result = checkVideoFactoryBypass({ files: [bypass] })
    expect(result.ok).toBe(false)
    expect(result.violations.join('\n')).toContain('one-off-video/route.ts')
    expect(result.violations.join('\n')).toContain('Atlas Cloud')
    expect(result.violations.join('\n')).toContain('Instagram')
  })

  it('flags a bare graph.facebook.com/.../videos path paired with a provider call', () => {
    const bypass = file('scripts/quick-reel.mjs', [
      "const gen = await fetch('https://api.muapi.ai/api/v1/pixverse', opts)",
      "await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, opts2)",
    ])
    const result = checkVideoFactoryBypass({ files: [bypass] })
    expect(result.ok).toBe(false)
    expect(result.violations.join('\n')).toContain('quick-reel.mjs')
  })

  it('matches case-insensitively', () => {
    const bypass = file('scratchpad/shout.mjs', [
      "const base = 'HTTPS://API.MUAPI.AI/api/v1'",
      "await fetch(`https://GRAPH.FACEBOOK.COM/v21.0/${p}/VIDEO_REELS`, opts)",
    ])
    expect(checkVideoFactoryBypass({ files: [bypass] }).ok).toBe(false)
  })
})

describe('🔴 does not flag legitimate, unrelated changes', () => {
  it('leaves a real src/lib/factory/ publish change alone even though it has both signals', () => {
    const factoryChange = file('src/lib/factory/publish/facebook-reel-adapter.ts', [
      "const GRAPH = 'https://graph.facebook.com/v25.0'",
      "const res = await fetch(`${GRAPH}/${pageId}/video_reels`, { method: 'POST', body })",
      "// also calls out to Muapi via api.muapi.ai upstream in the pipeline",
    ])
    const result = checkVideoFactoryBypass({ files: [factoryChange] })
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('leaves this guard’s own control plane alone even though it defines the needles', () => {
    const selfChange = file('tools/ops-review-loop/src/video-factory-bypass.mjs', [
      "  { needle: 'api.muapi.ai', why: 'Muapi' },",
      "  { needle: 'video_reels', why: 'Facebook Reel' },",
    ])
    expect(checkFile(selfChange).skipped).toBe(true)
    expect(checkVideoFactoryBypass({ files: [selfChange] }).ok).toBe(true)
  })

  it('leaves this guard’s own test file alone (SELF_PREFIX, not the test-name rule)', () => {
    const testChange = file('tools/ops-review-loop/tests/video-factory-bypass.test.ts', [
      "const bypass = file('scratchpad/x.mjs', ['api.muapi.ai', 'video_reels'])",
    ])
    expect(checkFile(testChange).skipped).toBe(true)
  })

  it('ignores a Muapi call with no publish call in the same file', () => {
    const genOnly = file('src/lib/visual/some-new-helper.ts', [
      "const res = await fetch('https://api.muapi.ai/api/v1/model', opts)",
    ])
    expect(checkVideoFactoryBypass({ files: [genOnly] }).ok).toBe(true)
  })

  it('ignores a video publish call with no provider call in the same file', () => {
    const publishOnly = file('src/lib/social/facebook-publisher.ts', [
      "await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, opts)",
    ])
    expect(checkVideoFactoryBypass({ files: [publishOnly] }).ok).toBe(true)
  })

  it('ignores an unrelated docs change that quotes both strings in prose', () => {
    const doc = file('docs/PITFALLS.md', [
      '直接调 Muapi api.muapi.ai 生成视频，再直接调 Facebook video_reels 接口发布',
    ])
    expect(checkVideoFactoryBypass({ files: [doc] }).ok).toBe(true)
  })

  it('ignores a bare graph.facebook.com call with no /videos path (e.g. ad or comment reply code)', () => {
    const unrelated = file('src/lib/meta/ad-publisher.ts', [
      "const res = await fetch(`${GRAPH_BASE}/${adAccountId}/campaigns`, opts)",
    ])
    expect(checkVideoFactoryBypass({ files: [unrelated] }).ok).toBe(true)
  })
})

describe('🔴 known gap ④ (子牙 review, PR #2177): a test-shaped filename does not fully evade', () => {
  // 子牙's probe: rename the East Inter script to *.test.mjs — TEST_FILE_RE
  // matches the name, but nothing ever actually runs it under vitest, so it
  // is exactly as executable a bypass script as the original. Full skip would
  // silently pass this evasion; downgrading to a notice keeps it visible.
  it('does not fail the gate, but surfaces a notice instead of skipping silently', () => {
    const disguised = file('scratchpad/make-eastinter-reels.test.mjs', [
      "const MUAPI_BASE = 'https://api.muapi.ai/api/v1'",
      "await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, opts)",
    ])
    const result = checkVideoFactoryBypass({ files: [disguised] })
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.notices).toHaveLength(1)
    expect(result.notices[0]).toContain('scratchpad/make-eastinter-reels.test.mjs')
    expect(result.notices[0]).toContain('降级为提醒')
  })

  it('still fully fails a real (non-disguised) path with the same content', () => {
    const real = file('scratchpad/make-eastinter-reels.mjs', [
      "const MUAPI_BASE = 'https://api.muapi.ai/api/v1'",
      "await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, opts)",
    ])
    const result = checkVideoFactoryBypass({ files: [real] })
    expect(result.ok).toBe(false)
    expect(result.notices).toEqual([])
  })

  it('a genuine test elsewhere that legitimately needs both needles does not fail the gate', () => {
    // e.g. a future test for src/lib/social/facebook-publisher.ts mocking a
    // video path — this must not become impossible to write.
    const genuineTest = file('src/lib/social/__tests__/facebook-publisher.test.ts', [
      "  fetchMock.mockResolvedValueOnce({ url: 'https://api.muapi.ai/x', body: '...' })",
      "  expect(calls).toContain('https://graph.facebook.com/v21.0/1/video_reels')",
    ])
    expect(checkVideoFactoryBypass({ files: [genuineTest] }).ok).toBe(true)
  })
})

describe('🔴 fail closed — "could not read" must not look like "nothing wrong"', () => {
  it('fails on a missing file list', () => {
    // @ts-expect-error deliberately malformed input
    expect(checkVideoFactoryBypass({ files: null }).ok).toBe(false)
  })

  it('fails on an entry with no filename', () => {
    // @ts-expect-error deliberately malformed input
    expect(checkVideoFactoryBypass({ files: [{ patch: '+whatever' }] }).ok).toBe(false)
  })

  it('fails on a diff too large for GitHub to send a patch for, outside factory/self', () => {
    const hugeDiff = { filename: 'src/app/api/factory/worker/huge-refactor.ts' }
    const result = checkVideoFactoryBypass({ files: [hugeDiff] })
    expect(result.ok).toBe(false)
    expect(result.violations.join('\n')).toContain('改动太大')
  })

  it('does not fail-closed on a huge diff inside src/lib/factory/ or the guard itself', () => {
    expect(checkVideoFactoryBypass({ files: [{ filename: `${FACTORY_PREFIX}huge.ts` }] }).ok).toBe(true)
    expect(checkVideoFactoryBypass({ files: [{ filename: `${SELF_PREFIX}huge.mjs` }] }).ok).toBe(true)
  })

  it('an empty file list is not a violation (nothing changed, nothing to judge)', () => {
    expect(checkVideoFactoryBypass({ files: [] }).ok).toBe(true)
  })
})

describe('needle lists stay in sync with the real provider hostnames', () => {
  it('covers the hostnames docs/STATE.md and the agent findings named for Muapi/Atlas Cloud', () => {
    const needles = VIDEO_PROVIDER_SIGNATURES.map((s) => s.needle)
    expect(needles).toContain('api.muapi.ai')
    expect(needles).toContain('api.atlascloud.ai')
  })

  it('covers the Facebook Reel and Instagram publish endpoints', () => {
    const needles = PUBLISH_SIGNATURES.map((s) => s.needle)
    expect(needles).toContain('video_reels')
    expect(needles).toContain('media_publish')
  })
})

describe('the guard workflow', () => {
  const workflowPath = join(process.cwd(), '.github/workflows/video-factory-bypass-guard.yml')
  const source = readFileSync(workflowPath, 'utf8')

  it('runs on every pull_request, with no path or branch filter', () => {
    expect(source).toMatch(/^on:\s*\n\s*pull_request:\s*$/m)
  })

  it('checks itself out from main, so a PR cannot edit the guard that judges it', () => {
    expect(source).toContain('ref: main')
  })

  it('is read-only — it judges, it never writes', () => {
    expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read/)
    expect(source).toMatch(/pull-requests:\s*read/)
  })

  it('runs the real entrypoint script', () => {
    expect(source).toContain('tools/ops-review-loop/src/check-video-factory-bypass.mjs')
  })

  it('tolerates its own absence on main exactly once, for the bootstrap PR', () => {
    expect(source).toContain('bootstrap')
  })

  it('🔴 the guard scripts must exist — deleting one must redden this REQUIRED check, not silently pass', () => {
    // Same bootstrap hole fix-scope's guard closes for itself
    // (workflow-guards.test.ts): the workflow tolerates a missing script
    // exactly once, for the PR that introduces it. That tolerance would
    // otherwise be permanent — delete the script from main and the guard
    // exits 0 forever. This lives in ops-review-loop-tests, which IS a
    // required check, so removing either script fails the merge gate instead
    // of quietly disarming the guard.
    for (const file of [
      'tools/ops-review-loop/src/check-video-factory-bypass.mjs',
      'tools/ops-review-loop/src/video-factory-bypass.mjs',
    ]) {
      expect(existsSync(join(process.cwd(), file)), `${file} 没了 —— 视频工厂闸门会静默放行`).toBe(true)
    }
    expect(source).toContain('tools/ops-review-loop/src/check-video-factory-bypass.mjs')
  })
})
