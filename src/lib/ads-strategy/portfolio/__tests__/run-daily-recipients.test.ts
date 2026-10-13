/**
 * 每日只读诊断 · 接线：回拉已经读到的收件人必须传给诊断加载器。
 * 不传的话加载器会自己再读一遍广告设置，那次多余的重读一失败，当天诊断和自动暂停事件就整段丢了。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadDiagnosisInput: vi.fn(),
  runDiagnostics: vi.fn(),
  buildDigestGoalContext: vi.fn(),
  persistAndSendInternalDigest: vi.fn(),
}))

vi.mock('../diagnostics/loader', () => ({ loadDiagnosisInput: mocks.loadDiagnosisInput }))
vi.mock('../diagnostics/run', () => ({ runDiagnostics: mocks.runDiagnostics }))
vi.mock('../goal-context', () => ({ buildDigestGoalContext: mocks.buildDigestGoalContext }))
vi.mock('../internal-digest', () => ({ persistAndSendInternalDigest: mocks.persistAndSendInternalDigest }))

import { runPortfolioDiagnostics } from '../run-daily'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadDiagnosisInput.mockResolvedValue({ clientId: 'client-1', digestRecipients: ['a@x.com'], accounts: [] })
  mocks.runDiagnostics.mockReturnValue({ diagnoses: [], excluded: [] })
  mocks.buildDigestGoalContext.mockResolvedValue(null)
  mocks.persistAndSendInternalDigest.mockResolvedValue({ decision: 'skip', sent: false, recipients_dropped: 0 })
})

describe('runPortfolioDiagnostics — 收件人传给加载器', () => {
  it('把调用方已读到的收件人作为第 4 个参数传进去（加载器不再重读广告设置）', async () => {
    const result = await runPortfolioDiagnostics('client-1', 'Client', '2026-09-21', ['a@x.com'])

    expect(result.success).toBe(true)
    expect(mocks.loadDiagnosisInput).toHaveBeenCalledTimes(1)
    const args = mocks.loadDiagnosisInput.mock.calls[0]
    expect(args[0]).toBe('client-1')
    expect(args[1]).toBe('2026-09-21')
    expect(args[3]).toEqual({ digestRecipients: ['a@x.com'] })
  })

  it('加载器抛错 → 不抛，返回失败并带原因', async () => {
    mocks.loadDiagnosisInput.mockRejectedValue(new Error('snapshot read failed'))
    const result = await runPortfolioDiagnostics('client-1', 'Client', '2026-09-21', [])
    expect(result).toMatchObject({ success: false, error: 'snapshot read failed' })
  })
})
