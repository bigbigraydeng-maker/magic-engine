/**
 * 新建 / 修改一个邮件模板的表单。
 *
 * 钉死的事：
 *  · 新建 POST（带模板标识、默认停用、不带 baseVersion）；修改 PUT（地址里是标识，带 baseVersion，不带 templateKey）
 *  · 不用目录时选团方式被锁成「不选团」；适用范围只带非空的项
 *  · 占位符按钮插进最近点过的框；400 列出所有问题；409 让人重新载入；保存失败不丢表单
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TemplateEditor } from '../TemplateEditor'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'

const variables = { common: ['first_name', 'sender_name'], bySource: { none: [], published_tours: ['tour_name', 'tour_url'] } }

const existing: EmailTemplateVersion = {
  id: 'row-3',
  clientId: 'c1',
  templateKey: 'post-call',
  version: 3,
  name: 'Post call',
  subject: 'About {{tour_name}}',
  body: 'Kia ora {{first_name}}',
  factSource: 'published_tours',
  pickMode: 'one',
  pickFilter: { destinations: ['china'], departureMonths: [3, 5] },
  status: 'active',
  changeNote: null,
  createdBy: 'lisa@cts.example',
  createdAt: '2026-10-01T00:00:00Z',
}

function stub(status: number, body: unknown) {
  const f = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

const sentBody = (f: ReturnType<typeof vi.fn>): Record<string, unknown> => JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>
const sentUrl = (f: ReturnType<typeof vi.fn>): string => (f.mock.calls[0] as [string])[0]
const sentMethod = (f: ReturnType<typeof vi.fn>): string => (f.mock.calls[0] as [string, RequestInit])[1].method as string

function draw(over: Partial<React.ComponentProps<typeof TemplateEditor>> = {}) {
  const props = { onSaved: vi.fn(), onCancel: vi.fn(), onReload: vi.fn() }
  render(<TemplateEditor clientId="c1" initial={null} variables={variables} {...props} {...over} />)
  return props
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a new template', () => {
  it('suggests a key from the name until the person types one', () => {
    draw()
    type('模板名称', 'Spring Follow-up 2027!')
    expect((screen.getByLabelText('模板标识') as HTMLInputElement).value).toBe('spring-follow-up-2027')
    type('模板标识', 'my-own-key')
    type('模板名称', 'Another name')
    expect((screen.getByLabelText('模板标识') as HTMLInputElement).value).toBe('my-own-key')
  })

  it('is saved as a disabled version 1 candidate: POST with the key, no base version, no client id', async () => {
    const f = stub(201, { template: { ...existing, version: 1 }, notices: ['提醒：x'] })
    const { onSaved } = draw()
    type('模板名称', 'Thank you')
    type('邮件主题', 'Thanks {{first_name}}')
    type('邮件正文', 'Hi {{first_name}}')
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(sentUrl(f)).toBe('/api/clients/c1/crm/email-templates')
    expect(sentMethod(f)).toBe('POST')
    expect(sentBody(f)).toEqual({
      templateKey: 'thank-you',
      name: 'Thank you',
      subject: 'Thanks {{first_name}}',
      body: 'Hi {{first_name}}',
      factSource: 'none',
      pickMode: 'none',
      pickFilter: {},
      status: 'disabled',
      changeNote: null,
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), ['提醒：x'])
  })

  it.each([
    ['an uppercase key', 'Bad Key'],
    ['a one-letter key', 'a'],
    ['a key starting with a hyphen', '-abc'],
  ])('cannot be saved with %s', (_name, key) => {
    draw()
    type('模板名称', 'Thanks')
    type('邮件主题', 'S')
    type('邮件正文', 'B')
    type('模板标识', key)
    expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled()
  })

  it('cannot be saved while the name, subject or body is blank', () => {
    draw()
    expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled()
    type('模板名称', 'Thanks')
    type('邮件主题', 'S')
    expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled()
    type('邮件正文', '   ')
    expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled()
    type('邮件正文', 'B')
    expect(screen.getByRole('button', { name: '保存模板' })).not.toBeDisabled()
  })
})

describe('using the tour catalog', () => {
  it('the pick mode is locked to "no pick" without a catalog, and the scope controls are hidden', () => {
    draw()
    expect(screen.getByLabelText('选团方式')).toBeDisabled()
    expect(screen.queryByLabelText('适用目的地')).toBeNull()
    fireEvent.change(screen.getByLabelText('内容来源'), { target: { value: 'published_tours' } })
    expect(screen.getByLabelText('选团方式')).not.toBeDisabled()
    expect(screen.getByLabelText('适用目的地')).toBeInTheDocument()
  })

  it('switching the catalog off again forces "no pick" and sends no scope', async () => {
    const f = stub(201, { template: existing, notices: [] })
    draw()
    type('模板名称', 'Thanks')
    type('邮件主题', 'S')
    type('邮件正文', 'B')
    fireEvent.change(screen.getByLabelText('内容来源'), { target: { value: 'published_tours' } })
    fireEvent.change(screen.getByLabelText('选团方式'), { target: { value: 'many' } })
    type('适用目的地', 'china')
    fireEvent.change(screen.getByLabelText('内容来源'), { target: { value: 'none' } })
    save()
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(sentBody(f)).toMatchObject({ factSource: 'none', pickMode: 'none' })
    expect(sentBody(f).pickFilter).toEqual({}) // toMatchObject would let a leftover scope through
  })

  it('sends only the scope entries that are filled in', async () => {
    const f = stub(201, { template: existing, notices: [] })
    draw()
    type('模板名称', 'Thanks')
    type('邮件主题', 'S')
    type('邮件正文', 'B')
    fireEvent.change(screen.getByLabelText('内容来源'), { target: { value: 'published_tours' } })
    fireEvent.change(screen.getByLabelText('选团方式'), { target: { value: 'many' } })
    type('适用档次', 'signature, discovery ,')
    fireEvent.click(screen.getByLabelText('出发月份 5'))
    fireEvent.click(screen.getByLabelText('出发月份 3'))
    save()
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(sentBody(f)).toMatchObject({
      factSource: 'published_tours',
      pickMode: 'many',
      pickFilter: { tiers: ['signature', 'discovery'], departureMonths: [3, 5] },
    })
    expect((sentBody(f).pickFilter as Record<string, unknown>).destinations).toBeUndefined()
  })
})

describe('editing an existing template', () => {
  it('starts from the current version, shows which one it is, and cannot change the key', () => {
    draw({ initial: existing })
    expect(screen.getByText(/当前是第 3 版/)).toBeInTheDocument()
    expect(screen.queryByLabelText('模板标识')).toBeNull()
    expect((screen.getByLabelText('邮件主题') as HTMLInputElement).value).toBe('About {{tour_name}}')
    expect((screen.getByLabelText('适用目的地') as HTMLInputElement).value).toBe('china')
    expect((screen.getByLabelText('出发月份 3') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('出发月份 4') as HTMLInputElement).checked).toBe(false)
  })

  it('saves with PUT on the address of its key, on top of the version being edited', async () => {
    const f = stub(200, { template: { ...existing, version: 4 }, notices: [] })
    const { onSaved } = draw({ initial: existing })
    type('变更说明', '  fixed the greeting ')
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(sentUrl(f)).toBe('/api/clients/c1/crm/email-templates/post-call')
    expect(sentMethod(f)).toBe('PUT')
    const body = sentBody(f)
    expect(body).toMatchObject({
      baseVersion: 3,
      name: 'Post call',
      status: 'active',
      factSource: 'published_tours',
      pickMode: 'one',
      pickFilter: { destinations: ['china'], departureMonths: [3, 5] },
      changeNote: 'fixed the greeting',
    })
    expect(body).not.toHaveProperty('templateKey')
  })

  it('"write a new version from an old one" starts from the OLD content but is still saved on top of the CURRENT version', async () => {
    const f = stub(200, { template: { ...existing, version: 4 }, notices: [] })
    const older: EmailTemplateVersion = { ...existing, version: 1, subject: 'Old subject', body: 'Old body', status: 'disabled' }
    draw({ initial: existing, prefill: older })
    expect((screen.getByLabelText('邮件主题') as HTMLInputElement).value).toBe('Old subject')
    save()
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(sentBody(f)).toMatchObject({ baseVersion: 3, subject: 'Old subject', body: 'Old body', status: 'disabled' })
  })

  it('can switch a template off or on by status (a new version)', async () => {
    const f = stub(200, { template: existing, notices: [] })
    draw({ initial: existing })
    fireEvent.change(screen.getByLabelText('模板状态'), { target: { value: 'disabled' } })
    save()
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(sentBody(f)).toMatchObject({ status: 'disabled' })
  })
})

describe('placeholders', () => {
  it('offers the common ones plus the ones of the chosen content source', () => {
    draw()
    expect(screen.getByRole('button', { name: '{{first_name}}' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '{{tour_name}}' })).toBeNull()
    fireEvent.change(screen.getByLabelText('内容来源'), { target: { value: 'published_tours' } })
    expect(screen.getByRole('button', { name: '{{tour_name}}' })).toBeInTheDocument()
  })

  it('inserts into the field that was focused last (the body by default)', () => {
    draw()
    type('邮件正文', 'Hello ')
    fireEvent.click(screen.getByRole('button', { name: '{{first_name}}' }))
    expect((screen.getByLabelText('邮件正文') as HTMLTextAreaElement).value).toContain('{{first_name}}')
    fireEvent.focus(screen.getByLabelText('邮件主题'))
    fireEvent.click(screen.getByRole('button', { name: '{{sender_name}}' }))
    expect((screen.getByLabelText('邮件主题') as HTMLInputElement).value).toContain('{{sender_name}}')
  })
})

describe('when the save does not go through', () => {
  const fill = () => {
    type('模板名称', 'Thanks')
    type('邮件主题', 'S')
    type('邮件正文', 'B')
  }

  it('400 lists every problem and keeps the form', async () => {
    stub(400, { error: 'first', errors: ['正文：占位符不对', '文字红线：no-visa-free'] })
    draw()
    fill()
    save()
    expect(await screen.findByText('正文：占位符不对')).toBeInTheDocument()
    expect(screen.getByText('文字红线：no-visa-free')).toBeInTheDocument()
    expect((screen.getByLabelText('邮件正文') as HTMLTextAreaElement).value).toBe('B')
    expect(screen.getByRole('button', { name: '保存模板' })).not.toBeDisabled()
  })

  it('400 with a single error shows it', async () => {
    stub(400, { error: '模板名称不对' })
    draw()
    fill()
    save()
    expect(await screen.findByText('模板名称不对')).toBeInTheDocument()
  })

  it('409 says someone else saved first, and offers to reload', async () => {
    stub(409, { error: 'stale' })
    const { onReload } = draw({ initial: existing })
    save()
    expect(await screen.findByText('别人刚改过这个模板，你的修改还没保存。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新载入最新版' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('503 shows the server message; a network failure says nothing was saved', async () => {
    stub(503, { error: '邮件模板功能暂时读不到数据' })
    const first = draw()
    fill()
    save()
    expect(await screen.findByText('邮件模板功能暂时读不到数据')).toBeInTheDocument()
    expect(first.onSaved).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    save()
    expect(await screen.findByText('网络出错，没保存成功。')).toBeInTheDocument()
  })

  it('cancel closes without saving', () => {
    const f = stub(200, {})
    const { onCancel } = draw()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
  })
})
