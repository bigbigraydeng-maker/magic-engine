/**
 * 抽屉里的客人档案卡。钉死：读失败不渲染；名字可改（PATCH，带原因提示）；邮箱 / 电话可加；
 * 服务端拒绝时显示原因、不关编辑框；成功后用服务端返回的最新档案刷新。
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProfileCard } from '../ProfileCard'

const PROFILE = {
  contactId: 'p1',
  name: 'Brenda Girven',
  nicknames: [{ channel: 'whatsapp', name: 'Bren G' }],
  emails: [{ value: 'brendam@hotmail.co.nz', primary: true }],
  phones: [],
}

function stub(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const f = vi.fn()
  for (const r of responses) f.mockResolvedValueOnce({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body })
  vi.stubGlobal('fetch', f)
  return f
}
const draw = (onChanged = vi.fn()) => render(<ProfileCard clientId="c1" contactId="p1" onChanged={onChanged} />)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ProfileCard', () => {
  it('读失败 → 什么都不渲染', async () => {
    stub([{ ok: false, body: {} }])
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('显示名字、昵称（带渠道）、邮箱、电话；没有名字显示「未留姓名」', async () => {
    stub([{ ok: true, body: { profile: PROFILE } }])
    draw()
    expect(await screen.findByText('Brenda Girven')).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp：Bren G/)).toBeInTheDocument()
    expect(screen.getByText('brendam@hotmail.co.nz')).toBeInTheDocument()
    expect(screen.getByText('还没有')).toBeInTheDocument()
  })

  it('没有名字 → 「未留姓名」', async () => {
    stub([{ ok: true, body: { profile: { ...PROFILE, name: null } } }])
    draw()
    expect(await screen.findByText('未留姓名')).toBeInTheDocument()
  })

  it('改名字：PATCH 带 name，成功后用返回的档案刷新并通知外面', async () => {
    const onChanged = vi.fn()
    const f = stub([
      { ok: true, body: { profile: PROFILE } },
      { ok: true, body: { profile: { ...PROFILE, name: 'Brenda G.' } } },
    ])
    draw(onChanged)
    fireEvent.click(await screen.findByRole('button', { name: '改' }))
    fireEvent.change(screen.getByLabelText('客人名字'), { target: { value: 'Brenda G.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('Brenda G.')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
    const [url, init] = f.mock.calls[1]
    expect(url).toBe('/api/clients/c1/crm/contacts/p1/profile')
    expect((init as { method: string }).method).toBe('PATCH')
    expect(JSON.parse((init as { body: string }).body)).toEqual({ name: 'Brenda G.' })
  })

  it('服务端拒绝（比如填了邮箱当名字）→ 显示原因，编辑框不关', async () => {
    stub([
      { ok: true, body: { profile: PROFILE } },
      { ok: false, status: 400, body: { error: '名字不能是邮箱、电话或占位词' } },
    ])
    draw()
    fireEvent.click(await screen.findByRole('button', { name: '改' }))
    fireEvent.change(screen.getByLabelText('客人名字'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('名字不能是邮箱')
    expect(screen.getByLabelText('客人名字')).toBeInTheDocument()
  })

  it('加电话：POST identities 带 kind + value；成功后显示新号码', async () => {
    const f = stub([
      { ok: true, body: { profile: PROFILE } },
      { ok: true, body: { profile: { ...PROFILE, phones: [{ value: '+6421363598', primary: true }] }, added: true } },
    ])
    draw()
    fireEvent.click(await screen.findByRole('button', { name: '+ 加电话' }))
    fireEvent.change(screen.getByLabelText('新电话'), { target: { value: '021 363 598' } })
    fireEvent.click(screen.getByRole('button', { name: '加上' }))
    expect(await screen.findByText('+6421363598')).toBeInTheDocument()
    const [url, init] = f.mock.calls[1]
    expect(url).toBe('/api/clients/c1/crm/contacts/p1/profile/identities')
    expect(JSON.parse((init as { body: string }).body)).toEqual({ kind: 'phone', value: '021 363 598' })
  })

  it('加的邮箱已属于别的客人（409）→ 显示原因', async () => {
    stub([
      { ok: true, body: { profile: PROFILE } },
      { ok: false, status: 409, body: { error: '这个邮箱已经属于「Other Person」' } },
    ])
    draw()
    fireEvent.click(await screen.findByRole('button', { name: '+ 加邮箱' }))
    fireEvent.change(screen.getByLabelText('新邮箱'), { target: { value: 'other@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: '加上' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Other Person')
  })
})
