/**
 * 页面的服务端闸：非内部账号、非旅游客户都进不去。
 * 接口各有自己的守卫，这里盯的是「直接敲网址」——去掉任何一道闸，对应用例变红。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: vi.fn() }))
vi.mock('@/lib/clients/industry-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clients/industry-guard')>('@/lib/clients/industry-guard')
  return { ...actual, clientHasIndustryFeature: vi.fn() }
})
vi.mock('../_components/BusinessCalculatorClient', () => ({
  BusinessCalculatorClient: () => null,
}))

import BusinessCalculatorPage from '../page'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { BusinessCalculatorClient } from '../_components/BusinessCalculatorClient'

const mockAccess = vi.mocked(requirePlanApproverAccess)
const mockFeature = vi.mocked(clientHasIndustryFeature)

/** 把渲染树里所有文字和组件类型摊平，方便断言「出现了什么」。 */
function flatten(node: ReactNode, out: { text: string[]; types: unknown[] }): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    node.forEach(child => flatten(child, out))
    return
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode; text?: unknown }>
    out.types.push(el.type)
    if (typeof el.props.text === 'string') out.text.push(el.props.text) // 页面里的 Notice 用 text 属性传文字
    flatten(el.props.children, out)
  }
}

async function render(): Promise<{ text: string; types: unknown[] }> {
  const tree = await BusinessCalculatorPage({ params: { id: 'c1' } })
  const out = { text: [] as string[], types: [] as unknown[] }
  flatten(tree, out)
  return { text: out.text.join(' '), types: out.types }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('经营测算页的服务端闸', () => {
  it('客户员工（403）→ 只说「只对公司内部账号开放」，不渲染计算器', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'x' } as never)
    const { text, types } = await render()
    expect(text).toContain('只对公司内部账号开放')
    expect(types).not.toContain(BusinessCalculatorClient)
    expect(mockFeature).not.toHaveBeenCalled()
  })

  it('其它鉴权失败（401/500）→ 「页面暂时打不开」，不渲染计算器', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 500, error: 'x' } as never)
    const { text, types } = await render()
    expect(text).toContain('页面暂时打不开')
    expect(types).not.toContain(BusinessCalculatorClient)
  })

  it('内部账号但不是旅游客户 → 说不适用，不渲染计算器', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: 'a@b' } } as never)
    mockFeature.mockResolvedValue(false)
    const { text, types } = await render()
    expect(text).toContain('不适用')
    expect(types).not.toContain(BusinessCalculatorClient)
  })

  it('内部账号 + 旅游客户 → 渲染计算器', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: 'a@b' } } as never)
    mockFeature.mockResolvedValue(true)
    const { types } = await render()
    expect(types).toContain(BusinessCalculatorClient)
  })
})
