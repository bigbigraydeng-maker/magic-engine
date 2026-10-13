import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type {
  CatalogMemberView,
  CatalogSettings,
  ImageHostSuggestion,
} from '@/lib/tour-catalog/catalog-contract'
import { CatalogSettingsPanel } from '../CatalogSettingsPanel'
import {
  MEMBERS_BAD_EMAIL,
  MEMBERS_LOAD_ERROR,
} from '../CatalogMembersCard'
import {
  CONNECT_CONFIRM_TEXT,
  SETTINGS_ERROR_TEXTS,
  SETTINGS_SAVED_TEXT,
} from '../CatalogBrandSettingsCard'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const BASE_SETTINGS: CatalogSettings = {
  logoUrl: null,
  brandPrimary: null,
  brandSecondary: null,
  channelsConnected: false,
  imageHosts: [],
}

function member(email: string, hasLogin: boolean): CatalogMemberView {
  return {
    email,
    grantedBy: 'admin@example.test',
    createdAt: '2026-10-10T03:30:00Z',
    hasLogin,
  }
}

const INITIAL_MEMBERS: CatalogMemberView[] = [
  member('amy@example.test', false),
  member('ben@example.test', true),
]

interface FetchOptions {
  members?: CatalogMemberView[]
  membersStatus?: number
  settingsStatus?: number
  settingsError?: string
}

function makeFetchMock(options: FetchOptions = {}) {
  const members = options.members ?? INITIAL_MEMBERS
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url.endsWith('/members')) {
      if (method === 'GET') {
        if (options.membersStatus && options.membersStatus >= 400) {
          return jsonResponse({ error: 'load_failed' }, options.membersStatus)
        }
        return jsonResponse({ members })
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string }
        const next = [...members, member(String(body.email), false)]
        return jsonResponse({ members: next })
      }
    }
    if (url.includes('/members?email=')) {
      if (method === 'DELETE') {
        const email = decodeURIComponent(url.split('email=')[1] ?? '')
        return jsonResponse({ members: members.filter(m => m.email !== email) })
      }
    }
    if (url.endsWith('/settings')) {
      if (method === 'PUT') {
        if (options.settingsStatus && options.settingsStatus >= 400) {
          return jsonResponse({ error: options.settingsError }, options.settingsStatus)
        }
        return jsonResponse({ settings: BASE_SETTINGS })
      }
    }
    return jsonResponse({}, 404)
  })
}

function renderPanel(overrides: {
  permissions?: { manage_members: boolean; manage_settings: boolean }
  settings?: CatalogSettings
  onSaved?: () => void
  imageHostSuggestions?: ImageHostSuggestion[]
} = {}) {
  const permissions = overrides.permissions ?? { manage_members: true, manage_settings: true }
  const onSaved = overrides.onSaved ?? vi.fn()
  render(
    <CatalogSettingsPanel
      clientId="c1"
      settings={overrides.settings ?? BASE_SETTINGS}
      permissions={permissions}
      imageHostSuggestions={overrides.imageHostSuggestions}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

let fetchMock: ReturnType<typeof makeFetchMock>

beforeEach(() => {
  fetchMock = makeFetchMock()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CatalogSettingsPanel members', () => {
  it('renders members and marks those without a login', async () => {
    renderPanel()
    const amy = await screen.findByTestId('member-amy@example.test')
    const ben = screen.getByTestId('member-ben@example.test')
    expect(
      within(amy).getByText(
        '还没有这个客户的登录账号——先在客户主页「设置 → 用户权限」里给他开通，再让他登录',
      ),
    ).toBeInTheDocument()
    expect(within(ben).queryByText(/还没有这个客户的登录账号/)).not.toBeInTheDocument()
  })

  it('adds a member with a normalised email', async () => {
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: ' Bob@Example.test ' } })
    fireEvent.click(screen.getByRole('button', { name: '加入名单' }))
    await screen.findByTestId('member-bob@example.test')
    const postCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(postCall?.[0]).toBe('/api/clients/c1/tour-catalog/members')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ email: 'bob@example.test' })
  })

  it('rejects a bad email without sending a request', async () => {
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: '加入名单' }))
    const message = await screen.findByText(MEMBERS_BAD_EMAIL)
    // right under the input it is about, not at the top of the card
    expect(message.previousElementSibling).toBe(screen.getByLabelText('邮箱'))
    const postCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('removes a member when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.click(screen.getByRole('button', { name: '把 amy@example.test 移出名单' }))
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        call => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deleteCall?.[0]).toBe('/api/clients/c1/tour-catalog/members?email=amy%40example.test')
    })
  })

  it('does not remove a member when not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.click(screen.getByRole('button', { name: '把 amy@example.test 移出名单' }))
    const deleteCall = fetchMock.mock.calls.find(
      call => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    )
    expect(deleteCall).toBeUndefined()
  })

  it('shows a load error when the list cannot be read', async () => {
    fetchMock = makeFetchMock({ membersStatus: 500 })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    expect(await screen.findByText(MEMBERS_LOAD_ERROR)).toBeInTheDocument()
  })
})

describe('CatalogSettingsPanel settings', () => {
  it('saves the settings and reports success', async () => {
    const { onSaved } = renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.change(screen.getByLabelText('logo 地址'), {
      target: { value: 'https://example.test/logo.png' },
    })
    fireEvent.change(screen.getByLabelText('主色'), { target: { value: '#336699' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(SETTINGS_SAVED_TEXT)).toBeInTheDocument()
    const putCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'PUT')
    expect(putCall?.[0]).toBe('/api/clients/c1/tour-catalog/settings')
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toEqual({
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: null,
      channelsConnected: false,
      imageHosts: [],
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['invalid_request'],
    ['invalid_color'],
    ['invalid_logo_url'],
    ['logo_not_on_client_domain'],
    ['save_failed'],
  ])('shows the Chinese text for server error %s', async code => {
    fetchMock = makeFetchMock({ settingsStatus: 400, settingsError: code })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.change(screen.getByLabelText('logo 地址'), {
      target: { value: 'https://example.test/logo.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const expected = SETTINGS_ERROR_TEXTS[code as keyof typeof SETTINGS_ERROR_TEXTS]
    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(code)).not.toBeInTheDocument()
  })

  it('blocks an invalid colour locally', async () => {
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    fireEvent.change(screen.getByLabelText('主色'), { target: { value: 'red' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(SETTINGS_ERROR_TEXTS.invalid_color)).toBeInTheDocument()
    const putCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'PUT')
    expect(putCall).toBeUndefined()
  })

  it('only turns the connect switch on after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel()
    await screen.findByTestId('member-amy@example.test')
    const checkbox = screen.getByLabelText('官网等渠道已经接通，读的是这里的上架内容')
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(confirmSpy).toHaveBeenCalledWith(CONNECT_CONFIRM_TEXT)

    confirmSpy.mockReturnValue(true)
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(confirmSpy).toHaveBeenCalledTimes(2)

    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(SETTINGS_SAVED_TEXT)
    const putCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'PUT')
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body)).channelsConnected).toBe(true)
  })
})

describe('CatalogSettingsPanel permissions', () => {
  it('hides the members card without manage_members', async () => {
    renderPanel({ permissions: { manage_members: false, manage_settings: true } })
    expect(screen.queryByText('谁可以用团目录')).not.toBeInTheDocument()
    const membersCall = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/members'))
    expect(membersCall).toBeUndefined()
  })

  it('hides the settings card without manage_settings', async () => {
    renderPanel({ permissions: { manage_members: true, manage_settings: false } })
    await screen.findByTestId('member-amy@example.test')
    expect(screen.queryByText('页面品牌与状态')).not.toBeInTheDocument()
  })
})

describe('CatalogSettingsPanel image sources and website comparison', () => {
  const WITH_HOSTS: CatalogSettings = { ...BASE_SETTINGS, imageHosts: ['cdn.example.test', 'images.example.com'] }

  function putBodies(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls
      .filter(call => (call[1] as RequestInit | undefined)?.method === 'PUT')
      .map(call => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>)
  }

  it('shows both new cards to someone who manages settings', () => {
    renderPanel({ permissions: { manage_members: false, manage_settings: true } })
    expect(screen.getByRole('heading', { name: '允许的图片来源' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '和官网现在的内容比一下' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始比对' })).toBeInTheDocument()
  })

  it('hides both without manage_settings', async () => {
    renderPanel({ permissions: { manage_members: true, manage_settings: false } })
    await screen.findByTestId('member-amy@example.test')
    expect(screen.queryByText('允许的图片来源')).not.toBeInTheDocument()
    expect(screen.queryByText('和官网现在的内容比一下')).not.toBeInTheDocument()
  })

  it('saving the brand card sends the current image sources along, not an empty list', async () => {
    renderPanel({ settings: WITH_HOSTS, permissions: { manage_members: false, manage_settings: true } })
    fireEvent.change(screen.getByLabelText('主色'), { target: { value: '#336699' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(SETTINGS_SAVED_TEXT)
    expect(putBodies()).toEqual([
      {
        logoUrl: null,
        brandPrimary: '#336699',
        brandSecondary: null,
        channelsConnected: false,
        imageHosts: ['cdn.example.test', 'images.example.com'],
      },
    ])
  })

  it('a suggested source is added with one click and saved with the brand untouched', async () => {
    const { onSaved } = renderPanel({
      settings: { ...WITH_HOSTS, logoUrl: 'https://example.test/logo.png', brandPrimary: '#112233' },
      permissions: { manage_members: false, manage_settings: true },
      imageHostSuggestions: [{ host: 'images.unsplash.com', count: 26 }],
    })
    expect(screen.getByTestId('image-host-suggestions')).toHaveTextContent('images.unsplash.com（26 张）')
    fireEvent.click(screen.getByRole('button', { name: '把 images.unsplash.com 加入名单' }))
    fireEvent.click(screen.getByRole('button', { name: '移除 cdn.example.test' }))
    fireEvent.click(screen.getByRole('button', { name: '保存图片来源' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(putBodies()).toEqual([
      {
        logoUrl: 'https://example.test/logo.png',
        brandPrimary: '#112233',
        brandSecondary: null,
        channelsConnected: false,
        imageHosts: ['images.example.com', 'images.unsplash.com'],
      },
    ])
  })
})
