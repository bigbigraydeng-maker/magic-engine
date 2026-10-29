/**
 * 邮件模板页的主体：列表、状态、历史、打开编辑器。
 *
 * 钉死的事：
 *  · 读失败显示原因和「重试」，绝不显示成「还没有模板」
 *  · 只有能改模板的人才看到 新建 / 编辑 / 停用；其他人只能看
 *  · 停用 / 启用 = 追加新版本（PUT，带当前版本号和翻转后的状态）；别人刚改过 → 提示并重新读
 *  · 「以这一版内容写新版本」打开编辑器：内容来自旧版本，保存仍压在当前版本上
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { EMAIL_SETTINGS_SAVED_EVENT } from '@/lib/crm/email-templates/settings-events'

vi.mock('../TemplateEditor', () => ({
  TemplateEditor: (props: {
    initial: EmailTemplateVersion | null
    prefill?: EmailTemplateVersion | null
    onSaved: (t: EmailTemplateVersion, notices: string[]) => void
    onCancel: () => void
    onReload: () => void
  }) => (
    <div data-testid="editor" data-initial={props.initial?.templateKey ?? 'NEW'} data-prefill={props.prefill ? String(props.prefill.version) : ''}>
      <button type="button" onClick={() => props.onSaved({ ...(props.initial as EmailTemplateVersion), version: 9 }, ['提醒：测试'])}>
        editor-save
      </button>
      <button type="button" onClick={props.onCancel}>
        editor-cancel
      </button>
      <button type="button" onClick={props.onReload}>
        editor-reload
      </button>
    </div>
  ),
}))

import { TemplatesAdmin } from '../TemplatesAdmin'

const row = (over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion => ({
  id: 'id-1',
  clientId: 'c1',
  templateKey: 'post-call',
  version: 3,
  name: 'Post call',
  subject: 'Subject text',
  body: 'Body text',
  factSource: 'none',
  pickMode: 'none',
  pickFilter: {},
  status: 'active',
  changeNote: null,
  createdBy: 'lisa@cts.example',
  createdAt: '2026-10-28T01:00:00Z',
  ...over,
})

const list = (over: Record<string, unknown> = {}) => ({
  featureState: 'ready',
  canEditTemplates: true,
  canEditSettings: false,
  templates: [row(), row({ id: 'id-2', templateKey: 'a-thanks', name: 'A thanks', status: 'disabled', version: 1 })],
  stats: [
    { templateKey: 'post-call', sent: 5, blocked: 2, failed: 1, unknown: 0 },
    { templateKey: null, sent: 99, blocked: 99, failed: 99, unknown: 99 },
  ],
  variables: { common: ['first_name'], bySource: { none: [] } },
  ...over,
})

type Reply = { status?: number; body: unknown } | Error

/** Routes by "METHOD url"; each route has a queue (the last reply repeats). */
function routes(table: Record<string, Reply[]>) {
  const calls: Array<{ key: string; body: Record<string, unknown> }> = []
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    calls.push({ key, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} })
    const queue = table[key]
    if (!queue) throw new Error(`unexpected ${key}`)
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (next instanceof Error) throw next
    const status = next.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => next.body } as Response
  })
  vi.stubGlobal('fetch', f)
  return { f, calls, of: (key: string) => calls.filter((c) => c.key === key) }
}

const LIST = 'GET /api/clients/c1/crm/email-templates'
const PUT_KEY = 'PUT /api/clients/c1/crm/email-templates/post-call'
const HISTORY = 'GET /api/clients/c1/crm/email-templates/post-call'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('reading the list', () => {
  it('a failed read is an error with a retry, never "no templates"', async () => {
    const r = routes({ [LIST]: [{ status: 503, body: { error: '邮件模板功能暂时读不到数据' } }, { body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    expect(await screen.findByText(/暂时读不到邮件模板：邮件模板功能暂时读不到数据/)).toBeInTheDocument()
    expect(screen.queryByText('还没有模板。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Post call')).toBeInTheDocument()
    expect(r.of(LIST)).toHaveLength(2)
  })

  it('an answer it cannot understand is also an error', async () => {
    routes({ [LIST]: [{ body: { featureState: 'ready' } }] })
    render(<TemplatesAdmin clientId="c1" />)
    expect(await screen.findByText(/返回的数据看不懂/)).toBeInTheDocument()
  })

  it('an empty but successful list says so', async () => {
    routes({ [LIST]: [{ body: list({ templates: [] }) }] })
    render(<TemplatesAdmin clientId="c1" />)
    expect(await screen.findByText('还没有模板。')).toBeInTheDocument()
  })

  it('lists the templates by name with status, version and the last 30 days (a free-written mail row is ignored)', async () => {
    routes({ [LIST]: [{ body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('A thanks')
    expect(items[0]).toHaveTextContent('停用')
    expect(items[0]).toHaveTextContent('近 30 天：发出 0 · 被拦 0 · 出错 0 · 不明 0')
    expect(items[1]).toHaveTextContent('Post call')
    expect(items[1]).toHaveTextContent('第 3 版')
    expect(items[1]).toHaveTextContent('近 30 天：发出 5 · 被拦 2 · 出错 1 · 不明 0')
  })

  it('shows the content on request', async () => {
    routes({ [LIST]: [{ body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '看内容' })[1])
    expect(screen.getByText('Subject text')).toBeInTheDocument()
    expect(screen.getByText('Body text')).toBeInTheDocument()
  })

  it.each([
    ['ready', null],
    ['disabled', '邮件功能现在是关着的'],
    ['invalid', '发信设置有问题'],
    ['unconfigured', '还没配发信设置'],
    ['unreadable', '暂时读不到发信设置'],
  ])('the feature banner for %s', async (featureState, text) => {
    routes({ [LIST]: [{ body: list({ featureState, canEditSettings: true }) }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    if (text === null) expect(screen.queryByText(/设置在本页下方/)).toBeNull()
    else expect(screen.getByText(new RegExp(`${text}.*设置在本页下方`))).toBeInTheDocument()
  })
})

describe('re-reading after the settings were saved', () => {
  it('the "not configured" banner goes away once the settings are saved', async () => {
    const r = routes({
      [LIST]: [
        { body: list({ featureState: 'unconfigured' }) },
        { body: list({ featureState: 'ready' }) },
      ],
    })
    render(<TemplatesAdmin clientId="c1" />)
    expect(await screen.findByText(/还没配发信设置，现在发不出去。/)).toBeInTheDocument()
    expect(r.of(LIST)).toHaveLength(1)
    act(() => {
      window.dispatchEvent(new Event(EMAIL_SETTINGS_SAVED_EVENT))
    })
    await waitFor(() => expect(r.of(LIST)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(/还没配发信设置，现在发不出去。/)).toBeNull())
    expect(await screen.findByText('Post call')).toBeInTheDocument()
  })

  it('after unmount the event no longer triggers a read', async () => {
    const r = routes({ [LIST]: [{ body: list() }] })
    const view = render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    expect(r.of(LIST)).toHaveLength(1)
    view.unmount()
    act(() => {
      window.dispatchEvent(new Event(EMAIL_SETTINGS_SAVED_EVENT))
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.of(LIST)).toHaveLength(1)
  })
})

describe('who may change what', () => {
  it('a viewer sees the templates but none of the editing buttons', async () => {
    routes({ [LIST]: [{ body: list({ canEditTemplates: false }) }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    expect(screen.queryByRole('button', { name: '新建模板' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '停用' })).toBeNull()
    expect(screen.getByText('你可以看模板，修改要找 Magic Lab 的同事。')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '历史' }).length).toBeGreaterThan(0)
  })
})

describe('switching a template off or on', () => {
  it('saves a new version with the flipped status on top of the current version', async () => {
    const r = routes({
      [LIST]: [{ body: list() }],
      [PUT_KEY]: [{ body: { template: row({ version: 4, status: 'disabled' }), notices: [] } }],
    })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(r.of(PUT_KEY)).toHaveLength(1))
    expect(r.of(PUT_KEY)[0].body).toEqual({
      baseVersion: 3,
      name: 'Post call',
      subject: 'Subject text',
      body: 'Body text',
      factSource: 'none',
      pickMode: 'none',
      pickFilter: {},
      status: 'disabled',
      changeNote: '停用',
    })
    expect(await screen.findByText('✓ 已保存为第 4 版')).toBeInTheDocument()
    await waitFor(() => expect(r.of(LIST).length).toBe(2))
  })

  it('a disabled template is switched on with the note "启用"', async () => {
    const r = routes({
      [LIST]: [{ body: list() }],
      'PUT /api/clients/c1/crm/email-templates/a-thanks': [{ body: { template: row({ version: 2 }), notices: [] } }],
    })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('A thanks')
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => expect(r.of('PUT /api/clients/c1/crm/email-templates/a-thanks')).toHaveLength(1))
    expect(r.of('PUT /api/clients/c1/crm/email-templates/a-thanks')[0].body).toMatchObject({ baseVersion: 1, status: 'active', changeNote: '启用' })
  })

  it('"someone else changed it" is said plainly and the list is read again', async () => {
    const r = routes({ [LIST]: [{ body: list() }], [PUT_KEY]: [{ status: 409, body: { error: 'stale' } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(await screen.findByText('别人刚改过，请刷新后再试。')).toBeInTheDocument()
    expect(r.of(LIST).length).toBe(2)
  })

  it('another failure shows the server\'s message', async () => {
    routes({ [LIST]: [{ body: list() }], [PUT_KEY]: [{ status: 400, body: { error: '正文：占位符不对' } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(await screen.findByText('正文：占位符不对')).toBeInTheDocument()
  })
})

describe('the editor', () => {
  it('"新建模板" opens a blank editor; saving closes it, re-reads the list and shows the notices and the version', async () => {
    const r = routes({ [LIST]: [{ body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }))
    expect(screen.getByTestId('editor')).toHaveAttribute('data-initial', 'NEW')
    fireEvent.click(screen.getByRole('button', { name: 'editor-save' }))
    await waitFor(() => expect(screen.queryByTestId('editor')).toBeNull())
    expect(await screen.findByText('提醒：测试')).toBeInTheDocument()
    expect(r.of(LIST).length).toBe(2)
  })

  it('"编辑" opens the editor on that template; cancel and reload close it', async () => {
    const r = routes({ [LIST]: [{ body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1])
    expect(screen.getByTestId('editor')).toHaveAttribute('data-initial', 'post-call')
    fireEvent.click(screen.getByRole('button', { name: 'editor-cancel' }))
    expect(screen.queryByTestId('editor')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'editor-reload' }))
    expect(screen.queryByTestId('editor')).toBeNull()
    await waitFor(() => expect(r.of(LIST).length).toBe(2))
  })

  it('opening another template replaces the open editor (one at a time)', async () => {
    routes({ [LIST]: [{ body: list() }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1])
    expect(screen.getAllByTestId('editor')).toHaveLength(1)
    expect(screen.getByTestId('editor')).toHaveAttribute('data-initial', 'post-call')
  })
})

describe('history', () => {
  const history = [row({ id: 'h3', version: 3 }), row({ id: 'h2', version: 2, status: 'disabled', changeNote: '改了称呼' })]

  it('lists the versions and writes a new one from an old one on top of the current version', async () => {
    routes({ [LIST]: [{ body: list() }], [HISTORY]: [{ body: { template: row(), history } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[1])
    const old = await screen.findByText('改了称呼')
    expect(old).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '以这一版内容写新版本' })
    fireEvent.click(buttons[1])
    const editor = screen.getByTestId('editor')
    expect(editor).toHaveAttribute('data-initial', 'post-call')
    expect(editor).toHaveAttribute('data-prefill', '2')
  })

  it('a viewer sees the history but cannot write from it', async () => {
    routes({ [LIST]: [{ body: list({ canEditTemplates: false }) }], [HISTORY]: [{ body: { template: row(), history } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[1])
    await screen.findByText('改了称呼')
    expect(screen.queryByRole('button', { name: '以这一版内容写新版本' })).toBeNull()
  })

  it('a failed history read says so and can be retried', async () => {
    routes({ [LIST]: [{ body: list() }], [HISTORY]: [{ status: 503, body: { error: 'x' } }, { body: { template: row(), history } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[1])
    expect(await screen.findByText('暂时读不到历史。')).toBeInTheDocument()
    const item = screen.getByText('暂时读不到历史。').closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('改了称呼')).toBeInTheDocument()
  })

  it('a second click on 收起历史 hides it', async () => {
    routes({ [LIST]: [{ body: list() }], [HISTORY]: [{ body: { template: row(), history } }] })
    render(<TemplatesAdmin clientId="c1" />)
    await screen.findByText('Post call')
    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[1])
    await screen.findByText('改了称呼')
    fireEvent.click(screen.getByRole('button', { name: '收起历史' }))
    expect(screen.queryByText('改了称呼')).toBeNull()
  })
})
