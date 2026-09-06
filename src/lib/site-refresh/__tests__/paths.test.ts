import { describe, it, expect } from 'vitest'
import { planSiteRefresh, pathsFromPlan, CTS_TOUR_PATHS, CTS_BLOG_PATHS } from '../paths'

describe('planSiteRefresh', () => {
  it('short-circuits when nothing site-affecting changed', () => {
    const plan = planSiteRefresh(['README.md', 'package-lock.json', 'scripts/foo.py'])
    expect(plan.hasSiteChange).toBe(false)
    expect(plan.tourDataChanged).toBe(false)
    expect(plan.blogDataChanged).toBe(false)
    expect(pathsFromPlan(plan)).toEqual([])
  })

  it('detects tour data change and only lists tour paths', () => {
    const plan = planSiteRefresh(['src/lib/data/tours.ts'])
    expect(plan.hasSiteChange).toBe(true)
    expect(plan.tourDataChanged).toBe(true)
    expect(plan.blogDataChanged).toBe(false)
    const paths = pathsFromPlan(plan)
    expect(paths).toEqual([...CTS_TOUR_PATHS])
  })

  it('detects blog data change (bundled file) and only lists blog paths', () => {
    const plan = planSiteRefresh(['src/lib/data/blogs-longtail-batch1.ts'])
    expect(plan.blogDataChanged).toBe(true)
    expect(plan.tourDataChanged).toBe(false)
    const paths = pathsFromPlan(plan)
    expect(paths).toEqual([...CTS_BLOG_PATHS])
  })

  it('schema-tour edits fan out to both tour + blog paths', () => {
    const plan = planSiteRefresh(['src/lib/schema-tour.ts'])
    expect(plan.tourDataChanged).toBe(true)
    expect(plan.blogDataChanged).toBe(true)
    const paths = pathsFromPlan(plan)
    // deduped
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of CTS_TOUR_PATHS) expect(paths).toContain(p)
    for (const p of CTS_BLOG_PATHS) expect(paths).toContain(p)
  })

  it('a mix of touched files still fires only once per bucket', () => {
    const plan = planSiteRefresh([
      'src/lib/data/tours.ts',
      'src/lib/data/blogs.ts',
      'src/lib/campaigns/october-2026-discovery.ts',
      'README.md',
    ])
    expect(plan.hasSiteChange).toBe(true)
    expect(plan.tourDataChanged).toBe(true)
    expect(plan.blogDataChanged).toBe(true)
    expect(plan.reasons.some((r) => r.startsWith('tour-data:'))).toBe(true)
    expect(plan.reasons.some((r) => r.startsWith('blog-data:'))).toBe(true)
    expect(plan.reasons.some((r) => r.startsWith('campaign:'))).toBe(true)
  })
})
