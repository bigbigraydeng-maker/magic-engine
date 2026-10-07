import { describe, expect, it, vi } from 'vitest'
import {
  EMAIL_FREQUENCY_CAP_CHECK_REQUESTED,
  EMAIL_FREQUENCY_CAP_CHECKED,
} from '../../email-events'
import { cloudFunctions } from '../index'
import {
  EMAIL_FREQUENCY_CAP_CHECK_FN_ID,
  createEmailFrequencyCapFunction,
  type FrequencyCapConfigResult,
} from '../email-frequency-cap-check'
import type { FrequencyCapReceipt } from '@/lib/mailchimp/send-frequency-cap'

type Fn = ReturnType<typeof createEmailFrequencyCapFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as { opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } } }).opts
}
function handlerOf(fn: Fn) { return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn }

const CLIENT_ID = 'aaaaaaaa-0000-4000-8000-000000000000'
const REQUEST_ID = 'req-1'

function makeStep() {
  return {
    run: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()),
    sendEvent: vi.fn(async (_stepId: string, _event: SentEventPayload) => undefined),
  }
}

function makeReceipt(overrides: Partial<FrequencyCapReceipt> = {}): FrequencyCapReceipt {
  return {
    receipt_version: 1,
    client_id: CLIENT_ID,
    request_id: REQUEST_ID,
    window_days: 7,
    policy: { maxSends: 2, windowDays: 7 },
    allowed: [],
    excluded: [],
    allowed_count: 2,
    excluded_count: 1,
    scanned: 3,
    lookup_failed_count: 0,
    no_publish: true,
    mailchimp_writes: 0,
    checked_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as FrequencyCapReceipt
}

interface SentEventPayload {
  name: string
  id: string
  data: Record<string, unknown>
}

describe('email frequency cap check Inngest workflow', () => {
  it('is registered and serializes checks per client', () => {
    const registered = cloudFunctions.find(fn => fn.id() === EMAIL_FREQUENCY_CAP_CHECK_FN_ID)
    expect(registered).toBeDefined()
    expect(optsOf(registered as Fn).triggers?.[0]?.event).toBe(EMAIL_FREQUENCY_CAP_CHECK_REQUESTED)
    expect(optsOf(registered as Fn).retries).toBe(1)
    expect(optsOf(registered as Fn).concurrency).toEqual({ limit: 1, key: 'event.data.client_id' })
  })

  it('rejects malformed events before opening any step', async () => {
    const loadConfig = vi.fn()
    const check = vi.fn()
    const fn = createEmailFrequencyCapFunction({ loadConfig, check, readApiKey: () => 'k-us19' } as never)

    const tooMany = Array.from({ length: 501 }, (_, i) => `a${i}@example.com`)
    const cases = [
      { client_id: 'bad', request_id: REQUEST_ID, recipients: ['a@example.com'] },
      { client_id: CLIENT_ID, request_id: REQUEST_ID, recipients: [] },
      { client_id: CLIENT_ID, request_id: REQUEST_ID, recipients: tooMany },
    ]

    for (const data of cases) {
      const step = makeStep()
      const result = await handlerOf(fn)({ event: { data }, step })
      expect(result).toEqual({ status: 'invalid_payload' })
      expect(step.run).not.toHaveBeenCalled()
      expect(step.sendEvent).not.toHaveBeenCalled()
    }

    expect(loadConfig).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it('runs the check and emits a checked receipt', async () => {
    const stampedAt = '2024-01-01T00:00:00.000Z'
    const loadConfig = vi.fn(async (): Promise<FrequencyCapConfigResult> => ({
      status: 'ok',
      audienceId: 'aud',
      policy: { maxSends: 2, windowDays: 7 },
    }))
    const receipt = makeReceipt()
    const check = vi.fn(async () => receipt)
    const fn = createEmailFrequencyCapFunction({ loadConfig, check, readApiKey: () => 'k-us19' } as never)

    const recipients = ['a@example.com', 'b@example.com', 'c@example.com']
    const step = makeStep()
    const stepOutputs: unknown[] = []
    step.run = vi.fn(async (name: string, work: () => Promise<unknown>) => {
      const out = name === 'stamp' ? stampedAt : await work()
      stepOutputs.push(out)
      return out
    })

    const result = await handlerOf(fn)({
      event: { data: { client_id: CLIENT_ID, request_id: REQUEST_ID, recipients } },
      step,
    })

    expect(result).toEqual({
      status: 'checked',
      request_id: REQUEST_ID,
      scanned: 3,
      allowed_count: 2,
      excluded_count: 1,
      lookup_failed_count: 0,
    })

    expect(check).toHaveBeenCalledOnce()
    expect(check).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      requestId: REQUEST_ID,
      cfg: { apiKey: 'k-us19', audienceId: 'aud' },
      policy: { maxSends: 2, windowDays: 7 },
      emails: recipients,
      now: new Date(stampedAt),
    })

    expect(step.sendEvent).toHaveBeenCalledOnce()
    const [eventName, payload] = step.sendEvent.mock.calls[0] as [
      string,
      { name: string; id: string; data: { status: string; receipt: FrequencyCapReceipt } },
    ]
    expect(eventName).toBe('emit-receipt')
    expect(payload.name).toBe(EMAIL_FREQUENCY_CAP_CHECKED)
    expect(payload.id).toMatch(new RegExp(`^freqcap:${CLIENT_ID}:${REQUEST_ID}:[0-9a-f]{16}:checked$`))
    // 密钥不得出现在任何会被持久化的 step 输出里
    expect(JSON.stringify(stepOutputs)).not.toContain('k-us19')
    expect(payload.data.status).toBe('checked')
    expect(payload.data.receipt.no_publish).toBe(true)
    expect(payload.data.receipt.mailchimp_writes).toBe(0)
  })

  it('fails closed for every skipped reason', async () => {
    const reasons = [
      'policy_not_configured',
      'audience_not_configured',
      'api_key_missing',
      'config_unreadable',
    ] as const

    for (const reason of reasons) {
      const loadConfig = vi.fn(async (): Promise<FrequencyCapConfigResult> => ({
        status: 'skipped',
        reason,
      }))
      const check = vi.fn()
      const fn = createEmailFrequencyCapFunction({ loadConfig, check, readApiKey: () => 'k-us19' } as never)

      const step = makeStep()
      const result = await handlerOf(fn)({
        event: {
          data: { client_id: CLIENT_ID, request_id: REQUEST_ID, recipients: ['a@example.com'] },
        },
        step,
      })

      expect(result).toEqual({ status: 'skipped', reason, request_id: REQUEST_ID })
      expect(check).not.toHaveBeenCalled()
      expect(step.sendEvent).toHaveBeenCalledOnce()

      const [eventName, payload] = step.sendEvent.mock.calls[0] as [
        string,
        { name: string; id: string; data: Record<string, unknown> },
      ]
      expect(eventName).toBe('emit-skipped')
      expect(payload.name).toBe(EMAIL_FREQUENCY_CAP_CHECKED)
      expect(payload.id).toMatch(new RegExp(`^freqcap:${CLIENT_ID}:${REQUEST_ID}:[0-9a-f]{16}:skipped$`))
      expect(payload.data.status).toBe('skipped')
      expect(payload.data.reason).toBe(reason)
      expect(payload.data.no_publish).toBe(true)
      expect(payload.data.mailchimp_writes).toBe(0)
      expect('allowed' in payload.data).toBe(false)
    }
  })

  it('stamps the time inside a durable step so replay is stable', async () => {
    const loadConfig = vi.fn(async (): Promise<FrequencyCapConfigResult> => ({
      status: 'skipped',
      reason: 'policy_not_configured',
    }))
    const check = vi.fn()
    const fn = createEmailFrequencyCapFunction({ loadConfig, check, readApiKey: () => 'k-us19' } as never)

    const step = makeStep()
    await handlerOf(fn)({
      event: {
        data: { client_id: CLIENT_ID, request_id: REQUEST_ID, recipients: ['a@example.com'] },
      },
      step,
    })

    expect(step.run).toHaveBeenCalled()
    expect(step.run.mock.calls[0][0]).toBe('stamp')
  })
})
