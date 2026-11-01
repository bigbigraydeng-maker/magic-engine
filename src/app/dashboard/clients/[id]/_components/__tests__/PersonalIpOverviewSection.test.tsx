import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PersonalIpOverviewSection } from '@/app/dashboard/clients/[id]/_components/PersonalIpOverviewSection'
import { PERSONAL_IP_UNREADABLE } from '@/lib/clients/personal-ip-overview'

describe('PersonalIpOverviewSection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('渲染五格数字', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tiles: [
          { key: 'posts_on_schedule', label: '按时发布帖子', value: '2' },
          { key: 'social_followers', label: 'FB / TikTok 粉丝', value: 'FB 100 · TikTok 200' },
          { key: 'website_views', label: '网站浏览', value: '1.0K' },
          { key: 'dms_enquiries', label: '私信与咨询', value: '4' },
          { key: 'leads', label: '线索', value: '1' },
        ],
      }),
    } as Response)

    render(<PersonalIpOverviewSection clientId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('按时发布帖子')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('FB 100 · TikTok 200')).toBeInTheDocument()
    })
  })

  it('缺数据时显示读不到', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tiles: [
          { key: 'posts_on_schedule', label: '按时发布帖子', value: PERSONAL_IP_UNREADABLE },
          { key: 'social_followers', label: 'FB / TikTok 粉丝', value: PERSONAL_IP_UNREADABLE },
          { key: 'website_views', label: '网站浏览', value: PERSONAL_IP_UNREADABLE },
          { key: 'dms_enquiries', label: '私信与咨询', value: PERSONAL_IP_UNREADABLE },
          { key: 'leads', label: '线索', value: PERSONAL_IP_UNREADABLE },
        ],
      }),
    } as Response)

    render(<PersonalIpOverviewSection clientId="c1" />)

    await waitFor(() => {
      expect(screen.getAllByText(PERSONAL_IP_UNREADABLE).length).toBeGreaterThanOrEqual(5)
    })
  })
})
