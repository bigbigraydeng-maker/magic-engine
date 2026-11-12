/**
 * The 资料库 page: what an internal account and a client member see, and what each button sends.
 * fetch is replaced by a small router so each click's request can be checked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DocumentRow } from '@/lib/client-documents/types'
import { DocumentLibrary } from '../DocumentLibrary'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function doc(over: Partial<DocumentRow> & { id: string }): DocumentRow {
  return {
    category: 'brochure', title: 'CTS Tours 2027 Brochure', description: null, version_label: 'v11',
    visibility: 'client', status: 'current', original_filename: 'brochure.pdf', mime_type: 'application/pdf',
    size_bytes: 1531841, created_at: '2026-11-09T20:00:00.000Z', ...over,
  }
}

const BROCHURE = doc({ id: 'd1' })
const SHEET = doc({ id: 'd2', category: 'sheet', title: 'Best of China', version_label: null, visibility: 'internal', size_bytes: 194549, description: '一页介绍' })

interface Call { url: string; method: string; body: BodyInit | null | undefined }
let calls: Call[]
let responses: Array<(call: Call) => Response | undefined>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function serve(list: { documents: DocumentRow[]; canManage: boolean } | Response): void {
  responses = [call => (call.method === 'GET' ? (list instanceof Response ? list.clone() : json(list)) : undefined)]
}

beforeEach(() => {
  calls = []
  responses = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', body: init?.body }
    calls.push(call)
    for (const respond of responses) {
      const res = respond(call)
      if (res) return res
    }
    return json({ ok: true })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('internal account', () => {
  it('lists files grouped by category with download links and manage buttons', async () => {
    serve({ documents: [BROCHURE, SHEET], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)

    expect(await screen.findByText('CTS Tours 2027 Brochure')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '手册 / 画册' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '单页资料' })).toBeTruthy()
    expect(screen.getByText('一页介绍')).toBeTruthy()
    expect(screen.getByText('客户员工也能下载')).toBeTruthy()
    expect(screen.getByText('仅 Magic Lab 内部')).toBeTruthy()

    const links = screen.getAllByRole('link', { name: '下载' })
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      `/api/clients/${CLIENT}/documents/d1/download`,
      `/api/clients/${CLIENT}/documents/d2/download`,
    ])
    expect(screen.getByRole('button', { name: '上传文件' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '换新版' })).toHaveLength(2)
    expect(screen.getByText(/1\.5 MB/)).toBeTruthy()
    // 2026-11-09T20:00Z is already the 10th in New Zealand: the date shown is the team's day.
    expect(screen.getAllByText(/2026-11-10 放入/)).toHaveLength(2)
  })

  it('asks the server for archived versions when "显示旧版" is ticked', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')

    await userEvent.click(screen.getByLabelText('显示旧版'))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('?includeArchived=1'))).toBe(true))
  })

  it('archives a file with a PATCH scoped to this client and file, then reloads', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')

    await userEvent.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'GET')).toHaveLength(2))
    const patch = calls.find(c => c.method === 'PATCH')
    expect(patch?.url).toBe(`/api/clients/${CLIENT}/documents/d1`)
    expect(JSON.parse(String(patch?.body))).toEqual({ status: 'archived' })
  })

  it('opens the edit form with the file\'s current values and sends every field on save', async () => {
    serve({ documents: [SHEET], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('Best of China')

    await userEvent.click(screen.getByRole('button', { name: '改信息' }))
    expect((screen.getByLabelText('类别') as HTMLSelectElement).value).toBe('sheet')
    expect((screen.getByLabelText('谁能下载') as HTMLSelectElement).value).toBe('internal')
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Best of China')
    expect((screen.getByLabelText('说明') as HTMLTextAreaElement).value).toBe('一页介绍')

    await userEvent.selectOptions(screen.getByLabelText('谁能下载'), 'client')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true))
    const patch = calls.find(c => c.method === 'PATCH')
    expect(patch?.url).toBe(`/api/clients/${CLIENT}/documents/d2`)
    expect(JSON.parse(String(patch?.body))).toEqual({
      title: 'Best of China', category: 'sheet', visibility: 'client', versionLabel: '', description: '一页介绍',
    })
  })

  it('opens a download in a new tab, so a refusal never replaces the library page', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')
    const link = screen.getByRole('link', { name: '下载' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('warns, in both forms, that title, description and version are visible to client staff once the file is', async () => {
    serve({ documents: [SHEET], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('Best of China')

    await userEvent.click(screen.getByRole('button', { name: '改信息' }))
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('谁能下载'), 'client')
    expect(screen.getByRole('note').textContent).toContain('也会被客户员工看到')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))

    await userEvent.click(screen.getByRole('button', { name: '上传文件' }))
    const form = screen.getByRole('form', { name: '上传文件' })
    expect(within(form).queryByRole('note')).toBeNull()
    await userEvent.selectOptions(within(form).getByLabelText('谁能下载'), 'client')
    expect(within(form).getByRole('note').textContent).toContain('也会被客户员工看到')
  })

  it('shows the server\'s sentence when an edit is refused', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    responses.unshift(call => (call.method === 'PATCH' ? json({ error: '资料库里已经有内容完全相同的现行文件，不能再恢复这个旧版' }, 409) : undefined))
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')

    await userEvent.click(screen.getByRole('button', { name: '归档' }))
    expect((await screen.findByRole('alert')).textContent).toContain('内容完全相同')
  })

  it('uploads a file as internal-only by default and fills the name from the file name', async () => {
    serve({ documents: [], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await userEvent.click(await screen.findByRole('button', { name: '上传文件' }))

    const form = screen.getByRole('form', { name: '上传文件' })
    const file = new File(['%PDF-1.7'], 'Silk Road 2027.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(form).getByLabelText(/文件（/), file)
    expect((within(form).getByLabelText('名称') as HTMLInputElement).value).toBe('Silk Road 2027')

    await userEvent.click(within(form).getByRole('button', { name: '上传' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    const post = calls.find(c => c.method === 'POST')
    expect(post?.url).toBe(`/api/clients/${CLIENT}/documents`)
    const sent = post?.body
    expect(sent).toBeInstanceOf(FormData)
    const data = sent as FormData
    expect((data.get('file') as File).name).toBe('Silk Road 2027.pdf')
    expect(data.get('visibility')).toBe('internal')
    expect(data.get('category')).toBe('other')
    expect(data.get('title')).toBe('Silk Road 2027')
    expect(data.get('replaceId')).toBeNull()
  })

  it('shows the refusal text and keeps the form open when an upload is rejected', async () => {
    serve({ documents: [], canManage: true })
    responses.unshift(call => (call.method === 'POST' ? json({ error: '资料库里已经有内容完全相同的现行文件：「Old」', code: 'duplicate_content' }, 409) : undefined))
    render(<DocumentLibrary clientId={CLIENT} />)
    await userEvent.click(await screen.findByRole('button', { name: '上传文件' }))
    const form = screen.getByRole('form', { name: '上传文件' })
    await userEvent.upload(within(form).getByLabelText(/文件（/), new File(['%PDF-1.7'], 'a.pdf'))
    await userEvent.click(within(form).getByRole('button', { name: '上传' }))

    expect((await within(form).findByRole('alert')).textContent).toContain('内容完全相同')
    expect(screen.getByRole('form', { name: '上传文件' })).toBeTruthy()
  })

  it('asks for a file before sending anything', async () => {
    serve({ documents: [], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await userEvent.click(await screen.findByRole('button', { name: '上传文件' }))
    await userEvent.click(within(screen.getByRole('form', { name: '上传文件' })).getByRole('button', { name: '上传' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请先选择')
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('replaces a file: the upload carries the old file\'s id and keeps its category and visibility', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')

    await userEvent.click(screen.getByRole('button', { name: '换新版' }))
    const form = screen.getByRole('form', { name: '上传文件' })
    expect(form.textContent).toContain('换新版')
    expect((within(form).getByLabelText('类别') as HTMLSelectElement).value).toBe('brochure')
    expect((within(form).getByLabelText('谁能下载') as HTMLSelectElement).value).toBe('client')

    await userEvent.upload(within(form).getByLabelText(/文件（/), new File(['%PDF-1.7'], 'v12.pdf'))
    await userEvent.click(within(form).getByRole('button', { name: '上传' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    const data = calls.find(c => c.method === 'POST')?.body as FormData
    expect(data.get('replaceId')).toBe('d1')
  })

  it('shows the warning when the new version is saved but the old one could not be archived', async () => {
    serve({ documents: [BROCHURE], canManage: true })
    responses.unshift(call => (call.method === 'POST' ? json({ document: BROCHURE, warning: '新版已放进资料库，但旧版没能自动收起，请在页面上手动归档旧版' }, 201) : undefined))
    render(<DocumentLibrary clientId={CLIENT} />)
    await screen.findByText('CTS Tours 2027 Brochure')
    await userEvent.click(screen.getByRole('button', { name: '换新版' }))
    const form = screen.getByRole('form', { name: '上传文件' })
    await userEvent.upload(within(form).getByLabelText(/文件（/), new File(['%PDF-1.7'], 'v12.pdf'))
    await userEvent.click(within(form).getByRole('button', { name: '上传' }))

    expect((await screen.findByRole('status')).textContent).toContain('手动归档旧版')
  })
})

describe('client member', () => {
  it('sees downloads only: no upload, edit, archive, visibility labels or old versions switch', async () => {
    serve({ documents: [BROCHURE], canManage: false })
    render(<DocumentLibrary clientId={CLIENT} />)

    expect(await screen.findByText('CTS Tours 2027 Brochure')).toBeTruthy()
    expect(screen.getByRole('link', { name: '下载' }).getAttribute('href')).toBe(`/api/clients/${CLIENT}/documents/d1/download`)
    for (const name of ['上传文件', '换新版', '改信息', '归档']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByLabelText('显示旧版')).toBeNull()
    expect(screen.queryByText('客户员工也能下载')).toBeNull()
  })

  it('shows an empty library as such, without an upload form', async () => {
    serve({ documents: [], canManage: false })
    render(<DocumentLibrary clientId={CLIENT} />)
    expect(await screen.findByText(/还没有可下载的资料/)).toBeTruthy()
    expect(screen.queryByRole('form', { name: '上传文件' })).toBeNull()
  })

  it('closes an open upload form when a refresh says the account can no longer manage the library', async () => {
    let loads = 0
    responses = [call => {
      if (call.method !== 'GET') return undefined
      loads += 1
      return json({ documents: [BROCHURE], canManage: loads === 1 })
    }]
    render(<DocumentLibrary clientId={CLIENT} />)
    await userEvent.click(await screen.findByRole('button', { name: '上传文件' }))
    expect(screen.getByRole('form', { name: '上传文件' })).toBeTruthy()

    await userEvent.click(screen.getByLabelText('显示旧版'))
    await waitFor(() => expect(screen.queryByRole('form', { name: '上传文件' })).toBeNull())
    expect(screen.queryByRole('button', { name: '上传文件' })).toBeNull()
    expect(screen.getByRole('link', { name: '下载' })).toBeTruthy()
  })
})

describe('when the list cannot be loaded', () => {
  const cases: Array<[number, Record<string, unknown>, string]> = [
    [401, { error: 'Unauthorized' }, '登录已过期'],
    [403, { error: 'Forbidden' }, '还没有开通资料库'],
    [402, { error: 'paid only' }, '还没有开通资料库'],
    [404, { error: '客户不存在' }, '找不到这个客户'],
    [500, { error: 'x', code: 'client_documents_unavailable' }, '暂时不可用'],
    [500, { error: 'x' }, '暂时打不开'],
  ]
  it.each(cases)('status %i shows a plain sentence and no file list', async (status, body, expected) => {
    serve(json(body, status))
    render(<DocumentLibrary clientId={CLIENT} />)
    expect((await screen.findByTestId('documents-notice')).textContent).toContain(expected)
    expect(screen.queryByRole('link', { name: '下载' })).toBeNull()
  })

  it('treats a network failure and a malformed answer the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const first = render(<DocumentLibrary clientId={CLIENT} />)
    expect((await screen.findByTestId('documents-notice')).textContent).toContain('暂时打不开')
    first.unmount()

    serve(json({ unexpected: true }))
    vi.stubGlobal('fetch', vi.fn(async () => json({ unexpected: true })))
    render(<DocumentLibrary clientId={CLIENT} />)
    expect((await screen.findByTestId('documents-notice')).textContent).toContain('暂时打不开')
  })
})
