/**
 * T18 / T19 — generic read-back outcome row, registry claim, publish-path guard.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CRON_REGISTRY, UNSCHEDULED_CRON_ROUTES } from '@/lib/cron/registry'
import { STORY_RESOLVE_JOB_NAME } from '@/lib/campaign/daily-plan-publish'
import {
  SOCIAL_READBACK_OUTCOME_JOB,
  claimSocialReadbackOutcomeJobForRegistry,
  socialReadbackOutcomeEnabled,
  writeReadbackOutcome,
} from '@/lib/social/readback-outcome-record'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function insertClient() {
  const inserts: Record<string, unknown>[] = []
  const supabase = {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`unexpected table ${table}`)
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, inserts }
}

describe('socialReadbackOutcomeEnabled', () => {
  it('accepts only the exact string true', () => {
    expect(socialReadbackOutcomeEnabled({ SOCIAL_READBACK_OUTCOME_ENABLED: 'true' })).toBe(true)
    for (const value of [undefined, '', '1', 'TRUE', 'True', 'yes', 'false']) {
      expect(socialReadbackOutcomeEnabled({ SOCIAL_READBACK_OUTCOME_ENABLED: value })).toBe(false)
    }
  })
})

describe('writeReadbackOutcome — T18', () => {
  it('writes social-readback-outcome with no campaign or plan fields', async () => {
    const { supabase, inserts } = insertClient()
    await writeReadbackOutcome(supabase, {
      clientId: CLIENT,
      subjectKind: 'reel',
      subjectRef: '11111_22222',
      outcome: 'reel_rebind_refused:not_published',
      reason: 'not_published',
    })
    expect(inserts).toHaveLength(1)
    const row = inserts[0]
    expect(row.job_name).toBe('social-readback-outcome')
    expect(row.job_name).not.toBe(STORY_RESOLVE_JOB_NAME)
    expect(SOCIAL_READBACK_OUTCOME_JOB).toBe('social-readback-outcome')
    expect(row.status).toBe('failed')
    expect(row.summary).toEqual({
      client_id: CLIENT,
      subject_kind: 'reel',
      subject_ref: '11111_22222',
      outcome: 'reel_rebind_refused:not_published',
      reason: 'not_published',
    })
    expect(row).not.toHaveProperty('campaign_id')
    expect(row).not.toHaveProperty('plan_id')
    expect(JSON.stringify(row)).not.toMatch(/campaign_id|plan_id/)
  })

  it('throws when the insert fails', async () => {
    const supabase = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: 'db down' } }),
      }),
    }
    await expect(writeReadbackOutcome(supabase as unknown as SupabaseClient, {
      clientId: CLIENT,
      subjectKind: 'reel',
      subjectRef: '11111_22222',
      outcome: 'reel_rebind_refused:not_published',
      reason: 'not_published',
    })).rejects.toThrow(/db down/)
  })
})

describe('registry claim — event-driven, not a timetable', () => {
  it('is on the unscheduled list and not in CRON_REGISTRY', () => {
    expect(UNSCHEDULED_CRON_ROUTES[SOCIAL_READBACK_OUTCOME_JOB]).toMatch(/事件/)
    expect(CRON_REGISTRY.some((entry) => entry.jobName === SOCIAL_READBACK_OUTCOME_JOB)).toBe(false)
    expect(typeof claimSocialReadbackOutcomeJobForRegistry).toBe('function')
  })

  it('the reconciliation scanner can see a startCronRunId call for this job', () => {
    const src = readFileSync('src/lib/social/readback-outcome-record.ts', 'utf8')
    expect(src).toMatch(/startCronRunId\(SOCIAL_READBACK_OUTCOME_JOB\)/)
  })
})

describe('T19 — this package does not touch publish pause', () => {
  it('read-back files do not import the publish worker or the live switch', () => {
    const files = [
      'src/lib/inngest/functions/factory-reel-measurement-adapter.ts',
      'src/lib/social/readback-outcome-record.ts',
      'src/lib/pm-todo/social-readback-items.ts',
      'src/lib/pm-todo/manual-items.ts',
    ]
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/FACTORY_PUBLISH_LIVE/)
      expect(src, file).not.toMatch(/from ['"][^'"]*publish-worker['"]/)
    }
  })

  it('今日待办组装处在开关打开时才读读回链结果', () => {
    const src = readFileSync('src/lib/pm-todo/manual-items.ts', 'utf8')
    expect(src).toContain('pushSocialReadbackItems')
    expect(src).toContain('socialReadbackOutcomeEnabled()')
  })
})
