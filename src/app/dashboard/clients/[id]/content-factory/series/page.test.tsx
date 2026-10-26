import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import Page from './page'
import cts from '../../../../../../../config/clients/cts/documentary-series.json'
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'test-client' }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
const fetchMock = vi.fn()
const board = { ...cts, episodes: cts.episodes.map((e, i) => ({ ...e, links: { youtube: '', tiktok: '', preview: '' }, youtube: { status: i ? 'unlinked' : 'ok', views: i ? null : 0, likes: null, observedAt: i ? null : '2026-10-15T00:00:00Z' } })) }
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true, json: async () => board }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('series workspace', () => {
  it('shows unknown counts as dash, honest platform states, and filters Winter candidates', async () => {
    render(<Page />)
    await screen.findByText('Beyond the Skyline')
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(12)
    expect(screen.getAllByText('封面草稿')).toHaveLength(11)
    expect(screen.getByText('封面已确认')).toBeInTheDocument()
    expect(screen.getAllByText('图片来源与授权')).toHaveLength(12)
    expect(screen.getAllByText('未关联平台视频')).toHaveLength(11)
    fireEvent.change(screen.getByLabelText('系列'), { target: { value: 'Winter · China, Up Close' } })
    expect(screen.queryByText('Beyond the Skyline')).not.toBeInTheDocument()
    expect(screen.getByText('Winter After Dark')).toBeInTheDocument()
    expect(screen.getByText('5 集')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('制作状态'), { target: { value: 'editorial_final' } })
    expect(screen.getByText('没有符合筛选条件的视频。')).toBeInTheDocument()
  })
  it('saves only link references and presents conflicts rather than claiming success', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => board })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: '设置已在别处更新' }) })
    render(<Page />)
    await screen.findByText('Beyond the Skyline')
    fireEvent.click(screen.getAllByText('关联成片与平台链接')[0])
    fireEvent.change(screen.getByLabelText('YouTube 视频链接'), { target: { value: 'https://youtu.be/abcdefghijk' } })
    fireEvent.click(screen.getByText('保存关联'))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('设置已在别处更新')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ episodeKey: 'shanghai-beyond-skyline', expectedLinks: { youtube: '', tiktok: '', preview: '' }, links: { youtube: 'https://youtu.be/abcdefghijk', tiktok: '', preview: '' } })
  })
})
