import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitRender, getRender } from './render'

const mockCreatomateFetch = vi.fn()
vi.mock('./client', () => ({ creatomateFetch: (...args: unknown[]) => mockCreatomateFetch(...args) }))

beforeEach(() => mockCreatomateFetch.mockReset())

describe('submitRender / getRender — 解析真实 render 对象形状', () => {
  it('提交后从响应体解出 renderId', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-abc', status: 'planned' })
    const { renderId } = await submitRender({ templateId: 'tmpl-1', modifications: {} })
    expect(renderId).toBe('render-abc')
    expect(mockCreatomateFetch).toHaveBeenCalledWith('/renders', {
      method: 'POST',
      body: { template_id: 'tmpl-1', modifications: {} },
    })
  })

  it('带 webhookUrl 时原样透传', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-abc', status: 'planned' })
    await submitRender({ templateId: 'tmpl-1', modifications: {}, webhookUrl: 'https://x/webhook' })
    expect(mockCreatomateFetch).toHaveBeenCalledWith('/renders', {
      method: 'POST',
      body: { template_id: 'tmpl-1', modifications: {}, webhook_url: 'https://x/webhook' },
    })
  })

  it('getRender 解析 succeeded 状态 + url', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-abc', status: 'succeeded', url: 'https://cdn.creatomate.com/x.mp4' })
    const r = await getRender('render-abc')
    expect(r).toEqual({ id: 'render-abc', status: 'succeeded', url: 'https://cdn.creatomate.com/x.mp4', errorMessage: undefined })
  })

  it('响应缺 id/status 或 status 不在合法枚举里 → 明确报错，不悄悄当成某个默认状态', async () => {
    mockCreatomateFetch.mockResolvedValueOnce({ status: 'succeeded' }) // 缺 id
    await expect(getRender('render-x')).rejects.toThrow(/render 对象形状|id\/status/)

    mockCreatomateFetch.mockResolvedValueOnce({ id: 'render-x', status: 'not_a_real_status' })
    await expect(getRender('render-x')).rejects.toThrow(/id\/status/)
  })
})
