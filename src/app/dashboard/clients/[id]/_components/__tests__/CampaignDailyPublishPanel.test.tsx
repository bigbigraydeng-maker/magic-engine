/**
 * CampaignDailyPublishPanel — the guard rails that keep a real Facebook
 * publish from being one stray click away.
 *
 * The API is already fail-closed; these tests lock the *interface* half of
 * that promise: the safe action is the only one reachable first, going live
 * always costs a second explicit confirmation, and what the panel shows as
 * "published" comes from the stored receipt rather than from optimism.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignDailyPublishPanel, type PublishReceipt } from '../CampaignDailyPublishPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea'
const PLAN_ID = 'f166a5c0-b2df-478c-8b04-1168ef2d3641'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '40b720ac-dfe4-44b6-8192-6f3f93ad3bdb'
const PAGE_ID = '1616575215312482'

function props(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    campaignId: CAMPAIGN_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    facebookPageId: PAGE_ID,
    queueReceiptReady: true,
    publishReceipt: null as PublishReceipt | null,
    onPublished: vi.fn(),
    ...overrides,
  }
}

/** The component reads res.text() so it can tell JSON from a proxy's HTML. */
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function mockFetch(...responses: unknown[]) {
  const fn = vi.fn()
  for (const body of responses) fn.mockResolvedValueOnce(jsonResponse(body))
  fn.mockResolvedValue(jsonResponse({ success: true }))
  global.fetch = fn as never
  return fn
}

const DRY_RUN_BODY = {
  success: true,
  status: 'DRY_RUN',
  would_publish: [
    { date: '2026-09-03', idempotency_key: 'fbpost_a', message_preview: 'Hook 1 …', cta_url: 'https://ctstours.co.nz/x' },
    { date: '2026-09-04', idempotency_key: 'fbpost_b', message_preview: 'Hook 2 …', cta_url: 'https://ctstours.co.nz/x' },
  ],
  already_published: [],
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body)
}

async function clickDryRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /试发布/ }))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('publish panel — the unsafe action is never the first one available', () => {
  it('offers only the read-only check before anything has been run', () => {
    mockFetch()
    render(<CampaignDailyPublishPanel {...props()} />)

    expect(screen.getByRole('button', { name: /试发布/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /确认发布/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /确定，发/ })).toBeNull()
  })

  it('disables even the check when the client has no registered Page', () => {
    render(<CampaignDailyPublishPanel {...props({ facebookPageId: null })} />)

    expect(screen.getByRole('button', { name: /试发布/ })).toBeDisabled()
    expect(screen.getByText(/还没登记 Facebook 主页/)).toBeTruthy()
  })

  it('disables the check until the reviewed-and-queued receipt exists', () => {
    render(<CampaignDailyPublishPanel {...props({ queueReceiptReady: false })} />)

    expect(screen.getByRole('button', { name: /试发布/ })).toBeDisabled()
  })

  it('disables the check when the plan identity is incomplete', () => {
    render(<CampaignDailyPublishPanel {...props({ planId: null })} />)

    expect(screen.getByRole('button', { name: /试发布/ })).toBeDisabled()
  })
})

describe('publish panel — the dry run publishes nothing', () => {
  it('sends no_publish true and every identity field the API demands', async () => {
    const fetchMock = mockFetch(DRY_RUN_BODY)
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/publish`)
    expect(bodyOf(fetchMock, 0)).toEqual({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      approved: true,
      publish_authorization: true,
      no_publish: true,
    })
  })

  it('shows what would go out and says plainly that nothing was published', async () => {
    mockFetch(DRY_RUN_BODY)
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()

    expect(screen.getByText(/会发 2 条/)).toBeTruthy()
    expect(screen.getByText(/这一步没有发布任何东西/)).toBeTruthy()
    expect(screen.getByText(/Hook 1/)).toBeTruthy()
  })

  it('reports an API refusal instead of pretending it succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'PAGE_ID_MISMATCH' }, 409)
    ) as never
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()

    expect(screen.getByText(/HTTP 409 · PAGE_ID_MISMATCH/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认发布/ })).toBeNull()
  })
})

describe('publish panel — going live costs two deliberate clicks', () => {
  it('does not publish when the confirm button is merely revealed', async () => {
    const fetchMock = mockFetch(DRY_RUN_BODY)
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))

    expect(screen.getByText(/发出去就撤不回来了/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends one live request per Post, each scoped to its own date', async () => {
    const onPublished = vi.fn()
    const fetchMock = mockFetch(DRY_RUN_BODY)
    render(<CampaignDailyPublishPanel {...props({ onPublished })} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确定，发/ }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(bodyOf(fetchMock, 1)).toMatchObject({ no_publish: false, dates: ['2026-09-03'] })
    expect(bodyOf(fetchMock, 2)).toMatchObject({ no_publish: false, dates: ['2026-09-04'] })
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('stops at the first failing Post and names the date instead of firing the rest', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(DRY_RUN_BODY))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'PAGE_TOKEN_UNAVAILABLE' }, 502))
    global.fetch = fetchMock as never
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确定，发/ }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/2026-09-03 没发出去，已停下.*PAGE_TOKEN_UNAVAILABLE/)).toBeTruthy()
  })

  it('reports the status code when a proxy answers with HTML instead of JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(DRY_RUN_BODY))
      .mockResolvedValueOnce({
        ok: false,
        status: 524,
        text: async () => '<!DOCTYPE html><html><body><h1>A timeout occurred</h1></body></html>',
      })
    global.fetch = fetchMock as never
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确定，发/ }))
    })

    expect(screen.getByText(/HTTP 524/)).toBeTruthy()
    expect(screen.getByText(/返回了一个网页/)).toBeTruthy()
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })

  it('cancelling backs all the way out without publishing', async () => {
    const fetchMock = mockFetch(DRY_RUN_BODY)
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))

    expect(screen.queryByText(/发出去就撤不回来了/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('offers no publish button when the dry run says there is nothing left to send', async () => {
    mockFetch({ ...DRY_RUN_BODY, would_publish: [], already_published: [{ date: '2026-09-03' }] })
    render(<CampaignDailyPublishPanel {...props()} />)

    await clickDryRun()

    expect(screen.getByText(/跳过 1 条/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认发布/ })).toBeNull()
  })

  it('still refreshes the receipt when a later Post fails after an earlier one succeeded', async () => {
    const onPublished = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(DRY_RUN_BODY))
      .mockResolvedValueOnce(jsonResponse({ success: true, status: 'PUBLISHED' }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'PUBLISH_RECEIPT_NOT_PERSISTED' }, 500))
    global.fetch = fetchMock as never
    render(<CampaignDailyPublishPanel {...props({ onPublished })} />)

    await clickDryRun()
    fireEvent.click(screen.getByRole('button', { name: /确认发布这 2 条/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确定，发/ }))
    })

    expect(screen.getByText(/2026-09-04 没发出去/)).toBeTruthy()
    expect(onPublished).toHaveBeenCalledTimes(1)
  })
})

describe('publish panel — what it calls published comes from the receipt', () => {
  const receipt: PublishReceipt = {
    status: 'PARTIAL',
    page_id: PAGE_ID,
    created_at: '2026-09-03T06:00:00.000Z',
    published: [{
      date: '2026-09-03',
      idempotency_key: 'fbpost_a',
      post_id: `${PAGE_ID}_91`,
      page_id: PAGE_ID,
      published_at: '2026-09-03T06:00:00.000Z',
      permalink: `https://www.facebook.com/${PAGE_ID}_91`,
    }],
    failed: [{ date: '2026-09-04', error: 'image url unreachable', failed_at: '2026-09-03T06:00:01.000Z' }],
  }

  it('shows the real post id and a working link', () => {
    render(<CampaignDailyPublishPanel {...props({ publishReceipt: receipt })} />)

    expect(screen.getByText(new RegExp(`${PAGE_ID}_91`))).toBeTruthy()
    expect(screen.getByRole('link', { name: /在 Facebook 上打开/ }).getAttribute('href'))
      .toBe(`https://www.facebook.com/${PAGE_ID}_91`)
    expect(screen.getByText(/已发 1 条/)).toBeTruthy()
  })

  it('does not hide the date that failed', () => {
    render(<CampaignDailyPublishPanel {...props({ publishReceipt: receipt })} />)

    expect(screen.getByText(/09-04 没发出去：image url unreachable/)).toBeTruthy()
  })
})

/**
 * Gate B/3 — Tune 建议 useEffect 集成断言。
 *
 * 魏征 #9 指出：原 16 测试的 publishReceipt 大多为 null，publishedPosts=[]，
 * useEffect 从未被触发，"全过 ≠ 我没破坏"。这两条锁住 published 状态下的行为。
 */
describe('publish panel — Tune 建议 fetch 行为', () => {
  const publishedReceipt: PublishReceipt = {
    status: 'PARTIAL',
    page_id: PAGE_ID,
    created_at: '2026-09-03T06:00:00.000Z',
    published: [{
      date: '2026-09-03',
      idempotency_key: 'fbpost_a',
      post_id: `${PAGE_ID}_91`,
      page_id: PAGE_ID,
      published_at: '2026-09-03T06:00:00.000Z',
      permalink: `https://www.facebook.com/${PAGE_ID}_91`,
    }],
    failed: [],
  }

  it('有 published 帖子时会 fetch tune-suggestions endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, suggestions: { [`${PAGE_ID}_91`]: null } }),
    )
    global.fetch = fetchMock as never

    await act(async () => {
      render(<CampaignDailyPublishPanel {...props({ publishReceipt: publishedReceipt })} />)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/clients/${CLIENT_ID}/campaign-daily-plan/tune-suggestions?campaign_id=${CAMPAIGN_ID}`),
        expect.objectContaining({ cache: 'no-store' }),
      )
    })
  })

  it('🔴 建议按 idempotency_key 取，不按 post_id —— 排期帖回执里的照片编号跟建议的帖子编号对不上', async () => {
    const scheduledReceipt: PublishReceipt = {
      ...publishedReceipt,
      published: [{
        date: '2026-09-03',
        idempotency_key: 'fbpost_a',
        post_id: '1750835520181969',
        page_id: PAGE_ID,
        published_at: '2026-09-03T06:00:00.000Z',
        permalink: 'https://www.facebook.com/1750835520181969',
      }],
    }
    // This effect reads `res.json()` (not `text()` like the publish calls), so answer with a real Response.
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({
      success: true,
      suggestions: {
        fbpost_a: {
          decision: 'REPEAT',
          rationale: '本条明显比同类历史好',
          primaryMetric: 'likes',
          targetValue: 20,
          cohortMean: 10,
          deltaPct: 100,
          sampleSize: 3,
          caveats: [],
          sourceActionIds: ['a1'],
          thresholdsUsed: { minSampleSize: 3, repeatDeltaPct: 30, stopDeltaPct: -30 },
        },
      },
    }))
    global.fetch = fetchMock as never

    await act(async () => {
      render(<CampaignDailyPublishPanel {...props({ publishReceipt: scheduledReceipt })} />)
    })

    await waitFor(() => {
      expect(screen.getByText(/值得再做一次/)).toBeTruthy()
    })
    expect(screen.queryByText(/等 T\+72/)).toBeNull()
  })

  it('fetch 500 → 显示「暂时读不到」，绝不显示「等 T+72」', async () => {
    // PITFALLS「读失败别显示空输入框」：500 不能伪装成「未到点」。
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => '{"success":false}',
    })
    global.fetch = fetchMock as never

    await act(async () => {
      render(<CampaignDailyPublishPanel {...props({ publishReceipt: publishedReceipt })} />)
    })

    await waitFor(() => {
      expect(screen.getByText(/暂时读不到/)).toBeTruthy()
    })
    expect(screen.queryByText(/等 T\+72/)).toBeNull()
  })

  it('fetch 抛异常（网络断）→ 也走「暂时读不到」', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    global.fetch = fetchMock as never

    await act(async () => {
      render(<CampaignDailyPublishPanel {...props({ publishReceipt: publishedReceipt })} />)
    })

    await waitFor(() => {
      expect(screen.getByText(/暂时读不到/)).toBeTruthy()
    })
  })

  it('无 publishedPosts 时不 fetch tune-suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    global.fetch = fetchMock as never

    await act(async () => {
      render(<CampaignDailyPublishPanel {...props({ publishReceipt: null })} />)
    })
    // 无 publishedPosts 时 useEffect 立即 return，不 fetch。
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
