import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const router = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => router.params }))
import { SocialConnectionsPanel } from '../SocialConnectionsPanel'
import { buildSocialConnections } from '@/lib/platform-oauth/social-onboarding'

const now = new Date('2026-10-19T00:00:00Z')
const channels = buildSocialConnections({ instagram_handle: 'example', facebook_page_url: 'javascript:alert(1)', tiktok_handle: 'example',
  facebookPublishPageId: null, youtubeChannelId: null }, [], now)
const snapshot = (canManageConfiguration = false) => ({ channels, readAt: now.toISOString(), canManageConfiguration })
beforeEach(() => {
  router.params = new URLSearchParams()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() }))
})

describe('client social connections centre', () => {
  it('keeps Instagram and YouTube callback notices visible together', async () => {
    router.params = new URLSearchParams({ instagram: 'target_changed', youtube: 'channel_mismatch' })
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByText(/登记账号在连接期间发生变化/)).toBeInTheDocument()
    expect(screen.getByText(/本次授权的频道与已登记频道不同/)).toBeInTheDocument()
  })
  it('never calls a callback URL success when this client has no saved grants', async () => {
    router.params = new URLSearchParams({ instagram: 'connected', youtube: 'connected' })
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'YouTube Shorts' })
    expect(screen.getAllByText(/尚未找到与此客户匹配的可用授权/)).toHaveLength(2)
    expect(screen.queryByText(/ME 已核对并找到/)).not.toBeInTheDocument()
  })
  it('shows success only after the current client snapshot contains matching saved identities', async () => {
    router.params = new URLSearchParams({ instagram: 'connected', youtube: 'connected' })
    const linked = channels.map(row => row.platform === 'youtube'
      ? { ...row, targetAccountId: 'UCmJJDRx88y0IuZXJJQuGNFw', authorization: 'saved' as const,
          identity: { accountId: 'UCmJJDRx88y0IuZXJJQuGNFw', displayName: 'Celine', verifiedAt: now.toISOString() } }
      : row.platform === 'instagram'
        ? { ...row, authorization: 'saved' as const,
            identity: { accountId: '987654321', displayName: '@example', verifiedAt: now.toISOString() } } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: linked }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findAllByText(/ME 已核对并找到/)).toHaveLength(2)
  })
  it('does not trust a success URL when the saved channel differs or the lookup fails', async () => {
    router.params = new URLSearchParams({ youtube: 'connected' })
    const mismatched = channels.map(row => row.platform === 'youtube'
      ? { ...row, targetAccountId: 'UCmJJDRx88y0IuZXJJQuGNFw', authorization: 'saved' as const,
          identity: { accountId: 'UCzJJDRx88y0IuZXJJQuGNFw', displayName: 'Other', verifiedAt: now.toISOString() } } : row)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(), channels: mismatched }) } as Response)
    const view = render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByText(/尚未找到与此客户匹配的可用授权/)).toBeInTheDocument()
    view.unmount()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByText(/ME 暂时无法核对保存记录/)).toBeInTheDocument()
    expect(screen.queryByText(/ME 已核对并找到/)).not.toBeInTheDocument()
  })
  it('drops a prior client success notice while loading another client', async () => {
    router.params = new URLSearchParams({ youtube: 'connected' })
    const linked = channels.map(row => row.platform === 'youtube'
      ? { ...row, targetAccountId: 'channel-a', authorization: 'saved' as const,
          identity: { accountId: 'channel-a', displayName: 'A', verifiedAt: now.toISOString() } } : row)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(), channels: linked }) } as Response)
    const { rerender } = render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByText(/ME 已核对并找到该频道/)).toBeInTheDocument()
    let finishNext: (value: Response) => void = () => { throw new Error('request not started') }
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishNext = resolve }))
    rerender(<SocialConnectionsPanel clientId="client-b" />)
    expect(screen.queryByText(/ME 已核对并找到该频道/)).not.toBeInTheDocument()
    await act(async () => { finishNext({ ok: true, json: async () => snapshot() } as Response) })
    expect(await screen.findByText(/尚未找到与此客户匹配的可用授权/)).toBeInTheDocument()
  })
  it.each(['__proto__', 'constructor', 'unexpected'])('ignores unrecognised YouTube outcome %s', async value => {
    router.params = new URLSearchParams({ youtube: value })
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'YouTube Shorts' })
    expect(screen.queryByText(String(value))).not.toBeInTheDocument()
  })
  it('distinguishes registered profiles from authorisation, offers only usable actions and renders URLs as text', async () => {
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'Facebook Page' })
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(screen.getByRole('link', { name: '连接 TikTok' })).toHaveAttribute('href', '/api/auth/tiktok/connect?client_id=client-a')
    expect(screen.queryByRole('link', { name: '配置 Facebook 发布主页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '配置 YouTube 频道' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '连接 YouTube' })).toHaveAttribute('href', '/api/auth/google/youtube/start?clientId=client-a')
    expect(screen.getByText('javascript:alert(1)')).not.toHaveAttribute('href')
    expect(within(screen.getByRole('article', { name: 'Instagram' })).getByText('原生授权暂未开放')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '登记 Instagram 账号' })).not.toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })
  it.each([null, 'invalid name'])('asks to register Instagram when the account profile is missing or invalid (%s)', async profile => {
    const missing = channels.map(row => row.platform === 'instagram' ? { ...row, profile, connectAvailable: false } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: missing }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '登记 Instagram 账号' })).toHaveAttribute(
      'href', '/dashboard/clients/client-a/settings?tab=content&section=social-profiles')
  })
  it('directs internal staff to existing configuration paths, keeping the target section open', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => snapshot(true) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '配置 Facebook 发布主页' })).toHaveAttribute('href', expect.stringContaining('section=factory-config'))
    expect(screen.getByRole('link', { name: '由团队手动配置频道' })).toHaveAttribute('href', expect.stringContaining('section=youtube-channel'))
  })
  it('uses the existing publishing consent flow only for a configured Facebook Page', async () => {
    const configured = channels.map(row => row.platform === 'facebook'
      ? { ...row, targetAccountId: '778899', authorization: 'not_connected' as const } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: configured }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    const card = await screen.findByRole('article', { name: 'Facebook Page' })
    expect(within(card).getByRole('link', { name: '授权 Facebook 发布主页' })).toHaveAttribute(
      'href', '/api/auth/facebook/connect?client_id=client-a&intent=publishing')
    expect(within(card).getByText(/消息、评论和线索权限/)).toBeInTheDocument()
    expect(within(card).getByText(/仍需单独核验能否发布/)).toBeInTheDocument()
  })
  it('offers reauthorisation for a stale grant and sends ambiguous grants to review', async () => {
    const configured = channels.map(row => row.platform === 'facebook'
      ? { ...row, targetAccountId: '778899', identity: { accountId: '778899', displayName: 'Page', verifiedAt: null },
          authorization: 'needs_attention' as const } : row)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(), channels: configured }) } as Response)
    const { unmount } = render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '重新授权 Facebook 发布主页' })).toHaveAttribute(
      'href', '/api/auth/facebook/connect?client_id=client-a&intent=publishing')
    unmount()
    for (const authorization of ['ambiguous', 'unknown'] as const) {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot(),
        channels: configured.map(row => row.platform === 'facebook' ? { ...row, authorization } : row) }) } as Response)
      const view = render(<SocialConnectionsPanel clientId="client-a" />)
      expect(await screen.findByRole('link', { name: '核实 Facebook 主页与权限' })).toHaveAttribute(
        'href', '/dashboard/clients/client-a?settings=platform')
      expect(screen.queryByRole('link', { name: /授权 Facebook 发布主页/ })).not.toBeInTheDocument()
      view.unmount()
    }
  })
  it('keeps TikTok reauthorisation available when its grant needs attention', async () => {
    const expired = channels.map(row => row.platform === 'tiktok'
      ? { ...row, authorization: 'needs_attention' as const,
          identity: { accountId: 'open-id', displayName: 'Celine', verifiedAt: now.toISOString() } } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: expired }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '重新授权 TikTok' })).toHaveAttribute('href', '/api/auth/tiktok/connect?client_id=client-a')
  })
  it.each(['saved', 'refresh_pending'] as const)('shows %s as an existing grant without a primary connect action', async authorization => {
    const linked = channels.map(row => ['facebook', 'instagram', 'tiktok', 'youtube'].includes(row.platform)
      ? { ...row, authorization, targetAccountId: row.platform === 'facebook' ? '778899' : row.targetAccountId,
          connectAvailable: row.platform === 'instagram' ? true : row.connectAvailable,
          identity: { accountId: `${row.platform}-account`, displayName: `${row.name} account`, verifiedAt: null } } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: linked }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    const tiktok = await screen.findByRole('article', { name: 'TikTok' })
    for (const platform of ['Facebook Page', 'Instagram', 'TikTok', 'YouTube Shorts']) {
      const card = screen.getByRole('article', { name: platform })
      expect(within(card).getByText(/此账号已有授权记录/)).toBeInTheDocument()
      expect(card.querySelector('a.bg-slate-950')).not.toBeInTheDocument()
      expect(card.querySelector('details')).not.toHaveAttribute('open')
      expect(within(card).getByText('管理授权')).toBeInTheDocument()
    }
    await userEvent.click(within(tiktok).getByText('管理授权'))
    expect(within(tiktok).getByRole('link', { name: '重新授权 TikTok' })).toHaveAttribute(
      'href', '/api/auth/tiktok/connect?client_id=client-a')
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


describe('Instagram native connection UX', () => {
  const ready = () => channels.map(row => row.platform === 'instagram' ? { ...row, authorization: 'not_connected' as const, connectAvailable: true } : row)
  it('shows professional-account eligibility and the basic-only action', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: ready() }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByRole('link', { name: '连接 Instagram 专业账号' })).toHaveAttribute('href', '/api/auth/instagram/connect?client_id=client-a')
    expect(screen.getByText(/此次仅读取基本资料/)).toHaveTextContent('企业或创作者账号')
  })
  it('does not offer native consent when feature config is unavailable', async () => {
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'Instagram' })
    expect(screen.queryByRole('link', { name: '登记 Instagram 账号' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '连接 Instagram 专业账号' })).not.toBeInTheDocument()
  })
  it('renders only known finite callback messages, never raw provider text', async () => {
    router.params = new URLSearchParams({ instagram: 'target_changed' })
    const { unmount } = render(<SocialConnectionsPanel clientId="client-a" />)
    expect(await screen.findByText(/登记账号在连接期间发生变化/)).toBeInTheDocument()
    unmount(); router.params = new URLSearchParams({ instagram: 'private-provider-error' })
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'Instagram' })
    expect(screen.queryByText('private-provider-error')).not.toBeInTheDocument()
  })
  it('scopes admin disconnection to Instagram and preserves cancellation', async () => {
    const linked = ready().map(row => row.platform === 'instagram' ? { ...row, managedAccounts: [
      { connectionId: 'grant-ig', accountId: '123456', displayName: '@example' },
    ] } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(true), channels: linked }) } as Response)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SocialConnectionsPanel clientId="client-a" />)
    await userEvent.click(await screen.findByRole('button', { name: '从 ME 断开此 Instagram 授权' }))
    expect(vi.mocked(fetch).mock.calls.every(call => call[1]?.method !== 'DELETE')).toBe(true)
    vi.mocked(window.confirm).mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: '从 ME 断开此 Instagram 授权' }))
    expect(fetch).toHaveBeenCalledWith('/api/clients/client-a/platform/instagram?connectionId=grant-ig', { method: 'DELETE' })
  })
})


it('asks the team to resolve multiple Instagram grants without sending the customer back to registration', async () => {
  const multiple = channels.map(row => row.platform === 'instagram' ? { ...row, authorization: 'ambiguous' as const, connectAvailable: true,
    detail: '存在多个 Instagram 授权记录，需要团队核实后再继续连接。' } : row)
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), channels: multiple }) } as Response)
  render(<SocialConnectionsPanel clientId="client-a" />)
  const card = await screen.findByRole('article', { name: 'Instagram' })
  expect(within(card).getByText(/需要团队核实/)).toBeInTheDocument()
  expect(within(card).queryByRole('link')).not.toBeInTheDocument()
})

describe('TikTok admin disconnect', () => {
  it('lets an admin revoke the TikTok grant via the TikTok endpoint, only after confirming', async () => {
    const linked = channels.map(row => row.platform === 'tiktok' ? { ...row, managedAccounts: [
      { connectionId: 'grant-tt', accountId: 'open-id', displayName: 'Creator' },
    ] } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(true), channels: linked }) } as Response)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SocialConnectionsPanel clientId="client-a" />)
    await userEvent.click(await screen.findByRole('button', { name: '断开此 TikTok 授权' }))
    expect(vi.mocked(fetch).mock.calls.every(call => call[1]?.method !== 'DELETE')).toBe(true)
    vi.mocked(window.confirm).mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: '断开此 TikTok 授权' }))
    expect(fetch).toHaveBeenCalledWith('/api/clients/client-a/platform/tiktok?connectionId=grant-tt', { method: 'DELETE' })
  })
  it('hides the TikTok disconnect from non-admins', async () => {
    const linked = channels.map(row => row.platform === 'tiktok' ? { ...row, managedAccounts: [
      { connectionId: 'grant-tt', accountId: 'open-id', displayName: 'Creator' },
    ] } : row)
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(false), channels: linked }) } as Response)
    render(<SocialConnectionsPanel clientId="client-a" />)
    await screen.findByRole('article', { name: 'TikTok' })
    expect(screen.queryByRole('button', { name: '断开此 TikTok 授权' })).not.toBeInTheDocument()
  })
})
