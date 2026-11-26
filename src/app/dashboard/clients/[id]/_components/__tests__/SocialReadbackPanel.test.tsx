// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SocialReadbackPanel } from '../SocialReadbackPanel'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SocialReadbackPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  it('renders rows with window labels in plain Chinese', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        panel: {
          client_id: CLIENT,
          since: '2026-10-01T00:00:00.000Z',
          until: '2026-11-03T00:00:00.000Z',
          limit: 20,
          generated_at: '2026-11-03T00:00:00.000Z',
          items: [
            {
              id: 'post-1',
              kind: 'image_post',
              kind_label: '图文',
              platform_label: 'Facebook',
              published_at: '2026-11-01T10:00:00.000Z',
              published_at_display: '2026/11/01 23:00',
              story_sent: null,
              story_registered: null,
              summary: null,
              windows: [
                {
                  hours: 4,
                  title: '发后 4 小时',
                  status: 'read',
                  status_label: '已读',
                  metrics: [
                    { label: '赞', display: '2', detail: null },
                    { label: '评', display: '0', detail: null },
                    { label: '转', display: '读不到', detail: '平台没返回这项' },
                  ],
                },
                {
                  hours: 72,
                  title: '发后 72 小时',
                  status: 'pending',
                  status_label: '还没到点',
                  metrics: [
                    { label: '赞', display: '—', detail: null },
                    { label: '评', display: '—', detail: null },
                    { label: '转', display: '—', detail: null },
                  ],
                },
              ],
            },
          ],
        },
      }),
    } as Response)

    render(<SocialReadbackPanel clientId={CLIENT} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发后成绩' })).toBeInTheDocument()
    })
    expect(screen.getByText('发后 4 小时')).toBeInTheDocument()
    expect(screen.getByText('还没到点')).toBeInTheDocument()
    expect(screen.getByText('读不到')).toBeInTheDocument()
    expect(screen.queryByText(/payload/i)).not.toBeInTheDocument()
  })

  it('shows a story direct-message line when the payload has one', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        panel: {
          client_id: CLIENT,
          since: '2026-10-01T00:00:00.000Z',
          until: '2026-11-03T00:00:00.000Z',
          limit: 20,
          generated_at: '2026-11-03T00:00:00.000Z',
          items: [
            {
              id: 'story-1',
              kind: 'story',
              kind_label: 'Story',
              platform_label: 'Facebook',
              published_at: '2026-11-01T10:00:00.000Z',
              published_at_display: '2026/11/01 23:00',
              story_sent: true,
              story_registered: true,
              story_dm: '发后 12 小时新开私信 2 条（已去掉带来广告编号的会话）',
              summary: '已发出并已登记；Story 没有公开的赞评转，观看数需要洞察权限，目前读不到。',
              windows: null,
            },
          ],
        },
      }),
    } as Response)
    render(<SocialReadbackPanel clientId={CLIENT} />)
    await waitFor(() => {
      expect(screen.getByText(/新开私信 2 条/)).toBeInTheDocument()
    })
    expect(screen.getByText('已登记发出')).toBeInTheDocument()
  })

  it('shows forbidden message for non-admin', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response)
    render(<SocialReadbackPanel clientId={CLIENT} />)
    await waitFor(() => {
      expect(screen.getByText(/发后成绩只有管理员能看/)).toBeInTheDocument()
    })
  })
})
