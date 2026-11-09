import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const runAudit = vi.fn()
const sendEvent = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/calendar-closure/deps', () => ({ createLiveAuditDeps: () => ({ fake: true }) }))
vi.mock('@/lib/calendar-closure/run-audit', () => ({
  runCalendarClosureAudit: (...args: unknown[]) => runAudit(...args),
  nzTodayDate: () => '2026-10-08',
}))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: (...args: unknown[]) => sendEvent(...args) }))

import { POST } from '../route'

function req(body: unknown, auth: string | null = 'Bearer secret'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest('http://localhost/api/cron/calendar-closure-audit', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/cron/calendar-closure-audit', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret')
    runAudit.mockReset()
    sendEvent.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('没有 / 错误的口令 -> 401，什么都不跑', async () => {
    expect((await POST(req({}, null))).status).toBe(401)
    expect((await POST(req({}, 'Bearer nope'))).status).toBe(401)
    expect(runAudit).not.toHaveBeenCalled()
    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('非演练带 override 参数 -> 400，不发事件、不跑巡检', async () => {
    for (const body of [
      { only_event_id: 'x' },
      { today_override: '2026-10-09' },
      { probe_override: 'cron_run_ok job=a within_hours=1' },
    ]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
    }
    expect(runAudit).not.toHaveBeenCalled()
    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('today_override 格式不对 -> 400', async () => {
    const res = await POST(req({ dry_run: true, today_override: '10/09' }))
    expect(res.status).toBe(400)
    expect(runAudit).not.toHaveBeenCalled()
  })

  it('演练：同步跑，不发 Inngest 事件，并且透传 override', async () => {
    runAudit.mockResolvedValue({ status: 'ok', not_evidence: true, results: [] })
    const res = await POST(
      req({
        dry_run: true,
        only_event_id: 'evt1',
        today_override: '2026-10-09',
        probe_override: 'cron_run_ok job=a within_hours=1',
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.not_evidence).toBe(true)
    expect(json.no_writes).toBe(true)
    expect(sendEvent).not.toHaveBeenCalled()
    expect(runAudit).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        dryRun: true,
        source: 'live',
        onlyEventId: 'evt1',
        todayOverride: '2026-10-09',
        probeOverrideLine: 'cron_run_ok job=a within_hours=1',
      }),
    )
  })

  it('非演练：只发一个事件，自己不跑巡检', async () => {
    sendEvent.mockResolvedValue({ event_ids: ['e1'] })
    const res = await POST(req({}))
    expect(res.status).toBe(200)
    expect(sendEvent).toHaveBeenCalledTimes(1)
    expect(sendEvent.mock.calls[0][0].name).toBe('calendar_closure/audit.due')
    expect(runAudit).not.toHaveBeenCalled()
  })

  it('发事件失败 -> 500 并带原因', async () => {
    sendEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    const res = await POST(req({}))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('INNGEST_EVENT_KEY_MISSING')
  })

  it('坏 JSON -> 400', async () => {
    const r = new NextRequest('http://localhost/x', {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: '{not json',
    })
    expect((await POST(r)).status).toBe(400)
  })
})
