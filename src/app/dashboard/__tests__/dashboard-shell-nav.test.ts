import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS } from '../dashboard-shell'

// Guard for the admin sidebar: every link must point at a real page, every key is unique,
// and regrouping must never make a page lose its entrance.
const APP_ROOT = join(__dirname, '..', '..')

/** The admin sidebar links before the 5-group regrouping, minus /dashboard/analytics (dead page, link dropped on purpose). */
const PREVIOUS_HREFS = [
  '/dashboard', '/dashboard/today', '/dashboard/clients', '/dashboard/factory', '/dashboard/reports',
  '/dashboard/admin/billing-monitor', '/dashboard/admin/mtc-overview', '/dashboard/admin/ai-gateway',
  '/dashboard/admin/viral-references', '/dashboard/admin/users', '/dashboard/admin/prospecting',
  '/dashboard/industry-baselines', '/dashboard/admin/cron-health', '/dashboard/commerce', '/dashboard/ad-engine',
  '/dashboard/kernel-approvals', '/dashboard/team-memory', '/dashboard/me2/product-map', '/dashboard/voice',
  '/dashboard/workflows-health', '/dashboard/conversions', '/dashboard/admin/flywheel', '/dashboard/admin/mcp-keys',
]

const items = ADMIN_SECTIONS.flatMap((s) => s.items)

describe('admin sidebar', () => {
  it('has the 5 groups, the last two folded by default', () => {
    expect(ADMIN_SECTIONS).toHaveLength(5)
    expect(ADMIN_SECTIONS.map((s) => s.collapsed === true)).toEqual([false, false, false, true, true])
  })

  it('every link points at a page that exists', () => {
    for (const item of items) {
      expect(item.href, item.key).toBeDefined()
      const page = join(APP_ROOT, ...(item.href ?? '').split('/').filter(Boolean), 'page.tsx')
      expect(existsSync(page), `${item.key} -> ${item.href}`).toBe(true)
    }
  })

  it('keys and links are unique', () => {
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length)
  })

  it('no page lost its entrance in the regrouping', () => {
    const hrefs = new Set(items.map((i) => i.href))
    for (const href of PREVIOUS_HREFS) expect(hrefs.has(href), href).toBe(true)
  })

  it('the dead analytics page is no longer linked', () => {
    expect(items.some((i) => i.href === '/dashboard/analytics')).toBe(false)
  })
})
