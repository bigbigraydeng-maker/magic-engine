import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoHandoffPanel } from '../VideoHandoffPanel'

const props = { clientId: 'client-1', campaignId: 'campaign-1', planId: 'plan-1', revision: '2026-10-12T00:00:00.000Z', date: '2026-10-13' }
const video = { campaign_id: props.campaignId, plan_id: props.planId, expected_plan_revision: props.revision,
  date: props.date, asset_id: 'asset-1', platform: 'facebook_reels', title: 'Best Of China — March 2027',
  caption: 'Ask the Auckland team.', preview_url: 'https://storage.test/film.mp4', approval: 'NOT_REVIEWED', filename: 'film.mp4' }
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('finished-video reviewer interface', () => {
  it('plays the scoped output and submits only strict handoff fields to the candidate route', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ videos: [video] })).mockResolvedValueOnce(response({ success: true }))
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<VideoHandoffPanel {...props} />)
    await screen.findByText(/Best Of China — March 2027/)
    expect(container.querySelector('video')?.getAttribute('src')).toBe(video.preview_url)
    fireEvent.click(screen.getByRole('button', { name: '加入广告候选' }))
    await screen.findByText('已加入广告素材候选；尚未投放。')
    const [url, request] = fetch.mock.calls[1]
    expect(url).toContain('/creative-pool/video')
    expect(JSON.parse(request.body)).toEqual({ campaign_id: props.campaignId, plan_id: props.planId,
      expected_plan_revision: props.revision, date: props.date, asset_id: video.asset_id,
      platform: video.platform, title: video.title, caption: video.caption })
  })

  it('uploads a file and associates its ID with the chosen date and platform', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ videos: [] }))
      .mockResolvedValueOnce(response({ asset: { id: 'asset-2' } }))
      .mockResolvedValueOnce(response({ video: { ...video, asset_id: 'asset-2', platform: 'tiktok', title: 'Tour 2027', caption: 'Enquire' } }))
    vi.stubGlobal('fetch', fetch)
    render(<VideoHandoffPanel {...props} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText(/上传 MP4/), { target: { files: [new File(['test'], 'film.mp4', { type: 'video/mp4' })] } })
    await screen.findByText('视频已上传，填写配文后关联计划。')
    fireEvent.change(screen.getByLabelText('视频平台'), { target: { value: 'tiktok' } })
    fireEvent.change(screen.getByLabelText('视频标题'), { target: { value: 'Tour 2027' } })
    fireEvent.change(screen.getByLabelText('发布配文'), { target: { value: 'Enquire' } })
    fireEvent.click(screen.getByRole('button', { name: `关联到 ${props.date}` }))
    await screen.findByText('已关联每日计划；等待内容和素材权利审核。')
    expect(fetch.mock.calls[1][1].body).toBeInstanceOf(FormData)
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ asset_id: 'asset-2', platform: 'tiktok', date: props.date, title: 'Tour 2027' })
  })

  it('does not display a late response from a previously selected client', async () => {
    let resolveOld: ((value: Response) => void) | undefined
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(response({ videos: [] }))
    vi.stubGlobal('fetch', fetch)
    const { rerender, container } = render(<VideoHandoffPanel {...props} />)
    rerender(<VideoHandoffPanel {...props} clientId="client-2" />)
    await act(async () => { resolveOld?.(response({ videos: [video] })) })
    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByText(/Best Of China/)).toBeNull()
  })

  it('shows a failed nomination without claiming an ad was created', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ videos: [video] }))
      .mockResolvedValueOnce(response({ error: 'POOL_CHANGED_RETRY' }, false)))
    render(<VideoHandoffPanel {...props} />)
    await screen.findByText(/Best Of China/)
    fireEvent.click(screen.getByRole('button', { name: '加入广告候选' }))
    await screen.findByText('广告候选已更新，请重试。')
    expect(screen.queryByText('已加入广告素材候选；尚未投放。')).toBeNull()
  })
})
