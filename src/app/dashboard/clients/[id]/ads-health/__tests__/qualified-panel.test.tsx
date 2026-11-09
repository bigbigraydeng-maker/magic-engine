/**
 * 「近 30 天带来的客人质量」面板（修复方案第 1 刀 ③）。只读显示：
 *  - 没设置 / 算出错 / 还没有：分开写；
 *  - 合格数拆「人 / 系统 / AI / 来源认不出」，只列不为 0 的；
 *  - 停投组照样列；跟进只认 ME 里的记录，要写明。
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import QualifiedPanel, { qualifiedCell } from '../qualified-panel'
import type { QualifiedBlock, QualifiedRow } from '@/lib/ads-strategy/portfolio/qualified-leads'

afterEach(() => cleanup())

const row = (over: Partial<QualifiedRow>): QualifiedRow => ({
  id: '120240000950307', name: '组A', level: 'adset', stoppedLast7d: false, leads: 61,
  qualified: { total: 5, human: 2, system: 3, ai: 0, unknown: 0 }, followedNotQualified: 0, noFollowup: 43, observing: 13, ...over,
})
const block = (over: Partial<QualifiedBlock> = {}): QualifiedBlock => ({
  window: { start: '2026-10-04', end: '2026-11-02' }, observeDays: 14, configured: true, staleStageKeys: [],
  rows: [row({}), row({ id: '120248220094190307', name: null, stoppedLast7d: true, leads: 27, qualified: { total: 4, human: 4, system: 0, ai: 0, unknown: 0 }, noFollowup: 21, observing: 2 })],
  unattributedQualified: 18, ...over,
})

describe('qualifiedCell', () => {
  it('只列不为 0 的来源；0 个就写 0', () => {
    expect(qualifiedCell({ total: 5, human: 2, system: 3, ai: 0, unknown: 0 })).toBe('5（人 2 · 系统 3）')
    expect(qualifiedCell({ total: 3, human: 0, system: 0, ai: 1, unknown: 2 })).toBe('3（AI 1 · 来源认不出 2）')
    expect(qualifiedCell({ total: 0, human: 0, system: 0, ai: 0, unknown: 0 })).toBe('0')
  })
})

describe('面板', () => {
  it('每组一行；没名字的写「未命名组 …尾号」；停投的标出来', () => {
    const { container } = render(<QualifiedPanel block={block()} />)
    const rows = [...container.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent))
    expect(rows[0]).toEqual(['组A', '61', '5（人 2 · 系统 3）', '0', '43', '13'])
    expect(rows[1]).toEqual(['未命名组 …190307近 7 天已停投', '27', '4（人 4）', '0', '21', '2'])
    expect(screen.getByText('另有 18 个合格客人不是由广告组带来的（官网、邮件、WhatsApp 等，或来源没记下），不在表里。')).toBeTruthy()
    expect(screen.getByText('ME 里没跟进记录')).toBeTruthy()
    expect(screen.getByText(/在 ME 外面打的电话、发的消息看不到/)).toBeTruthy()
  })

  it('不在今天快照里的组写「投放状态不明」，不冒充停投', () => {
    const { container } = render(<QualifiedPanel block={block({ rows: [row({ name: '组Z', stoppedLast7d: null })] })} />)
    expect(container.querySelector('tbody td')!.textContent).toBe('组Z不在今天的广告快照里，投放状态不明')
  })

  it('还没设置哪些阶段算合格 → 说去哪设置，不画表', () => {
    const { container } = render(<QualifiedPanel block={block({ configured: false })} />)
    expect(screen.getByText(/还没设置哪些客人阶段算「合格」/)).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
  })

  it('算出错 → 写原因；老行没有这一块 → 什么都不画', () => {
    render(<QualifiedPanel block={{ error: '数据库还没加「合格阶段」这一列' }} />)
    expect(screen.getByText('合格客人这一块今天没算出来（数据库还没加「合格阶段」这一列），其余不受影响。')).toBeTruthy()
    cleanup()
    const { container } = render(<QualifiedPanel block={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('登记的阶段客户已经删了 → 提示一句', () => {
    render(<QualifiedPanel block={block({ staleStageKeys: ['old'] })} />)
    expect(screen.getByText('设置里有 1 个阶段已经不在客户的阶段表里，没算进去。')).toBeTruthy()
  })
})
