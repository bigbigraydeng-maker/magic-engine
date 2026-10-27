import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SocialHandlesPanel } from '../SocialHandlesPanel'

const handles = { instagram_handle: null, facebook_page_url: null, tiktok_handle: null }
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => handles })))
describe('Instagram registration before consent', () => {
  it.each(['bad-name', 'a'.repeat(31), 'a..b'])('explains and blocks an invalid Instagram username %s before saving', async value => {
    render(<SocialHandlesPanel clientId="client-a" />)
    await userEvent.type(await screen.findByPlaceholderText('例：ctstours （不需要 @）'), value)
    await userEvent.click(screen.getByRole('button', { name: '保存账号资料' }))
    expect(screen.getByText(/Instagram 用户名须为/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('saves a canonical handle and gives an explicit return to connection, without initiating consent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => handles } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...handles, instagram_handle: 'example.syd', success: true }) } as Response)
    render(<SocialHandlesPanel clientId="client-a" />)
    await userEvent.type(await screen.findByPlaceholderText('例：ctstours （不需要 @）'), '@Example.Syd')
    await userEvent.click(screen.getByRole('button', { name: '保存账号资料' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).instagram_handle).toBe('example.syd')
    // Canonicalise the displayed draft too so the successful save is not falsely dirty.
    expect(await screen.findByRole('link', { name: '继续连接 Instagram' })).toHaveAttribute('href',
      '/dashboard/clients/client-a/settings?tab=content&section=social-connections')
  })
})
