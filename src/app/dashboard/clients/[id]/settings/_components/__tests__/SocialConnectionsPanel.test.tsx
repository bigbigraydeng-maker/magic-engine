import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SocialConnectionsPanel } from '../SocialConnectionsPanel'
import { buildSocialConnections } from '@/lib/platform-oauth/social-onboarding'

const now = new Date('2026-10-19T00:00:00Z')
const channels = buildSocialConnections({ instagram_handle: 'example', facebook_page_url: 'javascript:alert(1)', tiktok_handle: 'example',
  facebookPublishPageId: null, youtubeChannelId: null }, [], now)
const snapshot = (canManageConfiguration = false) => ({ channels, readAt: now.toISOString(), canManageConfiguration })
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() })))

describe('client social connections centre', () => {
  it('distinguishes registered profiles from authorisation, offers only usable actions and renders URLs as text', async () => {
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'Facebook Page' })
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(screen.getByRole('link', { name: '连接 TikTok' })).toHaveAttribute('href', '/api/auth/tiktok/connect?client_id=client-a')
    expect(screen.queryByRole('link', { name: '配置 Facebook 发布主页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '配置 YouTube 频道' })).not.toBeInTheDocument()
    expect(screen.getByText('javascript:alert(1)')).not.toHaveAttribute('href')
    expect(within(screen.getByRole('article', { name: 'Instagram' })).getByText('原生授权暂未开放')).toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })
  it('directs internal staff to existing configuration paths, keeping the target section open', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => snapshot(true) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '配置 Facebook 发布主页' })).toHaveAttribute('href', expect.stringContaining('section=factory-config'))
    expect(screen.getByRole('link', { name: '配置 YouTube 频道' })).toHaveAttribute('href', expect.stringContaining('section=youtube-channel'))
  })
  it('shows lookup failure and can retry instead of claiming the accounts are disconnected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败不代表账号未连接')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新授权记录' }))
    expect(await screen.findByRole('article', { name: 'TikTok' })).toBeInTheDocument()
  })
  it('does not let an old client refresh overwrite the new client after navigation', async () => {
    const { rerender } = render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'Facebook Page' })
    let finishOld: (value: Response) => void = () => { throw new Error('request not started') }
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    await userEvent.click(screen.getByRole('button', { name: '刷新授权记录' }))
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(), channels: channels.map(row => ({ ...row, profile: 'new-client' })) }) } as Response)
    rerender(<SocialConnectionsPanel clientId="client-b" />)
    await waitFor(() => expect(screen.getAllByText('new-client')).toHaveLength(6))
    await act(async () => { finishOld({ ok: true, json: async () => snapshot() } as Response) })
    expect(screen.queryByText('javascript:alert(1)')).not.toBeInTheDocument()
    expect(screen.getAllByText('new-client')).toHaveLength(6)
  })
  it('preserves the existing admin-only revoke action and refreshes after confirmed success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const linked = channels.map(row => row.platform === 'youtube' ? { ...row, managedAccounts: [
      { connectionId: 'grant-youtube', accountId: 'channel-id', displayName: 'Demo channel' },
    ] } : row)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(true), channels: linked }) } as Response)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    await userEvent.click(await screen.findByRole('button', { name: '断开此 YouTube 授权' }))
    expect(fetch).toHaveBeenCalledWith('/api/clients/client-a/platform/youtube?connectionId=grant-youtube', { method: 'DELETE' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '断开此 YouTube 授权' })).not.toBeInTheDocument())
  })
  it('does not offer revoke to ordinary members or send a request after cancellation', async () => {
    const linked = channels.map(row => ({ ...row, managedAccounts: [{ connectionId: 'grant-youtube', accountId: 'channel-id', displayName: 'Demo' }] }))
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: linked }) } as Response)
    const { unmount } = render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'YouTube Shorts' })
    expect(screen.queryByRole('button', { name: '断开此 YouTube 授权' })).not.toBeInTheDocument()
    unmount()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(true), channels: linked }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    await userEvent.click(await screen.findByRole('button', { name: '断开此 YouTube 授权' }))
    expect(vi.mocked(fetch).mock.calls.every(call => call[1]?.method !== 'DELETE')).toBe(true)
  })
  it('ignores a late revoke completion from the previous client instead of clearing the current page', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const linked = channels.map(row => row.platform === 'youtube' ? { ...row, managedAccounts: [
      { connectionId: 'grant-youtube', accountId: 'channel-id', displayName: 'Demo channel' },
    ] } : row)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(true), channels: linked }) } as Response)
    let finishDelete: (response: Response) => void = () => { throw new Error('not started') }
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishDelete = resolve }))
    const { rerender } = render(<SocialConnectionsPanel clientId="client-a" />)
    await userEvent.click(await screen.findByRole('button', { name: '断开此 YouTube 授权' }))
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(), channels: channels.map(row => ({ ...row, profile: 'current-client-b' })) }) } as Response)
    rerender(<SocialConnectionsPanel clientId="client-b" />)
    await waitFor(() => expect(screen.getAllByText('current-client-b')).toHaveLength(6))
    const countBeforeCompletion = vi.mocked(fetch).mock.calls.length
    await act(async () => { finishDelete({ ok: true } as Response) })
    expect(fetch).toHaveBeenCalledTimes(countBeforeCompletion)
    expect(screen.getAllByText('current-client-b')).toHaveLength(6)
  })
})
