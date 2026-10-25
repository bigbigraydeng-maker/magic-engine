import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YoutubePanel } from '../YoutubePanel'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
describe('YouTube channel configuration', () => {
  it('hides staff-only configuration and connection actions from customers', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ channel_id: null, can_edit: false }) } as Response)
    render(<YoutubePanel clientId="client-a" configurationOnly />)
    await screen.findByText(/此频道配置需由团队核实/)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('provides a clear continuation that reloads the social centre after saving', async () => {
    const channel = `UC${'a'.repeat(22)}`
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ channel_id: null, can_edit: true }) } as Response)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ channel_id: channel }) } as Response)
    render(<YoutubePanel clientId="client-a" configurationOnly />)
    await userEvent.type(await screen.findByRole('textbox'), channel)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('link', { name: '已保存频道，继续核对并授权 →' })).toHaveAttribute('href',
      '/dashboard/clients/client-a/settings?tab=connect&section=social-connections')
  })
})
