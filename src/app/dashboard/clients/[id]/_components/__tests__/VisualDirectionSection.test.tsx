import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CampaignBrief } from '@/types/magic-engine'
import { VisualDirectionSection } from '../VisualDirectionSection'

const campaign = {
  id: 'camp-1',
  client_id: 'client-1',
  status: 'active',
  title: '春季团',
  vi_mood: '',
  vi_input_notes: '内部画面备注',
  vi_input_file_urls: ['notes/a.pdf'],
  vi_reference_note: '不要给客户看的参考',
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
} as CampaignBrief

function savedCampaign(extra: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ success: true, campaign: { ...campaign, ...extra } }),
  }
}

function echoSaved(override: Record<string, unknown> = {}) {
  return async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    return savedCampaign({ ...sent, ...override })
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('视觉方向保存', () => {
  it('客户看不到视觉要点、参考文件和参考说明', () => {
    render(
      <VisualDirectionSection campaign={campaign} clientId="client-1" onUpdated={vi.fn()} />,
    )
    expect(screen.queryByText(/活动视觉要点/)).toBeNull()
    expect(screen.queryByText(/上传参考文件/)).toBeNull()
    expect(screen.queryByText(/Image Generation Reference/)).toBeNull()
    expect(screen.getByText('Visual Mood')).toBeTruthy()
  })

  it('客户保存时不提交被丢掉的栏，带回的心情才显示 Saved', async () => {
    const fetchMock = vi.fn(echoSaved())
    vi.stubGlobal('fetch', fetchMock)
    render(
      <VisualDirectionSection campaign={campaign} clientId="client-1" onUpdated={vi.fn()} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/Autumn imperial Beijing/), { target: { value: '金秋' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Visual Direction' }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({
      vi_mood: '金秋',
      vi_color_accent: null,
      vi_specific_dos: null,
      vi_specific_donts: null,
    })
    expect(body.vi_input_notes).toBeUndefined()
    expect(body.vi_reference_note).toBeUndefined()
  })

  it('服务器丢掉客户提交的心情时不显示 Saved', async () => {
    vi.stubGlobal('fetch', vi.fn(echoSaved({ vi_mood: null })))
    render(
      <VisualDirectionSection campaign={campaign} clientId="client-1" onUpdated={vi.fn()} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/Autumn imperial Beijing/), { target: { value: '金秋' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Visual Direction' }))
    expect(await screen.findByText('没有存上，请再试一次')).toBeTruthy()
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('内部账号仍能保存视觉要点和参考说明', async () => {
    const fetchMock = vi.fn(echoSaved())
    vi.stubGlobal('fetch', fetchMock)
    render(
      <VisualDirectionSection campaign={campaign} clientId="client-1" internal onUpdated={vi.fn()} />,
    )
    expect(screen.getByText(/活动视觉要点/)).toBeTruthy()
    expect(screen.getByText(/上传参考文件/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/节日红金配色/), { target: { value: '红金' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Visual Direction' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.vi_input_notes).toBe('红金')
    expect(body.vi_input_file_urls).toEqual(['notes/a.pdf'])
    expect(body.vi_reference_note).toBe('不要给客户看的参考')
  })
})
