import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminAccess } from './access-fixtures'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAccess: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', () => ({
  getBatch: vi.fn(),
  applyBatch: vi.fn(),
  rollbackBatch: vi.fn(),
}))

import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { getBatch, applyBatch, rollbackBatch } from '@/lib/tour-catalog/store'
import { POST as applyPOST } from '../batches/[batchId]/apply/route'
import { POST as rollbackPOST } from '../batches/[batchId]/rollback/route'

const requireCatalogAccessMock = vi.mocked(requireCatalogAccess)
const getBatchMock = vi.mocked(getBatch)
const applyBatchMock = vi.mocked(applyBatch)
const rollbackBatchMock = vi.mocked(rollbackBatch)

const CLIENT_ID = 'client-1'
const BATCH_ID = 'b0000000-0000-4000-8000-000000000001'
const ACTOR = 'admin@example.com'
const PLAN_HASH = 'hash-abc'

function params() {
  return { params: Promise.resolve({ id: CLIENT_ID, batchId: BATCH_ID }) }
}

function jsonRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function emptyRequest(): NextRequest {
  return new NextRequest('http://localhost/api/test', { method: 'POST' })
}

function allowAccess() {
  requireCatalogAccessMock.mockResolvedValue(adminAccess(ACTOR))
}

function denyAccess() {
  requireCatalogAccessMock.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  })
}

function batchWithWarnings(warningCount: number) {
  return {
    id: BATCH_ID,
    clientId: CLIENT_ID,
    kind: 'departures',
    status: 'previewed',
    fileSha256: 'sha',
    rowCounts: { warningCount, planHash: PLAN_HASH },
    plan: {},
    createdAt: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('apply route', () => {
  it('returns the access response when access is denied', async () => {
    denyAccess()
    const res = await applyPOST(jsonRequest({}), params())
    expect(res.status).toBe(403)
    expect(getBatchMock).not.toHaveBeenCalled()
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the batch is not found', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(null)
    const res = await applyPOST(jsonRequest({}), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'batch_not_found' })
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('returns 409 plan_changed when the plan hash mismatches', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    const res = await applyPOST(
      jsonRequest({ planHash: 'other-hash' }),
      params(),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'plan_changed' })
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('returns 409 plan_changed when the plan hash is missing', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    const res = await applyPOST(jsonRequest({}), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'plan_changed' })
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('checks plan_changed before warnings', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(3))
    const res = await applyPOST(jsonRequest({}), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'plan_changed' })
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('returns 409 when warnings exist and are not acknowledged', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(3))
    const res = await applyPOST(jsonRequest({ planHash: PLAN_HASH }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'warnings_not_acknowledged',
      warningCount: 3,
    })
    expect(applyBatchMock).not.toHaveBeenCalled()
  })

  it('applies with the actor when warnings are acknowledged', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(2))
    applyBatchMock.mockResolvedValue({ ok: true, result: { applied: 5 } })
    const res = await applyPOST(
      jsonRequest({ acknowledgeWarnings: true, planHash: PLAN_HASH }),
      params(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { applied: 5 } })
    expect(applyBatchMock).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      BATCH_ID,
      ACTOR,
    )
  })

  it('applies with zero warnings and a matching hash', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    applyBatchMock.mockResolvedValue({ ok: true, result: {} })
    const res = await applyPOST(jsonRequest({ planHash: PLAN_HASH }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: {} })
    expect(applyBatchMock).toHaveBeenCalledTimes(1)
  })

  it('maps not_applicable to 409', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    applyBatchMock.mockResolvedValue({
      ok: false,
      code: 'not_applicable',
      message: 'batch_not_applicable',
    })
    const res = await applyPOST(jsonRequest({ planHash: PLAN_HASH }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_applicable' })
  })

  it('maps conflict to 409 without leaking the message', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    applyBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:departure_changed',
    })
    const res = await applyPOST(jsonRequest({ planHash: PLAN_HASH }), params())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'conflict' })
    expect(body).not.toHaveProperty('message')
  })

  it('maps error to 500', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    applyBatchMock.mockResolvedValue({
      ok: false,
      code: 'error',
      message: 'boom',
    })
    const res = await applyPOST(jsonRequest({ planHash: PLAN_HASH }), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'apply_failed' })
  })
})

describe('rollback route', () => {
  it('returns the access response when access is denied', async () => {
    denyAccess()
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(403)
    expect(getBatchMock).not.toHaveBeenCalled()
    expect(rollbackBatchMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the batch is not found', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(null)
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'batch_not_found' })
    expect(rollbackBatchMock).not.toHaveBeenCalled()
  })

  it('returns 200 on success', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    rollbackBatchMock.mockResolvedValue({ ok: true, result: { reverted: 4 } })
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { reverted: 4 } })
    // The operator is passed down so the change log can say who undid the import.
    expect(rollbackBatchMock).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      BATCH_ID,
      ACTOR,
    )
  })

  it('maps not_applicable to 409', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'not_applicable',
      message: 'batch_not_rollbackable',
    })
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_applicable' })
  })

  it('maps conflict to 409 without leaking the internal message', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:departure_changed',
    })
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict' })
  })

  it('maps error to 500', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(batchWithWarnings(0))
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'error',
      message: 'boom',
    })
    const res = await rollbackPOST(emptyRequest(), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'rollback_failed' })
  })
})
