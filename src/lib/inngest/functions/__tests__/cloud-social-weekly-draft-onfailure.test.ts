/**
 * When a weekly-draft step dies before finish-run, onFailure closes only this
 * Inngest run's log row, and a write-mode client row is shaped so the existing
 * to-do reader says the week's pack did not finish.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({
  supabaseAdmin: (await import('@/lib/gsc/__tests__/fake-db')).fakeDb.client,
}))
vi.mock('@/lib/social/image-post-step', () => ({ runImagePostStep: vi.fn() }))
vi.mock('@/lib/ai/openai-client', () => ({ getOpenAIClient: () => ({ chat: { completions: { create: vi.fn() } } }) }))

import { fakeDb } from '@/lib/gsc/__tests__/fake-db'
import { cronRunIdFromInngestRun } from '@/lib/cron/run-logger'
import { readDeliveredTasks } from '@/lib/pm-todo/social-weekly-loop-items'
import { WEEKLY_LOOP_JOB } from '@/lib/social/weekly-loop/run'
import {
  createSocialWeeklyDraftFunction,
  openWeeklyDraftRun,
  SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
  type SocialWeeklyDraftDeps,
} from '../cloud-social-weekly-draft'
import {
  SOCIAL_WEEKLY_DRAFT_FAILURE_DUE_EVENT,
  socialWeeklyDraftOnFailure,
} from '../social-weekly-draft-failure'

const CLIENT = 'client-a'
const OWN_RUN = 'inngest-run-own'
const OTHER_RUN = 'inngest-run-other'
const FAILED_AT = Date.parse('2026-11-11T18:00:00.000Z')

function row(id: string, status = 'running'): Record<string, unknown> {
  return {
    id,
    job_name: WEEKLY_LOOP_JOB,
    status,
    started_at: '2026-11-11T17:30:00.000Z',
    finished_at: null,
    error_message: null,
    summary: null,
  }
}

function logs(): Record<string, unknown>[] {
  return fakeDb.tables.cron_run_logs ?? []
}

function findLog(id: string): Record<string, unknown> | undefined {
  return logs().find((item) => item.id === id)
}

beforeEach(() => {
  fakeDb.reset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('social-weekly-draft onFailure', () => {
  it('keeps retries at 0 and matches the due-event name the handler listens for', () => {
    const fn = createSocialWeeklyDraftFunction({} as SocialWeeklyDraftDeps)
    expect(fn.opts.retries).toBe(0)
    expect(typeof fn.opts.onFailure).toBe('function')
    expect(fn.opts.onFailure).toBe(socialWeeklyDraftOnFailure)
    expect(SOCIAL_WEEKLY_DRAFT_FAILURE_DUE_EVENT).toBe(SOCIAL_WEEKLY_DRAFT_DUE_EVENT)
  })

  it('threads this Inngest run id into startRun', async () => {
    const startRun = vi.fn(async () => 'run-1')
    const deps = {
      env: () => ({}),
      now: () => new Date('2026-11-11T00:00:00.000Z'),
      listClients: vi.fn(),
      loadClientConfig: vi.fn(),
      loopDeps: () => {
        throw new Error('not used')
      },
      startRun,
      finishRun: vi.fn(async () => undefined),
      send: vi.fn(),
      loadMaliangSpend: vi.fn(),
      reviewVideo: vi.fn(),
      supabaseUrl: () => undefined,
      reviewReady: () => false,
      reserveMaliangSpend: vi.fn(),
    } satisfies SocialWeeklyDraftDeps
    const fn = createSocialWeeklyDraftFunction(deps)
    const handler = (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
    await handler({
      event: { name: 'inngest/scheduled.timer', data: {} },
      step: { run: async (_id: string, body: () => Promise<unknown>) => body() },
      runId: OWN_RUN,
    })
    expect(startRun).toHaveBeenCalledWith(OWN_RUN)
  })

  it('opens the log row under the id derived from this Inngest run', async () => {
    fakeDb.tables.cron_run_logs = [row('sibling-random')]
    const id = await openWeeklyDraftRun(OWN_RUN)
    expect(id).toBe(cronRunIdFromInngestRun(OWN_RUN))
    expect(findLog(id)?.status).toBe('running')
    expect(findLog('sibling-random')?.status).toBe('running')
  })

  it('closes only this run and stamps the write-mode summary the to-do reader needs', async () => {
    const ownId = cronRunIdFromInngestRun(OWN_RUN)
    const otherId = cronRunIdFromInngestRun(OTHER_RUN)
    fakeDb.tables.cron_run_logs = [row(ownId), row(otherId)]

    await socialWeeklyDraftOnFailure({
      event: {
        ts: FAILED_AT,
        data: {
          run_id: OWN_RUN,
          event: {
            name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
            data: { clientId: CLIENT, mode: 'write', source: 'cron' },
          },
        },
      },
      error: new Error('connection reset'),
    })

    const own = findLog(ownId)
    expect(own?.status).toBe('failed')
    expect(own?.error_message).toBe('connection reset')
    expect(own?.finished_at).toEqual(expect.any(String))
    expect(own?.summary).toEqual({
      kind: 'client_run',
      client_id: CLIENT,
      mode: 'write',
      status: 'failed',
      error: 'connection reset',
      no_publish: true,
    })
    expect(findLog(otherId)?.status).toBe('running')
    expect(findLog(otherId)?.finished_at).toBeNull()

    const delivered = readDeliveredTasks(own?.summary)
    expect(delivered?.clientId).toBe(CLIENT)
    expect(delivered?.tasks).toHaveLength(1)
    expect(delivered?.tasks[0].code).toBe('run_incomplete')
    expect(delivered?.tasks[0].what).toContain('本周排期没跑完整')
    expect(delivered?.tasks[0].what).toContain('connection reset')
  })

  it('still writes this run when the open row never landed, and leaves the other run alone', async () => {
    const otherId = cronRunIdFromInngestRun(OTHER_RUN)
    fakeDb.tables.cron_run_logs = [row(otherId)]

    await socialWeeklyDraftOnFailure({
      event: {
        ts: FAILED_AT,
        data: {
          run_id: OWN_RUN,
          event: {
            name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
            data: { clientId: CLIENT, mode: 'write', source: 'cron' },
          },
        },
      },
      error: new Error('connection reset'),
    })

    const own = findLog(cronRunIdFromInngestRun(OWN_RUN))
    expect(own?.status).toBe('failed')
    expect(own?.job_name).toBe(WEEKLY_LOOP_JOB)
    const delivered = readDeliveredTasks(own?.summary)
    expect(delivered?.tasks[0].what).toContain('本周排期没跑完整')
    expect(findLog(otherId)?.status).toBe('running')
  })

  it('a dry-run failure is closed but does not become a to-do', async () => {
    const ownId = cronRunIdFromInngestRun(OWN_RUN)
    fakeDb.tables.cron_run_logs = [row(ownId)]

    await socialWeeklyDraftOnFailure({
      event: {
        data: {
          run_id: OWN_RUN,
          event: { name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT, data: { clientId: CLIENT, mode: 'dry_run' } },
        },
      },
      error: new Error('connection reset'),
    })

    const own = findLog(ownId)
    expect(own?.status).toBe('failed')
    expect(readDeliveredTasks(own?.summary)).toBeNull()
  })

  it('a fan-out failure closes only its own row and is not a client to-do', async () => {
    const ownId = cronRunIdFromInngestRun(OWN_RUN)
    const otherId = cronRunIdFromInngestRun(OTHER_RUN)
    fakeDb.tables.cron_run_logs = [row(ownId), row(otherId)]

    await socialWeeklyDraftOnFailure({
      event: {
        data: {
          run_id: OWN_RUN,
          event: { name: 'inngest/scheduled.timer', data: {} },
        },
      },
      error: new Error('connection reset'),
    })

    expect(findLog(ownId)?.status).toBe('failed')
    expect(readDeliveredTasks(findLog(ownId)?.summary)).toBeNull()
    expect(findLog(otherId)?.status).toBe('running')
  })

  it('without a run id, leaves every open row running', async () => {
    fakeDb.tables.cron_run_logs = [row('sibling-random')]
    await socialWeeklyDraftOnFailure({
      event: { data: { event: { name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT, data: { clientId: CLIENT, mode: 'write' } } } },
      error: new Error('connection reset'),
    })
    expect(findLog('sibling-random')?.status).toBe('running')
    expect(logs()).toHaveLength(1)
  })
})
