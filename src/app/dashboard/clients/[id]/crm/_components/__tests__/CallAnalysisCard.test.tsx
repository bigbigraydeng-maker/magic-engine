import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CallAnalysisCard, quoteLabel, splitAroundQuote, syncWarning, type CallAnalysisData } from '../CallAnalysisCard'

const analysis: CallAnalysisData = {
  id: 'an-1',
  summary: '客人咨询明年摄影定制行程。',
  reviewStatus: 'pending_review',
  facts: [
    { key: 'destination_or_tour', value: '摄影主题的中国定制行程', quote: 'I think you mentioned about Chengdu and Chongqing.', speaker: 'employee' },
    { key: 'travel_window', value: '明年，约一个月', quote: 'So the whole trip is about a month.', speaker: 'customer' },
    { key: 'budget', value: '未提', quote: 'no speaker recorded here' },
  ],
}

afterEach(() => vi.restoreAllMocks())

describe('quoteLabel', () => {
  it('names the speaker and never calls an employee a customer', () => {
    expect(quoteLabel('employee')).toBe('员工原话')
    expect(quoteLabel('customer')).toBe('客人原话')
    expect(quoteLabel(undefined)).toBe('原话')
  })
})

describe('splitAroundQuote', () => {
  it('finds the quote even when it ends with an ellipsis (the stored quote is cut short)', () => {
    const text = 'A: hi. Let me organize some ideas and send you something. B: ok'
    expect(splitAroundQuote(text, 'Let me organize some ideas and...')).toEqual(['A: hi. ', 'Let me organize some ideas and', ' send you something. B: ok'])
  })
  it('returns null when the quote is not in the text or too short to be reliable', () => {
    expect(splitAroundQuote('hello world', 'not there at all')).toBeNull()
    expect(splitAroundQuote('hello world', 'hi')).toBeNull()
  })
})

describe('CallAnalysisCard', () => {
  it('labels each quote by who said it', () => {
    render(<CallAnalysisCard clientId="cts" analysis={analysis} />)
    expect(screen.getAllByText(/员工原话/).length).toBe(1)
    expect(screen.getAllByText(/客人原话/).length).toBe(1)
    expect(screen.getByText(/^原话：“no speaker/)).toBeTruthy()
  })

  it('loads and shows the full transcript on demand, highlighting the quote', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'Staff: hello. So the whole trip is about a month. Customer: yes' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CallAnalysisCard clientId="cts" analysis={analysis} />)
    fireEvent.click(screen.getAllByText('看这句的前后文')[1])
    await waitFor(() => expect(screen.getByTestId('call-transcript').textContent).toContain('Customer: yes'))
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/cts/crm/call-analyses/an-1/transcript')
    expect(document.querySelector('mark')?.textContent).toBe('So the whole trip is about a month.')
  })

  it('says so plainly when the transcript cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '这通电话没有文字稿' }) }))
    render(<CallAnalysisCard clientId="cts" analysis={analysis} />)
    fireEvent.click(screen.getByText('看完整通话文字'))
    await waitFor(() => expect(screen.getByText('这通电话没有文字稿')).toBeTruthy())
  })
})

describe('复核后名单没同步上的提醒', () => {
  it('syncWarning：只在 conflict / failed 时出一句话', () => {
    expect(syncWarning('rejected', { reviewStatus: 'rejected', touchpointSync: 'conflict' })).toBe('已驳回，但名单那边没同步上，稍后刷新再看')
    expect(syncWarning('rejected', { reviewStatus: 'rejected', touchpointSync: 'failed' })).toBe('已驳回，但名单那边没同步上，稍后刷新再看')
    expect(syncWarning('rejected', { reviewStatus: 'rejected' })).toBeNull()
    expect(syncWarning('rejected', null)).toBeNull()
  })

  it('点驳回、接口说没同步上 → 卡片显示提醒，状态仍是已驳回', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reviewStatus: 'rejected', touchpointSync: 'failed' }) }))
    render(<CallAnalysisCard clientId="cts" analysis={analysis} />)
    fireEvent.click(screen.getByText('驳回'))
    await waitFor(() => expect(screen.getByText('已驳回，但名单那边没同步上，稍后刷新再看')).toBeTruthy())
    expect(screen.getByText(/通话分析 · 已驳回/)).toBeTruthy()
  })

  it('同步正常 → 不显示提醒', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reviewStatus: 'rejected' }) }))
    render(<CallAnalysisCard clientId="cts" analysis={analysis} />)
    fireEvent.click(screen.getByText('驳回'))
    await waitFor(() => expect(screen.getByText(/通话分析 · 已驳回/)).toBeTruthy())
    expect(screen.queryByText(/名单那边没同步上/)).toBeNull()
  })
})
