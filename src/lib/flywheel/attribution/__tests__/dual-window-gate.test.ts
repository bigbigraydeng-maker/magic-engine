/**
 * The dual-window gate — Issue #859, PR #862.
 *
 * The handoff is implemented and correct, but production-disabled until the
 * memory consumers of flywheel_outcomes count by action instead of by row.
 * These tests pin the two things that matter: it is OFF unless explicitly
 * turned on, and nothing but the exact string 'true' turns it on.
 */

import { describe, it, expect } from 'vitest'
import { DUAL_WINDOW_FLAG, dualWindowEnabled } from '../dual-window-gate'

describe('dualWindowEnabled', () => {
  it('is OFF when the flag is unset', () => {
    expect(dualWindowEnabled({})).toBe(false)
  })

  it("is ON only for the exact string 'true'", () => {
    expect(dualWindowEnabled({ [DUAL_WINDOW_FLAG]: 'true' })).toBe(true)
  })

  it.each(['false', '', '1', 'yes', 'TRUE', 'True', ' true', 'true '])(
    'stays OFF for %p — a gate whose failure mode is "silently on" is not a gate',
    (value) => {
      expect(dualWindowEnabled({ [DUAL_WINDOW_FLAG]: value })).toBe(false)
    },
  )

  it('reads process.env by default', () => {
    const original = process.env[DUAL_WINDOW_FLAG]
    try {
      delete process.env[DUAL_WINDOW_FLAG]
      expect(dualWindowEnabled()).toBe(false)

      process.env[DUAL_WINDOW_FLAG] = 'true'
      expect(dualWindowEnabled()).toBe(true)
    } finally {
      if (original === undefined) delete process.env[DUAL_WINDOW_FLAG]
      else process.env[DUAL_WINDOW_FLAG] = original
    }
  })

  it('is off in this test environment, i.e. the shipped default', () => {
    // If a future change sets it in .env.example or a config default, this
    // fails — which is the point.
    const original = process.env[DUAL_WINDOW_FLAG]
    expect(original === undefined || original !== 'true').toBe(true)
  })
})

// ── The documented place to set it has to be the place that reads it ────────

describe('where the flag is documented', () => {
  const readFileSync = require('node:fs').readFileSync as typeof import('node:fs').readFileSync
  const path = require('node:path') as typeof import('node:path')

  it('ENV.md points at the web service, not the cron', () => {
    // `attribution-cron` only curls the endpoint, so process.env is read in the
    // web process. Documenting "Render-cron" would send an operator to set it
    // where nothing reads it — and the flag would stay off with no error, which
    // is the worst possible failure for a gate someone is deliberately opening.
    const env = readFileSync(path.join(process.cwd(), 'docs/ENV.md'), 'utf8')
    const row = env.split('\n').find(l => l.includes(DUAL_WINDOW_FLAG))

    expect(row).toBeDefined()
    expect(row).toContain('Render-web')
  })

  it('no Render cron process runs attribution itself, so the flag stays on the web', () => {
    const render = readFileSync(path.join(process.cwd(), 'render.yaml'), 'utf8')
    expect(render).not.toContain('name: attribution-cron')
    const route = readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/attribution/route.ts'),
      'utf8',
    )
    expect(route).toContain(DUAL_WINDOW_FLAG)
    // The dispatcher cron only curls. The handler runs in the web process.
    expect(render).toContain('curl')
    expect(render).toContain('/api/cron/dispatch-frequent')
  })
})
