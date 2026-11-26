import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeApprovalList } from '../CreativeApprovalList'

type Entry = { kind: string; ref: string; status: string; approved_by?: string; promo_window?: unknown }

const BASE = '/api/clients/c1/ad-strategy-config'

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 一个会记账的假 fetch：池子数据可变，approve 之后状态翻成 approved。 */
function setup(entries: Entry[], overrides: { approve?: () => Response; promo?: () => Response } = {}) {
  let pool = entries.map(e => ({ ...e }))
  const calls: { url: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { ref: string; promo_window?: unknown }
      calls.push({ url: u, body })
      if (u.endsWith('/promo-window')) {
        if (overrides.promo) return overrides.promo()
        pool = pool.map(e => (e.ref === body.ref ? { ...e, promo_window: body.promo_window } : e))
        return res({ success: true })
      }
      if (u.endsWith('/approve')) {
        if (overrides.approve) return overrides.approve()
        pool = pool.map(e => (e.ref === body.ref ? { ...e, status: 'approved', approved_by: 'pm@example.com' } : e))
        return res({ success: true })
      }
    }
    if (u.endsWith('/creative-pool/labels')) return res({ labels: { v1: { title: '上海团 18 秒' } } })
    if (u === BASE) return res({ config: { creative_pool: pool } })
    return res({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

beforeEach(() => { window.confirm = vi.fn(() => true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const mountList = (props: Partial<Parameters<typeof CreativeApprovalList>[0]> = {}) => {
  const onChanged = vi.fn()
  render(<CreativeApprovalList clientId="c1" refs={['v1']} canAct onChanged={onChanged} {...props} />)
  return { onChanged }
}

describe('CreativeApprovalList：推广计划页里直接批准素材', () => {
  it('列出本计划用到的素材：名字、状态、推广期', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }, { kind: 'meta_video', ref: 'v2', status: 'approved', approved_by: 'pm@example.com', promo_window: { kind: 'evergreen' } }])
    mountList({ refs: ['v1', 'v2'] })
    expect(await screen.findByText(/上海团 18 秒（v1）/)).toBeTruthy()
    expect(screen.getByText('待批准')).toBeTruthy()
    expect(screen.getByText('推广期：还没声明')).toBeTruthy()
    expect(screen.getByText('已批准（pm@example.com）')).toBeTruthy()
    expect(screen.getByText('推广期：长期有效')).toBeTruthy()
  })

  it('读不到素材清单时直说，不猜', () => {
    setup([])
    mountList({ refs: null })
    expect(screen.getByText(/读不到素材清单/)).toBeTruthy()
  })

  it('素材不在池子里：说清楚，没有批准按钮', async () => {
    setup([])
    mountList()
    expect(await screen.findByText(/不在素材池里/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
  })

  it('没声明推广期：批准按钮灰，旁边写「先选推广期」；选了「长期有效」才亮', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }])
    mountList()
    const btn = await screen.findByRole('button', { name: '批准' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('先选推广期')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/长期有效/))
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('选「有期限」：两个日期都填对才亮；结束早于开始仍是灰', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }])
    mountList()
    await screen.findByRole('button', { name: '批准' })
    fireEvent.click(screen.getByLabelText('有期限'))
    fireEvent.change(screen.getByLabelText('v1 推广期开始'), { target: { value: '2026-11-30' } })
    fireEvent.change(screen.getByLabelText('v1 推广期结束'), { target: { value: '2026-11-05' } })
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('v1 推广期结束'), { target: { value: '2026-12-31' } })
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('点批准：先发推广期、再发批准（只带编号），成功后刷新上层清单', async () => {
    const { calls } = setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }])
    const { onChanged } = mountList()
    await screen.findByRole('button', { name: '批准' })
    fireEvent.click(screen.getByLabelText('有期限'))
    fireEvent.change(screen.getByLabelText('v1 推广期开始'), { target: { value: '2026-11-05' } })
    fireEvent.change(screen.getByLabelText('v1 推广期结束'), { target: { value: '2026-11-30' } })
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(calls.map(c => c.url)).toEqual([`${BASE}/creative-pool/promo-window`, `${BASE}/creative-pool/approve`])
    expect(calls[0].body).toEqual({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-05', end: '2026-11-30' } })
    expect(calls[1].body).toEqual({ ref: 'v1' })
    expect(await screen.findByText(/已批准（pm@example.com）/)).toBeTruthy()
  })

  it('推广期已经声明过：直接能批准，只发批准一个请求', async () => {
    const { calls } = setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }])
    const { onChanged } = mountList()
    const btn = await screen.findByRole('button', { name: '批准' })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(calls.map(c => c.url)).toEqual([`${BASE}/creative-pool/approve`])
  })

  it('点了确认框的「取消」：什么请求都不发', async () => {
    window.confirm = vi.fn(() => false)
    const { calls } = setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }])
    const { onChanged } = mountList()
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(calls).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('接口拒绝时原话显示出来，不假装成功', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }], {
      approve: () => res({ error: 'promo_window_expired', message: '这条素材的推广期已经过了，不能批准入池。' }, 422),
    })
    const { onChanged } = mountList()
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText('这条素材的推广期已经过了，不能批准入池。')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('推广期接口拒绝时，不会继续发批准', async () => {
    const { calls } = setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }], {
      promo: () => res({ error: 'promo_window_end_in_past' }, 422),
    })
    mountList()
    await screen.findByRole('button', { name: '批准' })
    fireEvent.click(screen.getByLabelText(/长期有效/))
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(await screen.findByText('promo_window_end_in_past')).toBeTruthy()
    expect(calls.map(c => c.url)).toEqual([`${BASE}/creative-pool/promo-window`])
  })

  it('当前账号没有批准权限（canAct=false）：按钮灰，说明谁能点，一个请求都不发', async () => {
    const { calls } = setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }])
    mountList({ canAct: false })
    const btn = await screen.findByRole('button', { name: '批准' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/需要 Magic Lab 内部账号/)).toBeTruthy()
    fireEvent.click(btn)
    expect(calls).toEqual([])
  })

  it('服务端回 403：显示原话，并把按钮灰掉', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }], {
      approve: () => res({ error: 'Forbidden' }, 403),
    })
    mountList()
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/需要 Magic Lab 内部账号/)).toBeTruthy()
  })

  it('自动流程状态的素材不能手动批准：只显示状态，没有按钮', async () => {
    setup([{ kind: 'meta_video', ref: 'v1', status: 'testing' }])
    mountList()
    expect(await screen.findByText('自动流程：测试中')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
  })

  it('素材池读不出来：写明原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'boom' }, 500)))
    mountList()
    expect(await screen.findByText(/素材池读不出来：boom/)).toBeTruthy()
  })
})
