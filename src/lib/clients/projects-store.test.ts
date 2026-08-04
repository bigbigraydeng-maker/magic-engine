import { describe, it, expect } from 'vitest'
import { normaliseProjectInput, isProjectStatus, PROJECT_STATUSES, PROJECT_STATUS_LABEL } from './projects-store'

const ok = (body: unknown) => {
  const r = normaliseProjectInput(body)
  if (!r.ok) throw new Error(`预期通过，实际被拒：${r.error}`)
  return r.value
}
const err = (body: unknown) => {
  const r = normaliseProjectInput(body)
  if (r.ok) throw new Error('预期被拒，实际通过了')
  return r.error
}

describe('normaliseProjectInput —— 名字', () => {
  it('前后空格去掉', () => {
    expect(ok({ name: '  30 Kiteroa  ' }).name).toBe('30 Kiteroa')
  })

  it('🔴 空名字判非法，不静默存空串 —— 素材归属/开票/报告标题全靠它', () => {
    expect(err({ name: '' })).toContain('不能为空')
    expect(err({ name: '   ' })).toContain('不能为空')
    expect(err({ name: 123 })).toContain('不能为空')
  })

  it('超长名字判非法', () => {
    expect(err({ name: 'x'.repeat(121) })).toContain('过长')
  })

  it('不传名字是允许的（改状态时不必重发名字）', () => {
    expect(ok({ status: 'paused' }).name).toBeUndefined()
  })
})

describe('normaliseProjectInput —— 状态', () => {
  it('合法状态原样通过', () => {
    for (const s of PROJECT_STATUSES) expect(ok({ status: s }).status).toBe(s)
  })

  it('未知状态判非法，不降级不吞掉', () => {
    expect(err({ status: 'sold_out' })).toContain('未知')
    expect(err({ status: 42 })).toContain('未知')
  })

  it('每个状态都有中文说法，界面不会漏字', () => {
    for (const s of PROJECT_STATUSES) expect(PROJECT_STATUS_LABEL[s]).toBeTruthy()
  })
})

describe('normaliseProjectInput —— 开票信息', () => {
  it('留空存 null，不存空字符串（建档时通常还没谈定对接人）', () => {
    const v = ok({ invoice_to_name: '   ', invoice_to_email: '' })
    expect(v.invoice_to_name).toBeNull()
    expect(v.invoice_to_email).toBeNull()
  })

  it('填了就去空格保留', () => {
    expect(ok({ invoice_to_name: ' Kiteroa Developments Ltd ' }).invoice_to_name)
      .toBe('Kiteroa Developments Ltd')
  })

  it('没传的字段不出现在结果里 —— 免得把没改的字段覆盖成 null', () => {
    const v = ok({ name: 'A' })
    expect('invoice_to_name' in v).toBe(false)
    expect('invoice_to_email' in v).toBe(false)
  })
})

describe('normaliseProjectInput —— 兜底', () => {
  it('非对象请求被拒', () => {
    expect(err(null)).toBeTruthy()
    expect(err('楼盘')).toBeTruthy()
    expect(err(undefined)).toBeTruthy()
  })

  it('空对象通过（等于什么都不改）', () => {
    expect(ok({})).toEqual({})
  })

  it('归属字段传了也不会被写进去 —— 楼盘不能改挂到别的中介名下', () => {
    const v = ok({ name: 'A', client_id: 'other-agent', id: 'forged' }) as Record<string, unknown>
    expect(v.client_id).toBeUndefined()
    expect(v.id).toBeUndefined()
  })
})

describe('isProjectStatus', () => {
  it('认得出合法值', () => {
    expect(isProjectStatus('active')).toBe(true)
    expect(isProjectStatus('archived')).toBe(true)
  })
  it('认得出非法值', () => {
    expect(isProjectStatus('ACTIVE')).toBe(false)
    expect(isProjectStatus(null)).toBe(false)
  })
})
