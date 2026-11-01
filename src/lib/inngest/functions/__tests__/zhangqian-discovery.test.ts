import { describe, it, expect, vi, beforeEach } from 'vitest'

const getJob = vi.fn()
const failJob = vi.fn()
const refundOnFail = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/zhangqian/persistor', () => ({ getJob: (...a: unknown[]) => getJob(...a), failJob: (...a: unknown[]) => failJob(...a) }))
vi.mock('@/lib/mtc/charge', () => ({ refundOnFail: (...a: unknown[]) => refundOnFail(...a) }))
vi.mock('@/lib/zhangqian/run-discovery-job', () => ({ executeDiscoveryJob: vi.fn(), ZHANGQIAN_SERVICE_KEY: 'zhangqian_discover' }))

import { closeUnfinishedDiscoveryJob, parseDiscoveryEvent, shouldStartDiscoveryJob, zhangqianDiscovery } from '../zhangqian-discovery'
import { buildDiscoveryRequestedEvent } from '@/lib/zhangqian/discovery-events'

const data = parseDiscoveryEvent({ job_id: 'j1', client_id: 'c1', domain: 'a.com', semrush_db: 'nz', projected_mtc: 60 })!

describe('zhangqian discovery event', () => {
  it('builds one idempotent event per job', () => {
    const e = buildDiscoveryRequestedEvent({ job_id: 'j1', client_id: 'c1', domain: 'a.com', semrush_db: 'nz', projected_mtc: 60 }, 'now')
    expect(e.id).toBe('zhangqian_discovery:j1')
    expect(e.name).toBe('zhangqian.discovery.requested')
    expect(e.data.auth_basis).toBe('human_click')
  })
  it('rejects a malformed payload', () => {
    expect(parseDiscoveryEvent({ job_id: 'j1' })).toBeNull()
    expect(parseDiscoveryEvent(null)).toBeNull()
  })
})

describe('closeUnfinishedDiscoveryJob', () => {
  beforeEach(() => { getJob.mockReset(); failJob.mockReset(); refundOnFail.mockReset() })

  it('fails the job and refunds when the run never finished', async () => {
    getJob.mockResolvedValue({ status: 'running' })
    expect(await closeUnfinishedDiscoveryJob(data, 'boom')).toBe('closed')
    expect(failJob).toHaveBeenCalledOnce()
    expect(refundOnFail).toHaveBeenCalledWith('c1', 'zhangqian_discover', 60, expect.anything())
  })
  it('does nothing when the job already ended', async () => {
    getJob.mockResolvedValue({ status: 'completed' })
    expect(await closeUnfinishedDiscoveryJob(data, 'boom')).toBe('already_terminal')
    expect(failJob).not.toHaveBeenCalled()
    expect(refundOnFail).not.toHaveBeenCalled()
  })
  it('does not refund admin runs (projected_mtc 0)', async () => {
    getJob.mockResolvedValue({ status: 'pending' })
    await closeUnfinishedDiscoveryJob({ ...data, projected_mtc: 0 }, 'boom')
    expect(refundOnFail).not.toHaveBeenCalled()
  })
  it('never retries the paid run, and is registered with a failure handler', () => {
    const opts = (zhangqianDiscovery as unknown as { opts: { retries: number; onFailure: unknown } }).opts
    expect(opts.retries).toBe(0)
    expect(typeof opts.onFailure).toBe('function')
  })
})

describe('shouldStartDiscoveryJob', () => {
  beforeEach(() => getJob.mockReset())
  it('starts only a job that is still pending', async () => {
    getJob.mockResolvedValue({ status: 'pending' })
    expect(await shouldStartDiscoveryJob('j1')).toBe(true)
  })
  it.each(['failed', 'running', 'completed'])('skips a %s job', async (status) => {
    getJob.mockResolvedValue({ status })
    expect(await shouldStartDiscoveryJob('j1')).toBe(false)
  })
  it('skips when the job row is gone', async () => {
    getJob.mockResolvedValue(null)
    expect(await shouldStartDiscoveryJob('j1')).toBe(false)
  })
})
