import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CRON_REGISTRY, UNSCHEDULED_CRON_ROUTES } from '@/lib/cron/registry'
import {
  SOCIAL_PUBLISH_DISPATCH_JOB,
  claimSocialPublishDispatchJobForRegistry,
  writePublishDispatchReceipt,
  type PublishDispatchReceipt,
} from './receipt'

const CLIENT = '11111111-1111-4111-8111-111111111111'

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

function receipt(over: Partial<PublishDispatchReceipt> = {}): PublishDispatchReceipt {
  return {
    clientId: CLIENT,
    kind: 'story_register',
    subjectRef: '22222222-2222-4222-8222-222222222222',
    mode: 'dry_run',
    postId: 'story-receipt-1',
    publishedAt: '2026-11-02T07:00:00.000Z',
    calledPublishApi: false,
    reason: 'master_switch_off',
    ...over,
  }
}

describe('writePublishDispatchReceipt', () => {
  it('writes post id and time on a dry run and does not call a publish api', async () => {
    const { supabase, inserts } = insertClient()
    await writePublishDispatchReceipt(supabase, receipt())
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      job_name: SOCIAL_PUBLISH_DISPATCH_JOB,
      status: 'completed',
      failed_count: 0,
    })
    expect(inserts[0].summary).toMatchObject({
      post_id: 'story-receipt-1',
      published_at: '2026-11-02T07:00:00.000Z',
      called_publish_api: false,
      mode: 'dry_run',
    })
  })

  it('a failed write is a failed row, and a write error is thrown', async () => {
    const { supabase, inserts } = insertClient()
    await writePublishDispatchReceipt(supabase, receipt({ mode: 'failed', postId: null, publishedAt: null, reason: 'item_not_found' }))
    expect(inserts[0]).toMatchObject({ status: 'failed', failed_count: 1, error_message: 'item_not_found' })

    const broken = {
      from: () => ({ insert: () => Promise.resolve({ error: { message: 'db down' } }) }),
    } as unknown as SupabaseClient
    await expect(writePublishDispatchReceipt(broken, receipt())).rejects.toThrow('db down')
  })

  it('refuses a dry run that claims it called the publish api, and a registration with no post id', async () => {
    const { supabase } = insertClient()
    await expect(writePublishDispatchReceipt(supabase, receipt({ calledPublishApi: true }))).rejects.toThrow('publish api')
    await expect(writePublishDispatchReceipt(supabase, receipt({
      mode: 'registered',
      calledPublishApi: true,
      postId: null,
    }))).rejects.toThrow('post id')
  })

  it('is on the unscheduled list and the writer source does not call Graph', () => {
    expect(SOCIAL_PUBLISH_DISPATCH_JOB in UNSCHEDULED_CRON_ROUTES).toBe(true)
    expect(CRON_REGISTRY.some((entry) => entry.jobName === SOCIAL_PUBLISH_DISPATCH_JOB)).toBe(false)
    expect(typeof claimSocialPublishDispatchJobForRegistry).toBe('function')
    const src = readFileSync(resolve('src/lib/social/publish-gate/receipt.ts'), 'utf8')
    expect(src).not.toContain('graph.facebook.com')
    expect(src).not.toContain('publishPagePhotoPost')
  })
})
