import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const requirePaidClientAccess = vi.fn()
const loadReviewCalls = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => requirePaidClientAccess(...a),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/telephony/review-calls', () => ({
  loadReviewCalls: (...a: unknown[]) => loadReviewCalls(...a),
}))

import PhoneReviewPage from '../page'

async function renderPage() {
  render(await PhoneReviewPage({ params: { id: 'cts' } }))
}

beforeEach(() => {
  requirePaidClientAccess.mockReset()
  loadReviewCalls.mockReset()
})

describe('待确认电话页', () => {
  it('🔴 免费自助档 / 不在这个客户名下 → 提示没有权限，根本不去取数', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: false, status: 403, reason: 'paid_only' })
    await renderPage()
    expect(screen.getByText('你的账号没有查看这一页的权限。')).toBeInTheDocument()
    expect(loadReviewCalls).not.toHaveBeenCalled()
    expect(requirePaidClientAccess).toHaveBeenCalledWith('cts')
  })

  it('🔴 读数据失败 → 说「暂时打不开」，不能说「现在没有待确认的电话」', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: true })
    loadReviewCalls.mockRejectedValue(new Error('db down'))
    await renderPage()
    expect(screen.getByText(/暂时打不开/)).toBeInTheDocument()
    expect(screen.queryByText('现在没有待确认的电话。')).toBeNull()
  })

  it('真没有待确认的 → 才说没有', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: true })
    loadReviewCalls.mockResolvedValue({ calls: [], total: 0 })
    await renderPage()
    expect(screen.getByText('现在没有待确认的电话。')).toBeInTheDocument()
  })

  it('有待确认的 → 列出时间、方向、尾号、原因；完整号码不出现；老实说「已处理」按钮还没上线', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: true })
    loadReviewCalls.mockResolvedValue({
      total: 3,
      calls: [
        {
          id: 'k1', startedAt: '2026-10-12T01:00:00Z', direction: 'inbound', numberTail: '528',
          answered: true, talkSeconds: 29, status: 'needs_review', reason: '补处理多次仍没写进客户记录，需人工确认',
        },
      ],
    })
    await renderPage()
    expect(screen.getByText('尾号 528')).toBeInTheDocument()
    expect(screen.getByText('客人打进来')).toBeInTheDocument()
    expect(screen.getByText('接通，聊了 29 秒')).toBeInTheDocument()
    expect(screen.getByText(/补处理多次仍没写进客户记录/)).toBeInTheDocument()
    expect(screen.getByText(/共 3 通待确认（下面只列最近 1 通）/)).toBeInTheDocument()
    expect(screen.getByText(/「已处理」按钮还没上线/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\+64|录音|摘要/)
  })
})
