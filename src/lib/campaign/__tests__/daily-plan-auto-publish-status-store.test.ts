import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

import { listPlanAttempts } from '../daily-plan-auto-publish-status-store'
import type { AttemptRecord } from '../daily-plan-auto-publish-worker-store'

/**
 * A chainable Supabase stub: every builder method returns the same object, and
 * the object is thenable so `await` on a non-terminal chain resolves to the
 * configured result.
 */
interface StubResult {
  data: unknown
  error: { code?: string; message?: string } | null
}

interface ChainStub {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  then: (resolve: (value: StubResult) => unknown) => unknown
}

function makeChain(result: StubResult): ChainStub {
  const stub = {} as ChainStub
  const self = () => stub

  stub.select = vi.fn(self)
  stub.eq = vi.fn(self)
  stub.then = resolve => resolve(result)

  return stub
}

const CLIENT = 'c0000000-0000-0000-0000-000000000001'
const PLAN = 'c0000000-0000-0000-0000-000000000003'
const DATE = '2024-02-01'

const storedAttempt: AttemptRecord = {
  id: 'attempt-1',
  auth_id: 'auth-1',
  client_id: CLIENT,
  plan_id: PLAN,
  date: DATE,
  attempt_no: 1,
  status: 'claimed',
  reason_code: null,
  request_id: 'req-1',
  provider_impact: 'NONE',
  post_id: null,
  scheduled_publish_time: null,
  next_retry_at: null,
  updated_at: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('listPlanAttempts', () => {
  it('🔴 reads every attempt row for the plan and client', async () => {
    const chain = makeChain({ data: [storedAttempt], error: null })
    fromMock.mockReturnValue(chain)

    expect(await listPlanAttempts(PLAN, CLIENT)).toEqual([storedAttempt])
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
  })

  it('returns an empty list when there are none', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await listPlanAttempts(PLAN, CLIENT)).toEqual([])
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))
    await expect(listPlanAttempts(PLAN, CLIENT)).rejects.toMatchObject({ code: '42P01' })
  })
})
