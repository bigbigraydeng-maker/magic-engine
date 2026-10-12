import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { CatalogSettings } from '@/lib/tour-catalog/catalog-contract'
import {
  CatalogImageHostsCard,
  IMAGE_HOSTS_HELP,
  IMAGE_HOST_BAD_TEXT,
  IMAGE_HOSTS_FULL_TEXT,
  IMAGE_HOSTS_SAVED_TEXT,
  IMAGE_HOSTS_SAVE_FAILED_TEXT,
  IMAGE_HOSTS_INVALID_TEXT,
} from '../CatalogImageHostsCard'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function makeSettings(overrides: Partial<CatalogSettings> = {}): CatalogSettings {
  return {
    logoUrl: 'https://example.test/logo.png',
    brandPrimary: '#336699',
    brandSecondary: null,
    channelsConnected: true,
    imageHosts: ['cdn.example.test'],
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CatalogImageHostsCard', () => {
  it('lists existing hosts and shows the help text', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    const list = screen.getByTestId('image-hosts')
    expect(within(list).getByText('cdn.example.test')).toBeInTheDocument()
    expect(screen.getByText(IMAGE_HOSTS_HELP)).toBeInTheDocument()
  })

  it('shows the empty message when there are no hosts', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings({ imageHosts: [] })}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('image-hosts')).not.toBeInTheDocument()
    expect(screen.getByText('名单还是空的。')).toBeInTheDocument()
  })

  it('adds a host lower-cased and clears the input', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('新的图片来源域名') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Images.Example.com' } })
    fireEvent.click(screen.getByText('加入'))

    const list = screen.getByTestId('image-hosts')
    expect(within(list).getByText('images.example.com')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('rejects a URL with a scheme', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('新的图片来源域名')
    fireEvent.change(input, { target: { value: 'https://x.test/a' } })
    fireEvent.click(screen.getByText('加入'))

    expect(screen.getByRole('alert')).toHaveTextContent(IMAGE_HOST_BAD_TEXT)
    const list = screen.getByTestId('image-hosts')
    expect(within(list).queryByText('https://x.test/a')).not.toBeInTheDocument()
  })

  it('rejects an IP address', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('新的图片来源域名')
    fireEvent.change(input, { target: { value: '10.0.0.1' } })
    fireEvent.click(screen.getByText('加入'))

    expect(screen.getByRole('alert')).toHaveTextContent(IMAGE_HOST_BAD_TEXT)
  })

  it('removes a host', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('移除 cdn.example.test'))
    expect(screen.queryByText('cdn.example.test')).not.toBeInTheDocument()
  })

  it('shows only suggestions not already on the list and can add them', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        suggestions={[
          { host: 'images.unsplash.com', count: 26 },
          { host: 'cdn.example.test', count: 3 },
        ]}
        onSaved={vi.fn()}
      />,
    )
    const suggestions = screen.getByTestId('image-host-suggestions')
    expect(within(suggestions).getByText('images.unsplash.com（26 张）')).toBeInTheDocument()
    expect(within(suggestions).queryByText('cdn.example.test（3 张）')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('把 images.unsplash.com 加入名单'))

    const list = screen.getByTestId('image-hosts')
    expect(within(list).getByText('images.unsplash.com')).toBeInTheDocument()
    expect(screen.queryByTestId('image-host-suggestions')).not.toBeInTheDocument()
  })

  it('renders no suggestions block when the prop is absent', () => {
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('image-host-suggestions')).not.toBeInTheDocument()
  })

  it('saves the hosts with the other settings unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ settings: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={onSaved}
      />,
    )

    const input = screen.getByLabelText('新的图片来源域名')
    fireEvent.change(input, { target: { value: 'images.example.com' } })
    fireEvent.click(screen.getByText('加入'))
    fireEvent.click(screen.getByText('保存图片来源'))

    await screen.findByRole('status')
    expect(screen.getByRole('status')).toHaveTextContent(IMAGE_HOSTS_SAVED_TEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/c1/tour-catalog/settings')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: null,
      channelsConnected: true,
      imageHosts: ['cdn.example.test', 'images.example.com'],
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('shows the invalid-host message when the server rejects the host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_image_host' }, 400))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(screen.getByText('保存图片来源'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(IMAGE_HOSTS_INVALID_TEXT)
    })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the save-failed message on a generic error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'save_failed' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('保存图片来源'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(IMAGE_HOSTS_SAVE_FAILED_TEXT)
    })
  })

  it('refuses to add more than the maximum number of hosts', () => {
    const hosts = Array.from({ length: 10 }, (_, i) => `h${i}.test`)
    render(
      <CatalogImageHostsCard
        clientId="c1"
        settings={makeSettings({ imageHosts: hosts })}
        onSaved={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('新的图片来源域名')
    fireEvent.change(input, { target: { value: 'extra.test' } })
    fireEvent.click(screen.getByText('加入'))

    expect(screen.getByRole('alert')).toHaveTextContent(IMAGE_HOSTS_FULL_TEXT)
    const list = screen.getByTestId('image-hosts')
    expect(within(list).queryByText('extra.test')).not.toBeInTheDocument()
  })
})
