// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WeekPackApproval } from '../WeekPackApproval'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const REEL = '33333333-3333-4333-8333-333333333333'

const PAGE = {
  success: true,
  enabled: true,
  reel_go_public: true,
  headline: '下一周可以批了',
  lines: ['Story「下一周」共 1 条，现在是草稿。'],
  posts_line: '图文尚未接入。这一周不会授权图文，也没有把它显示成 0 条。',
  cadence_line: '周四出草稿，周五批，周一起按计划发。',
  message: null,
  card: {
    run_id: 'run-1',
    expected_decision_id: 'dec-1',
    fingerprint: 'f'.repeat(64),
    what: '同意按清单发布下周的 Story 和 Reel。改过的会单独拦住。',
    date: '2026-11-09 至 2026-11-15（新西兰，周一至周日）',
    display_scope: '下周 Story 1 条、Reel 1 条，图文尚未接入。',
    status_line: '等你点',
    confirm_enabled: true,
    decline_enabled: true,
    blocked_reason: null,
  },
  reels: [{ work_order_id: REEL, title: '一条视频' }],
  receipt_lines: [],
}

const PREVIEW = {
  preview_token: 'tok-fixture',
  page_id: 'page-fixture',
  video_id: 'video-fixture',
  caption: '这是要公开的文案',
  first_comment: '这是首评',
  mode: 'publish',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubFetch(previewOk = true) {
  const posts: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) as unknown : undefined
    posts.push({ url, body })
    if (url.endsWith('/week-pack') && init?.method !== 'POST') {
      return { ok: true, json: async () => PAGE }
    }
    if (url.includes('/promote')) {
      return { ok: previewOk, json: async () => (previewOk ? PREVIEW : { error: '预览失败' }) }
    }
    return { ok: true, json: async () => PAGE }
  }))
  return posts
}

describe('WeekPackApproval preview', () => {
  it('shows the public copy and only marks the reel seen after the person looks', async () => {
    const posts = stubFetch()
    render(<WeekPackApproval clientId={CLIENT} />)
    expect(await screen.findByText('下一周可以批了')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '先预览' }))
    expect(await screen.findByText('这是要公开的文案')).toBeTruthy()
    expect(screen.getByText('这是首评')).toBeTruthy()
    expect(screen.getByText('page-fixture')).toBeTruthy()
    expect(screen.getByText('video-fixture')).toBeTruthy()
    expect(screen.getByText('确认后这条 Reel 会立刻对外公开,不能改回草稿(只能删帖)')).toBeTruthy()
    expect(screen.queryByText('已看过')).toBeNull()
    expect(document.body.textContent).not.toContain('tok-fixture')

    fireEvent.click(screen.getByRole('button', { name: '同意这一周' }))
    await waitFor(() => {
      const early = posts.find((row) => (row.body as { action?: string } | undefined)?.action === 'confirm')
      expect((early?.body as { preview_tokens?: unknown[] }).preview_tokens).toEqual([])
    })

    fireEvent.click(screen.getByRole('button', { name: '先预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '我看过了' }))
    expect(screen.getByRole('button', { name: '已看过' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '同意这一周' }))
    await waitFor(() => {
      const later = posts.filter((row) => (row.body as { action?: string } | undefined)?.action === 'confirm')
      expect((later.at(-1)?.body as { preview_tokens: unknown[] }).preview_tokens).toEqual([
        { work_order_id: REEL, preview_token: 'tok-fixture' },
      ])
    })
  })
})
