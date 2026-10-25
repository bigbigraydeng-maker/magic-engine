import { existsSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { DISPATCH_CATALOG } from './catalog'
import { dispatchLoaderRoutes } from './invoke'
import { bucketForSchedule, cronMatches, dispatchInstant } from './match'

const ROOT = path.resolve(__dirname, '../../../..')

/**
 * Health still scores baseline from successful collections, which the route
 * throttles to about once a week. The dispatcher keeps knocking daily.
 */
const SCHEDULE_EXCEPTIONS: Record<string, string> = {
  'render-dashboard:baseline-domains-monthly': '0 17 * * 0',
}

describe('dispatch catalog', () => {
  it('covers every dispatcher-owned registry entry and nothing else', () => {
    const owned = new Set(DISPATCH_CATALOG.map((job) => job.service))
    const marked = CRON_REGISTRY.filter((entry) => entry.scheduler === 'dispatcher').map(
      (entry) => entry.service,
    )
    expect(marked.sort()).toEqual(Array.from(owned).sort())
  })

  it('keeps registry schedules except the documented baseline knock', () => {
    const byService = new Map(CRON_REGISTRY.map((entry) => [entry.service, entry]))
    const drift: string[] = []
    for (const job of DISPATCH_CATALOG) {
      const entry = byService.get(job.service)
      if (!entry) {
        drift.push(`${job.service} missing from registry`)
        continue
      }
      const expected = SCHEDULE_EXCEPTIONS[job.service] ?? job.schedule
      if (entry.schedule !== expected) {
        drift.push(`${job.service}: registry ${entry.schedule} vs ${expected}`)
      }
    }
    expect(drift).toEqual([])
  })

  it('points every route at a real route file and a loader', () => {
    const loaders = new Set(dispatchLoaderRoutes())
    const missing: string[] = []
    for (const job of DISPATCH_CATALOG) {
      const file = path.join(ROOT, 'src/app/api/cron', job.route, 'route.ts')
      if (!existsSync(file)) missing.push(`${job.service} route ${job.route}`)
      if (!loaders.has(job.route)) missing.push(`${job.service} loader ${job.route}`)
      if (bucketForSchedule(job.schedule) === null) missing.push(`${job.service} bucket`)
    }
    expect(missing).toEqual([])
  })

  it('fires each job on its own schedule across a week, and not on the neighbouring minute', () => {
    const start = Date.parse('2026-10-19T00:00:00Z')
    const counts = new Map<string, number>()
    for (let step = 0; step < (7 * 24 * 60) / 5; step += 1) {
      const at = dispatchInstant(new Date(start + step * 5 * 60 * 1000))
      for (const job of DISPATCH_CATALOG) {
        if (!cronMatches(job.schedule, at)) continue
        counts.set(job.service, (counts.get(job.service) ?? 0) + 1)
        const beside = new Date(at.getTime() + 60 * 1000)
        expect(cronMatches(job.schedule, beside), job.service).toBe(false)
      }
    }
    const silent = DISPATCH_CATALOG.filter((job) => (counts.get(job.service) ?? 0) === 0)
    expect(silent.map((job) => job.service)).toEqual([])
    expect(counts.get('viral-discovery-weekly')).toBe(7)
    expect(counts.get('industry-ai-visibility-daily')).toBe(1)
    expect(counts.get('render-dashboard:baseline-domains-monthly')).toBe(7)
    expect(counts.get('pm-daily-todo')).toBe(5)
    expect(counts.get('meta-leads-hourly')).toBe(7 * 12)
    expect(counts.get('attribution-cron')).toBe(7 * 4)
  })

  it('records the three name/schedule mismatches instead of "correcting" them', () => {
    const notes = DISPATCH_CATALOG.filter((job) => job.scheduleNote).map((job) => job.service)
    expect(notes.sort()).toEqual([
      'industry-ai-visibility-daily',
      'render-dashboard:baseline-domains-monthly',
      'viral-discovery-weekly',
    ])
  })
})
