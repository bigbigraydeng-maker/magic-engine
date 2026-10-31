// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CallButton } from '../CallButton'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubFetch(handler: (url: string) => { ok: boolean; body: unknown }) {
  const f = vi.fn(async (url: string) => {
    const r = handler(url)
    return { ok: r.ok, json: async () => r.body }
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('CallButton 员工没登记手机', () => {
  it('🔴 服务端说手机没登记 → 就地出现填号码框；普通失败不出现', async () => {
    stubFetch(() => ({ ok: false, body: { error: '你的手机号还没登记', code: 'staff_phone_missing' } }))
    render(<CallButton clientId="c1" contactId="p1" />)
    fireEvent.click(screen.getByText(/用 CTS 号码拨打/))
    await waitFor(() => screen.getByTestId('staff-phone-form'))
    cleanup()
    stubFetch(() => ({ ok: false, body: { error: '这位客人说过别再联系，不能拨打' } }))
    render(<CallButton clientId="c1" contactId="p1" />)
    fireEvent.click(screen.getByText(/用 CTS 号码拨打/))
    await waitFor(() => screen.getByText(/别再联系/))
    expect(screen.queryByTestId('staff-phone-form')).toBeNull()
  })

  it('填号码 → 发到登记接口 → 成功后框收起并提示可以拨了', async () => {
    const f = stubFetch((url) =>
      url.endsWith('/my-phone') ? { ok: true, body: { ok: true } } : { ok: false, body: { error: 'x', code: 'staff_phone_missing' } },
    )
    render(<CallButton clientId="c1" contactId="p1" />)
    fireEvent.click(screen.getByText(/用 CTS 号码拨打/))
    const input = await waitFor(() => screen.getByLabelText('你接电话的手机号'))
    expect((screen.getByText('登记我的手机') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '021 234 5678' } })
    fireEvent.click(screen.getByText('登记我的手机'))
    await waitFor(() => screen.getByText(/手机号已登记/))
    expect(screen.queryByTestId('staff-phone-form')).toBeNull()
    const last = f.mock.calls[f.mock.calls.length - 1] as unknown as [string, { body: string }]
    expect(last[0]).toBe('/api/clients/c1/crm/my-phone')
    expect(JSON.parse(last[1].body)).toEqual({ phone: '021 234 5678' })
  })

  it('登记被拒（比如号码属于同事）→ 显示原因，框还在', async () => {
    stubFetch((url) =>
      url.endsWith('/my-phone')
        ? { ok: false, body: { error: '这个号码已经登记给别的同事了' } }
        : { ok: false, body: { error: 'x', code: 'staff_phone_missing' } },
    )
    render(<CallButton clientId="c1" contactId="p1" />)
    fireEvent.click(screen.getByText(/用 CTS 号码拨打/))
    const input = await waitFor(() => screen.getByLabelText('你接电话的手机号'))
    fireEvent.change(input, { target: { value: '0277520888' } })
    fireEvent.click(screen.getByText('登记我的手机'))
    await waitFor(() => screen.getByText(/登记给别的同事/))
    expect(screen.getByTestId('staff-phone-form')).toBeTruthy()
  })
})
