import { afterEach, describe, expect, it, vi } from 'vitest'
import { DASHBOARD_COMPETITOR_ADS_REQUEST } from '../contracts'
import { postFieldAgentWebhook, resolveFieldAgentWebhook } from '../dispatch'
import { runCompetitorAdsDispatch } from '../tasks'

const webhook = { url: 'https://agent.example/hook', headerName: 'Authorization', headerValue: 'Bearer secret' }

describe('field agent webhook', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null until both an https url and a key are set', () => {
    expect(resolveFieldAgentWebhook({})).toBeNull()
    expect(resolveFieldAgentWebhook({ FIELD_AGENT_WEBHOOK_URL: 'http://agent.example/hook', FIELD_AGENT_WEBHOOK_KEY: 'secret' })).toBeNull()
    expect(resolveFieldAgentWebhook({ FIELD_AGENT_WEBHOOK_URL: 'https://agent.example/hook', FIELD_AGENT_WEBHOOK_KEY: 'secret' })).toEqual(webhook)
  })

  it('uses a custom header value without adding Bearer', () => {
    expect(resolveFieldAgentWebhook({
      FIELD_AGENT_WEBHOOK_URL: 'https://agent.example/hook',
      FIELD_AGENT_WEBHOOK_KEY: 'raw-key',
      FIELD_AGENT_WEBHOOK_HEADER: 'X-Field-Key',
    })).toMatchObject({ headerName: 'X-Field-Key', headerValue: 'raw-key' })
  })

  it('posts the task id, client, enriched params and write targets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const body = {
      task_id: '22222222-2222-4222-8222-222222222222',
      client_id: '11111111-1111-4111-8111-111111111111',
      task_type: 'competitor_ads_scan' as const,
      params: { channel: 'meta_ad_library' as const, active_only: true as const, competitors: [] },
      write_targets: {
        tasks_table: 'field_agent_tasks' as const,
        observations_table: 'web_intelligence_external_observations' as const,
        screenshot_bucket: 'field-agent-screenshots' as const,
      },
    }
    await expect(postFieldAgentWebhook(webhook, body, fetchImpl)).resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledWith(webhook.url, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify(body),
    }))
  })
})

describe('competitor ads dispatch', () => {
  const competitors = [{ domain: 'live.example', tier: 'watch', status: 'active', urls: ['https://live.example/'] }]

  it('does not create a task when the webhook is unset', async () => {
    const insertTask = vi.fn()
    const result = await runCompetitorAdsDispatch({
      clientId: '11111111-1111-4111-8111-111111111111', requestedBy: 'ray@example.com',
      body: DASHBOARD_COMPETITOR_ADS_REQUEST, competitors, webhook: null,
      insertTask, markDispatched: vi.fn(), markFailed: vi.fn(),
    })
    expect(result).toMatchObject({ httpStatus: 200, dispatched: false, task_id: null })
    expect(result.message).toContain('还没接上')
    expect(insertTask).not.toHaveBeenCalled()
  })

  it('marks the task failed when the webhook does not accept it', async () => {
    const markFailed = vi.fn()
    const result = await runCompetitorAdsDispatch({
      clientId: '11111111-1111-4111-8111-111111111111', requestedBy: 'ray@example.com',
      body: DASHBOARD_COMPETITOR_ADS_REQUEST, competitors, webhook,
      insertTask: async () => ({ id: '22222222-2222-4222-8222-222222222222' }),
      markDispatched: vi.fn(), markFailed,
      post: async () => ({ ok: false, message: 'webhook_http_500' }),
    })
    expect(result).toMatchObject({ httpStatus: 502, status: 'failed', task_id: '22222222-2222-4222-8222-222222222222' })
    expect(markFailed).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'webhook_http_500')
  })

  it('stores active competitors and leaves the task queued after a successful post', async () => {
    const insertTask = vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' })
    const markDispatched = vi.fn()
    const post = vi.fn().mockResolvedValue({ ok: true })
    const result = await runCompetitorAdsDispatch({
      clientId: '11111111-1111-4111-8111-111111111111', requestedBy: 'ray@example.com',
      body: DASHBOARD_COMPETITOR_ADS_REQUEST,
      competitors: [...competitors, { domain: 'old.example', tier: 'watch', status: 'archive', urls: [] }],
      webhook, insertTask, markDispatched, markFailed: vi.fn(), post,
    })
    expect(result).toMatchObject({ httpStatus: 202, dispatched: true, status: 'queued' })
    expect(insertTask.mock.calls[0][0].params.competitors).toEqual([{ domain: 'live.example', tier: 'watch', urls: ['https://live.example/'] }])
    expect(post.mock.calls[0][1]).toMatchObject({
      task_id: '22222222-2222-4222-8222-222222222222',
      task_type: 'competitor_ads_scan',
      write_targets: { observations_table: 'web_intelligence_external_observations', screenshot_bucket: 'field-agent-screenshots' },
    })
    expect(markDispatched).toHaveBeenCalled()
  })
})
