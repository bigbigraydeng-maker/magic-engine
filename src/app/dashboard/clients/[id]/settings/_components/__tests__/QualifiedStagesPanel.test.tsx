/**
 * 「哪些客人阶段算合格客人」设置（修复方案第 1 刀 ③）。
 * 盯：按客户自己的阶段逐个勾（不按排序号切）；读失败不给改；保存只送勾的阶段；没开广告健康监测时说清楚。
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QualifiedStagesPanel } from '../QualifiedStagesPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const STAGES = [{ key: 'new', label: '新线索' }, { key: 'quoted', label: '已报价' }, { key: 'no_response', label: '无下文' }]
const resp = (over: Record<string, unknown> = {}) => ({ success: true, source: 'row', stages: STAGES, selected: ['quoted'], updatedBy: null, updatedAt: null, ...over })

function stubFetch(get: unknown, patch?: { status: number; body: unknown }) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return { ok: (patch?.status ?? 200) < 400, status: patch?.status ?? 200, json: async () => patch?.body ?? {} } as Response
    return { ok: true, status: 200, json: async () => get } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('QualifiedStagesPanel', () => {
  it('每个阶段一个勾选框，已勾的勾上；没改时保存按钮不能点', async () => {
    stubFetch(resp())
    render(<QualifiedStagesPanel clientId="c1" />)
    const quoted = await screen.findByLabelText('已报价') as HTMLInputElement
    expect(quoted.checked).toBe(true)
    expect((screen.getByLabelText('无下文') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(true)
  })

  it('勾「无下文」再保存 → 只送勾上的阶段', async () => {
    const fn = stubFetch(resp(), { status: 200, body: resp({ selected: ['quoted', 'no_response'] }) })
    render(<QualifiedStagesPanel clientId="c1" />)
    await userEvent.click(await screen.findByLabelText('无下文'))
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('已保存。')).toBeTruthy())
    const patchCall = fn.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ qualified_stage_keys: ['quoted', 'no_response'] })
  })

  it('客户还没开广告健康监测（409）→ 说清楚，勾的不丢', async () => {
    stubFetch(resp(), { status: 409, body: { error: 'x' } })
    render(<QualifiedStagesPanel clientId="c1" />)
    await userEvent.click(await screen.findByLabelText('新线索'))
    await userEvent.click(screen.getByText('保存'))
    expect(await screen.findByText('这个客户还没开「广告健康监测」，先开了再设置合格阶段。')).toBeTruthy()
    expect((screen.getByLabelText('新线索') as HTMLInputElement).checked).toBe(true)
  })

  it('读不到原来的设置 → 不给勾、不给保存', async () => {
    stubFetch(resp({ source: 'read_error', selected: [] }))
    render(<QualifiedStagesPanel clientId="c1" />)
    expect(await screen.findByText('读不到原来的设置，先不让改，免得盖掉没看见的旧值。')).toBeTruthy()
    expect(screen.queryByText('保存')).toBeNull()
    expect(screen.queryByLabelText('已报价')).toBeNull()
  })
})
