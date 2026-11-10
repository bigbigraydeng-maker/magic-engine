import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { viewerFacts } from '@/lib/auth/home-entries'
import { buildClientFdeSections } from '../client-fde-nav'

const APP_ROOT = join(__dirname, '..', '..', '..')
const CLIENT = 'c0000000-0000-0000-0000-000000000099'

describe('client FDE sidebar routes', () => {
  it('every href maps to a real page', () => {
    const facts = viewerFacts('admin', null, true)
    const sections = buildClientFdeSections(CLIENT, 'travel tour', facts, `/dashboard/clients/${CLIENT}/goal/new`)
    for (const item of sections.flatMap((s) => s.items)) {
      if (!item.href || item.href.startsWith('/dashboard/ad-approval')) continue
      const pathOnly = item.href.split('?')[0]
      const segments = pathOnly.split('/').filter(Boolean)
      const page = join(APP_ROOT, ...segments, 'page.tsx')
      const altClientPage = join(APP_ROOT, 'dashboard', 'clients', '[id]', ...segments.slice(3), 'page.tsx')
      const ok = existsSync(page) || existsSync(altClientPage)
      expect(ok, `${item.key} -> ${item.href}`).toBe(true)
    }
  })

  it('travel industry gets tour catalog entry', () => {
    const facts = viewerFacts('admin', null, false)
    const items = buildClientFdeSections(CLIENT, 'travel', facts, '/x').flatMap((s) => s.items)
    expect(items.some((i) => i.key === 'tour-catalog')).toBe(true)
    expect(items.some((i) => i.key === 'listings')).toBe(false)
  })
})
