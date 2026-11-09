import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CatalogSettings, CatalogViewer } from '@/lib/tour-catalog/catalog-contract'
import {
  CatalogHeader,
  BETA_NOTE_UNCONNECTED,
  BETA_NOTE_CONNECTED,
} from '../CatalogHeader'
import { CatalogSkeleton } from '../CatalogSkeleton'

function makeSettings(overrides: Partial<CatalogSettings> = {}): CatalogSettings {
  return {
    logoUrl: null,
    brandPrimary: null,
    brandSecondary: null,
    channelsConnected: false,
    imageHosts: [],
    ...overrides,
  }
}

function makeViewer(overrides: Partial<CatalogViewer> = {}): CatalogViewer {
  return { email: 'amy@example.test', role: 'client_editor', ...overrides }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CatalogHeader', () => {
  it('renders branded mode with logo, heading and badge', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ logoUrl: 'https://example.test/logo.png', brandPrimary: '#336699' })}
        viewer={makeViewer()}
      />,
    )
    const header = screen.getByTestId('catalog-header')
    expect(header).toHaveAttribute('data-branded', 'true')
    const img = screen.getByAltText('示例旅行社')
    expect(img).toHaveAttribute('src', 'https://example.test/logo.png')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('heading', { name: '团目录' })).toBeInTheDocument()
    expect(screen.getByTestId('beta-badge')).toHaveTextContent('Beta')
    expect(screen.getByText('示例旅行社')).toBeInTheDocument()
  })

  it('renders neutral mode when the logo is missing', () => {
    const { container } = render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ logoUrl: null, brandPrimary: '#336699' })}
        viewer={makeViewer()}
      />,
    )
    expect(screen.getByTestId('catalog-header')).toHaveAttribute('data-branded', 'false')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('示例旅行社')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|null/)
  })

  it('renders neutral mode when the colour is invalid', () => {
    const { container } = render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ logoUrl: 'https://example.test/logo.png', brandPrimary: 'red' })}
        viewer={makeViewer()}
      />,
    )
    expect(screen.getByTestId('catalog-header')).toHaveAttribute('data-branded', 'false')
    expect(container.querySelector('img')).toBeNull()
  })

  it('removes the logo when the image fails to load', () => {
    const { container } = render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ logoUrl: 'https://example.test/logo.png', brandPrimary: '#336699' })}
        viewer={makeViewer()}
      />,
    )
    const img = screen.getByAltText('示例旅行社')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('示例旅行社')).toBeInTheDocument()
  })

  it('shows the unconnected beta note when channels are not connected', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ channelsConnected: false })}
        viewer={makeViewer()}
      />,
    )
    expect(screen.getByTestId('beta-note').textContent).toContain(BETA_NOTE_UNCONNECTED)
  })

  it('shows the connected beta note when channels are connected', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings({ channelsConnected: true })}
        viewer={makeViewer()}
      />,
    )
    const note = screen.getByTestId('beta-note').textContent ?? ''
    expect(note).toContain(BETA_NOTE_CONNECTED)
    expect(note).not.toContain('不会改动官网')
  })

  it('links to the feedback mailto', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings()}
        viewer={makeViewer()}
      />,
    )
    const link = screen.getByRole('link', { name: '告诉我们' })
    expect(link.getAttribute('href') ?? '').toMatch(/^mailto:hello@magicengine\.cloud/)
  })

  it('shows the signed-in line with the viewer email', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings()}
        viewer={makeViewer({ email: 'amy@example.test' })}
      />,
    )
    expect(
      screen.getByText('你正以 amy@example.test 登录，修改记在这个账号名下'),
    ).toBeInTheDocument()
  })

  it('hides the signed-in line when the email is empty', () => {
    render(
      <CatalogHeader
        clientName="示例旅行社"
        settings={makeSettings()}
        viewer={makeViewer({ email: '' })}
      />,
    )
    expect(screen.queryByText(/你正以/)).toBeNull()
  })
})

describe('CatalogSkeleton', () => {
  it('renders a busy status region', () => {
    render(<CatalogSkeleton />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
  })
})
