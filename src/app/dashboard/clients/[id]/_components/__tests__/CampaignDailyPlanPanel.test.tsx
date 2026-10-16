/**
 * CampaignDailyPlanPanel — 7-day remediation (Build Control comment 5394505714).
 *
 * Ray's original Ray Experience FAIL: six of seven days looked empty even
 * though the API always only ever exposed one "current" bundle, and the
 * Post copy was truncated with no way to read the full text. These tests
 * lock down the fix at the component level: date selection actually swaps
 * the three formats shown, Post can be expanded/collapsed, and a day that
 * is PLANNED but has no bundle fails honestly instead of quietly reusing
 * whatever was already on screen.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CampaignDailyPlanPanel } from '../CampaignDailyPlanPanel'

// The auto-publish section reads its own status endpoint on mount. These tests script the panel's fetch
// sequence call by call, so that section is stubbed here and exercised in its own test file.
const autoPublishProps = vi.fn()
vi.mock('../CampaignDailyAutoPublishPanel', () => ({
  CampaignDailyAutoPublishPanel: (props: Record<string, unknown>) => {
    autoPublishProps(props)
    return null
  },
}))

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'campaign-uuid'

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    master_brief_grounding: true,
    campaign_grounding: true,
    evidence_grounding: 'UNKNOWN',
    client_asset_provenance: false,
    format_completeness: { post: true, story: true, reel: true },
    human_approval: false,
    provider_authorization: false,
    publishing_authorization: false,
    performance_outcome: 'UNKNOWN',
    ...overrides,
  }
}

function daysGrid(plannedDates: string[]) {
  const all = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
  return all.map(date => ({
    date,
    slots: {
      post: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      story: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      reel: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
    },
  }))
}

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CampaignDailyPlanPanel — date selection shows that day\'s three formats', () => {
  it('selecting a later populated day swaps Post/Story away from Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24', '2026-08-26']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook text', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
        {
          date: '2026-08-26',
          post: { hook: 'Day 3 hook text', body: 'Day 3 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 3 frame' }] },
          reel: { brief: 'Day 3 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook text')
    expect(screen.queryByText('Day 3 hook text')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('08-26'))

    await screen.findByText('Day 3 hook text')
    expect(screen.queryByText('Day 1 hook text')).not.toBeInTheDocument()
    expect(screen.queryByText('Day 3 frame')).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — Post full text can be expanded and collapsed', () => {
  it('shows a 展开全文/收起 toggle that reveals and hides the full Post body', async () => {
    const longBody = 'A '.repeat(80) + 'end of the long post body.'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: longBody, cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'frame' }] },
          reel: { brief: 'brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('展开全文')
    fireEvent.click(screen.getByText('展开全文'))
    expect(screen.getByText('收起')).toBeInTheDocument()
    fireEvent.click(screen.getByText('收起'))
    expect(screen.getByText('展开全文')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — missing bundle fails honestly, never borrows another day', () => {
  it('shows NOT_PLANNED for a day marked PLANNED in the grid but absent from bundles, instead of showing Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      // days[] claims 08-25 is PLANNED (a data-shape mismatch), but no
      // matching entry exists in bundles — the UI must not paper over this.
      days: daysGrid(['2026-08-24', '2026-08-25']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook')

    fireEvent.click(screen.getByText('08-25'))

    await screen.findAllByText(/该日暂无排定内容/) // both the bundle and readiness sections honestly say so
    expect(screen.queryByText('Day 1 hook')).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — seven distinct Post thumbnails + clickable CTA (Ray remediation 5405438962)', () => {
  it('renders each day\'s own post_image thumbnail (unique preview URLs) and an anchor with the exact CTA URL', async () => {
    const dates = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
    const CTA = 'https://www.ctstours.co.nz/tours/china/discovery/china-icons-collection'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(dates),
      bundles: dates.map((d, i) => ({
        date: d,
        post: { hook: `Day ${i + 1} hook`, body: `Day ${i + 1} body`, cta: 'Enquire Now', image_asset_id: `asset-${i}`, cta_url: CTA },
        story: { frames: [{ order: 1, copy: `f${i}` }, { order: 2, copy: `f${i}` }, { order: 3, copy: `f${i}` }, { order: 4, copy: `f${i}` }] },
        reel: { brief: `r${i}`, script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
        readiness: readiness(),
        provenance: [],
        post_image: {
          id: `asset-${i}`,
          preview_url: `https://cts-assets.test/day${i}.jpg`,
          filename: `day${i}.jpg`,
          source: 'client_provided',
          ownership: 'client_exclusive',
        },
      })),
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Day 1: correct thumbnail src + Enquire Now anchor with the exact CTA URL.
    await screen.findByText('Day 1 hook')
    const day1Img = document.querySelector('img[alt="day0.jpg"]') as HTMLImageElement | null
    expect(day1Img).not.toBeNull()
    expect(day1Img!.src).toBe('https://cts-assets.test/day0.jpg')
    const day1Cta = document.querySelector('a[href="' + CTA + '"]') as HTMLAnchorElement | null
    expect(day1Cta).not.toBeNull()
    expect(day1Cta!.target).toBe('_blank')
    expect(day1Cta!.rel).toBe('noopener noreferrer')

    // Switch to Day 4: thumbnail must be a DIFFERENT src.
    fireEvent.click(screen.getByText('08-27'))
    await screen.findByText('Day 4 hook')
    const day4Img = document.querySelector('img[alt="day3.jpg"]') as HTMLImageElement | null
    expect(day4Img).not.toBeNull()
    expect(day4Img!.src).toBe('https://cts-assets.test/day3.jpg')
    expect(day4Img!.src).not.toBe('https://cts-assets.test/day0.jpg')
  })
})

describe('CampaignDailyPlanPanel — Reel readiness is script-only, media_status stays separate (Build Control TRUTHFUL READINESS)', () => {
  it('shows "Reel 脚本草稿完整" (not "Reel 草稿完整") AND still shows 暂无成片 for a NO_MEDIA Reel', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: 'body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'f1' }, { order: 2, copy: 'f2' }, { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' }] },
          reel: { brief: 'the reel brief', script: 'the script', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness({ format_completeness: { post: true, story: true, reel: true } }),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Script-complete label, not the old "Reel 草稿完整".
    await screen.findByText('Reel 脚本草稿完整')
    expect(screen.queryByText('Reel 草稿完整')).not.toBeInTheDocument()
    // The Reel script is no longer shown in the Post view; the card only
    // points to the dedicated Reels tab.
    expect(screen.getByText(/Story 和 Reel 不在这里看/)).toBeInTheDocument()
    const reelsLink = screen.getByRole('link', { name: '短视频' })
    expect(reelsLink).toHaveAttribute('href', '?tab=reels')
    expect(screen.queryByText(/暂无成片/)).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — Reel card points to the Reels tab only', () => {
  it('the Reel card only points to the Reels tab and never renders the script', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: 'body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'f1' }] },
          reel: { brief: 'SECRET BRIEF TEXT', script: 'SECRET SCRIPT TEXT', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText(/Story 和 Reel 不在这里看/)
    expect(screen.queryByText('SECRET SCRIPT TEXT')).not.toBeInTheDocument()
    expect(screen.queryByText('SECRET BRIEF TEXT')).not.toBeInTheDocument()
    const reelsLink = screen.getByRole('link', { name: '短视频' })
    expect(reelsLink).toHaveAttribute('href', '?tab=reels')
    expect(screen.getByRole('link', { name: '本周总览' })).toHaveAttribute('href', '?tab=overview')
    expect(screen.queryByText('f1')).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — conversion goal vs publishing destination (Build Control TRUTHFUL READINESS)', () => {
  it('shows lead_form_submit as 转化目标 with a Chinese explainer; destination stays UNKNOWN and never echoes the CTA', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'lead_form_submit' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'h', body: 'b', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'f1' }, { order: 2, copy: 'f2' }, { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' }] },
          reel: { brief: 'br', script: 'sc', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: 'lead_form_submit', destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Conversion goal row surfaces lead_form_submit with a plain-Chinese explainer.
    await screen.findByText(/转化目标/)
    expect(screen.getByText('lead_form_submit')).toBeInTheDocument()
    expect(screen.getByText(/用户在落地页提交表单即算转化/)).toBeInTheDocument()

    // Destination row explicitly says UNKNOWN / 未连接; the primary_cta must
    // NOT be echoed as a destination.
    expect(screen.getByText(/发布目的地/)).toBeInTheDocument()
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
    expect(screen.getByText(/等待发布桥确认，不经旧运营台/)).toBeInTheDocument()

    // Publish authorisation stays NOT_AUTHORIZED.
    expect(screen.getByText('NOT_AUTHORIZED')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — inline Facebook Post review (#1308)', () => {
  function reviewPayload(postReview: null | Record<string, unknown> = null) {
    return {
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'lead_form_submit' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [{
        date: '2026-08-24',
        post: {
          hook: 'Review this Post',
          body: 'Post body',
          cta: 'Enquire Now',
          image_asset_id: 'asset-1',
          cta_url: 'https://example.test/tour',
        },
        story: { frames: [{ order: 1, copy: 'f1' }, { order: 2, copy: 'f2' }, { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' }] },
        reel: { brief: 'brief', script: 'script', caption: 'caption', source_asset_ids: [], media_status: 'NO_MEDIA' },
        readiness: readiness(),
        provenance: [],
        post_image: null,
        post_review: postReview,
      }],
      publishing_plan: { conversion_goal: 'lead_form_submit', destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
      plan_id: 'b0000000-0000-0000-0000-000000000001',
      plan_revision: '2026-09-01T15:00:04.513Z',
      review_revision: postReview ? '10000000-0000-0000-0000-000000000001' : null,
      review_summary: {
        passed: postReview?.verdict === 'PASS' && postReview.is_current !== false ? 1 : 0,
        needs_revision: postReview?.verdict === 'NEEDS_REVISION' ? 1 : 0,
        total: 1,
      },
      publish_queue_receipt: null,
    }
  }

  it('keeps review in the Post card and explicitly separates it from publishing authorization', async () => {
    mockFetchOnce(reviewPayload())

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Facebook Post 审核')
    expect(screen.getByRole('button', { name: 'Post 通过' })).toBeDisabled()
    expect(screen.getByText(/发布后系统会自动在这条帖子的第一条评论里贴/)).toBeInTheDocument()
    expect(screen.getByText('Post 需修改')).toBeInTheDocument()
    expect(screen.getByText(/不代表事实核验、Story\/Reel 通过、生成、排期、Provider 或发布授权/)).toBeInTheDocument()
    expect(screen.getByText('NOT_AUTHORIZED')).toBeInTheDocument()
    expect(screen.queryByText(/Launch Hub/i)).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="/dashboard/content"]')).toBeNull()
  })

  it('shows a read-only Daily Plan publish queue without linking to the legacy content board', async () => {
    mockFetchOnce(reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    }))

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('发布队列 / Publish Queue')
    expect(screen.getByText('Ready 1/1')).toBeInTheDocument()
    expect(screen.getByText('待排期')).toBeInTheDocument()
    expect(screen.getByText('未排期')).toBeInTheDocument()
    expect(screen.getByText('未发布')).toBeInTheDocument()
    expect(screen.getByText(/不写入旧运营台/)).toBeInTheDocument()
    expect(screen.getByText('Facebook Post')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^发布$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^排期$/ })).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="/dashboard/content"]')).toBeNull()
  })

  it('lets a fully passed queue create an Inngest no-publish receipt and reloads the panel', async () => {
    const first = reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    })
    const withReceipt = {
      ...first,
      publish_queue_receipt: {
        event_name: 'daily_plan.publish_queue.ready',
        event_id: 'evt_123',
        status: 'READY_NO_PUBLISH',
        no_publish: true,
        created_at: '2026-09-01T16:00:00.000Z',
        posts: [{
          date: '2026-08-24',
          image_asset_id: 'asset-1',
          cta_url: 'https://example.test/tour',
          review_verdict: 'PASS',
        }],
      },
    }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, changed: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => withReceipt }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: '生成发布准备回执' }))

    await screen.findByText('✓ 发布准备回执已生成')
    expect(screen.getByText('Inngest 已记录')).toBeInTheDocument()
    // the auto-publish section is handed this exact plan's identity and the reviewed dates from the receipt
    const lastProps = autoPublishProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(lastProps).toMatchObject({
      clientId: CLIENT_ID,
      campaignId: CAMPAIGN_ID,
      reviewedDates: ['2026-08-24'],
      queueReceiptReady: true,
    })
    const postCall = vi.mocked(global.fetch).mock.calls[1]
    expect(postCall[0]).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/publish-queue`)
    expect(JSON.parse(postCall[1]!.body as string)).toMatchObject({
      campaign_id: CAMPAIGN_ID,
      plan_id: first.plan_id,
      expected_plan_revision: first.plan_revision,
      expected_review_revision: first.review_revision,
      no_publish: true,
    })
    expect(screen.queryByRole('button', { name: /^发布$/ })).not.toBeInTheDocument()
  })

  it('requires a revision reason, then PATCHes the exact loaded plan and reloads the inline state', async () => {
    const first = reviewPayload()
    const reviewed = reviewPayload({
      verdict: 'NEEDS_REVISION',
      reason: 'Use a stronger opening line',
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, changed: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => reviewed }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    await screen.findByText('Facebook Post 审核')

    expect(screen.getByText('Post 需修改').closest('button')).toBeDisabled()
    expect(global.fetch).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('如需修改，请写明原因'), {
      target: { value: 'Use a stronger opening line' },
    })
    fireEvent.click(screen.getAllByRole('radio', { name: 'FAIL' })[2])
    fireEvent.change(screen.getAllByPlaceholderText('说明未通过原因')[0], {
      target: { value: 'Logo missing' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('来源 HTTPS URL 或 client_asset:<ID>')[0], {
      target: { value: 'https://example.test/source' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('来源 HTTPS URL 或 client_asset:<ID>')[1], {
      target: { value: 'https://example.test/source' },
    })
    fireEvent.click(screen.getByText('Post 需修改'))

    await screen.findByText('上次反馈：Use a stronger opening line')
    expect(global.fetch).toHaveBeenCalledTimes(3)
    const patchCall = vi.mocked(global.fetch).mock.calls[1]
    expect(patchCall[0]).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/post-review`)
    const requestInit = patchCall[1] as RequestInit
    expect(requestInit.method).toBe('PATCH')
    expect(JSON.parse(requestInit.body as string)).toEqual({
      campaign_id: CAMPAIGN_ID,
      plan_id: first.plan_id,
      expected_plan_revision: first.plan_revision,
      expected_review_revision: null,
      date: '2026-08-24',
      verdict: 'NEEDS_REVISION',
      reason: 'Use a stronger opening line',
      checklist_human: [
        { key: 'factual_claims_have_source', judge: 'HUMAN', outcome: 'NOT_MEASURED', detail: null, source_ref: 'https://example.test/source' },
        { key: 'factual_claims_source_verified', judge: 'HUMAN', outcome: 'NOT_MEASURED', detail: null, source_ref: 'https://example.test/source' },
        { key: 'logo_watermark_present', judge: 'HUMAN', outcome: 'FAIL', detail: 'Logo missing', source_ref: null },
        { key: 'asset_provenance_labeled', judge: 'HUMAN', outcome: 'NOT_MEASURED', detail: null, source_ref: null },
        { key: 'asset_provenance_matches_claim_context', judge: 'HUMAN', outcome: 'NOT_MEASURED', detail: null, source_ref: null },
      ],
    })
  })

  it('enables Post 通过 only after all human checks are PASS with sources', async () => {
    mockFetchOnce(reviewPayload())

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    await screen.findByText('Facebook Post 审核')

    const passButton = screen.getByRole('button', { name: 'Post 通过' })
    expect(passButton).toBeDisabled()

    const passRadios = screen.getAllByRole('radio', { name: 'PASS' })
    passRadios.forEach(radio => fireEvent.click(radio))

    // Still disabled: the two factual checks need a source ref.
    expect(screen.getByRole('button', { name: 'Post 通过' })).toBeDisabled()

    const sourceInputs = screen.getAllByPlaceholderText('来源 HTTPS URL 或 client_asset:<ID>')
    fireEvent.change(sourceInputs[0], { target: { value: 'https://example.test/source' } })
    fireEvent.change(sourceInputs[1], { target: { value: 'https://example.test/source' } })

    expect(screen.getByRole('button', { name: 'Post 通过' })).toBeEnabled()
  })

  it('sends verdict PASS with the human checklist', async () => {
    const first = reviewPayload()
    const passed = reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, changed: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => passed }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    await screen.findByText('Facebook Post 审核')

    screen.getAllByRole('radio', { name: 'PASS' }).forEach(radio => fireEvent.click(radio))
    const sourceInputs = screen.getAllByPlaceholderText('来源 HTTPS URL 或 client_asset:<ID>')
    fireEvent.change(sourceInputs[0], { target: { value: 'https://example.test/source' } })
    fireEvent.change(sourceInputs[1], { target: { value: 'https://example.test/source' } })

    fireEvent.click(screen.getByRole('button', { name: 'Post 通过' }))

    await screen.findByText('✓ Post 已通过')
    const patchCall = vi.mocked(global.fetch).mock.calls[1]
    expect(patchCall[0]).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/post-review`)
    const requestInit = patchCall[1] as RequestInit
    expect(requestInit.method).toBe('PATCH')
    const body = JSON.parse(requestInit.body as string)
    expect(body.verdict).toBe('PASS')
    expect(body.checklist_human).toHaveLength(5)
    expect(body.checklist_human.every((item: { outcome: string }) => item.outcome === 'PASS')).toBe(true)
  })

  it('explains an AUTO_CHECKS_FAILED refusal', async () => {
    const first = reviewPayload()
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ success: false, error: 'AUTO_CHECKS_FAILED' }) }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    await screen.findByText('Facebook Post 审核')

    screen.getAllByRole('radio', { name: 'PASS' }).forEach(radio => fireEvent.click(radio))
    const sourceInputs = screen.getAllByPlaceholderText('来源 HTTPS URL 或 client_asset:<ID>')
    fireEvent.change(sourceInputs[0], { target: { value: 'https://example.test/source' } })
    fireEvent.change(sourceInputs[1], { target: { value: 'https://example.test/source' } })

    fireEvent.click(screen.getByRole('button', { name: 'Post 通过' }))

    await screen.findByText(/正文里含有 CTA 或链接/)
  })

  it('shows a persisted PASS as expired when current asset validation no longer holds', async () => {
    mockFetchOnce(reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: false,
    }))

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('已失效，需重审')
    expect(screen.getByText('Post 已通过 0/1')).toBeInTheDocument()
    expect(screen.queryByText('已通过')).not.toBeInTheDocument()
  })

  it('does not display an unusable legacy PASS as current', async () => {
    mockFetchOnce(reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: false,
    }))

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('已失效，需重审')
    expect(screen.getByText('Post 已通过 0/1')).toBeInTheDocument()
    expect(screen.getByText(/发布后系统会自动在这条帖子的第一条评论里贴/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Post 通过/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post 需修改' })).toBeInTheDocument()
  })

  it('one-click review passes a Post with all five checks and the official link as source', async () => {
    const first = reviewPayload()
    const passed = reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, changed: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => passed }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    await screen.findByText('Facebook Post 审核')

    fireEvent.click(screen.getByRole('button', { name: '按官网核对通过' }))

    await screen.findByText('✓ Post 已通过')
    const patchCall = vi.mocked(global.fetch).mock.calls[1]
    expect(patchCall[0]).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/post-review`)
    const requestInit = patchCall[1] as RequestInit
    expect(requestInit.method).toBe('PATCH')
    const body = JSON.parse(requestInit.body as string)
    expect(body.verdict).toBe('PASS')
    expect(body.checklist_human).toHaveLength(5)
    expect(body.checklist_human.every((item: { outcome: string }) => item.outcome === 'PASS')).toBe(true)
    const byKey = Object.fromEntries(
      (body.checklist_human as Array<{ key: string; source_ref: string | null }>).map(item => [item.key, item.source_ref]),
    )
    expect(byKey.factual_claims_have_source).toBe('https://example.test/tour')
    expect(byKey.factual_claims_source_verified).toBe('https://example.test/tour')
    expect(byKey.logo_watermark_present).toBeNull()
    expect(byKey.asset_provenance_labeled).toBeNull()
    expect(byKey.asset_provenance_matches_claim_context).toBeNull()
  })

  it('one-click button is not offered once the Post is passed', async () => {
    mockFetchOnce(reviewPayload({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-01T15:05:00.000Z',
      is_current: true,
    }))

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('✓ Post 已通过')
    expect(screen.queryByRole('button', { name: '按官网核对通过' })).not.toBeInTheDocument()
  })

  it('one-click button is hidden when the Post has no CTA link', async () => {
    const payload = reviewPayload()
    payload.bundles[0].post.cta_url = ''
    mockFetchOnce(payload)

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Facebook Post 审核')
    expect(screen.queryByRole('button', { name: '按官网核对通过' })).not.toBeInTheDocument()
  })

  it('keeps bulk pass unavailable', async () => {
    mockFetchOnce(reviewPayload())

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Facebook Post 审核')
    expect(screen.queryByRole('button', { name: /批量通过未审 Post/ })).not.toBeInTheDocument()
    expect(screen.getByText(/发布后系统会自动在这条帖子的第一条评论里贴/)).toBeInTheDocument()
  })

  it('ignores an old client GET that resolves after the panel switches clients', async () => {
    let resolveOld: ((value: { ok: true; json: () => Promise<unknown> }) => void) | undefined
    const oldResponse = new Promise<{ ok: true; json: () => Promise<unknown> }>(resolve => {
      resolveOld = resolve
    })
    const oldPayload = reviewPayload()
    oldPayload.bundles[0].post.hook = 'OLD CLIENT POST'
    const newPayload = reviewPayload()
    newPayload.bundles[0].post.hook = 'NEW CLIENT POST'
    global.fetch = vi.fn()
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => newPayload }) as unknown as typeof fetch

    const { rerender } = render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    rerender(<CampaignDailyPlanPanel clientId="d0000000-0000-0000-0000-000000000000" campaignId="campaign-new" />)

    await screen.findByText('NEW CLIENT POST')
    await act(async () => {
      resolveOld?.({ ok: true, json: async () => oldPayload })
      await oldResponse
    })

    expect(screen.getByText('NEW CLIENT POST')).toBeInTheDocument()
    expect(screen.queryByText('OLD CLIENT POST')).not.toBeInTheDocument()
  })
})
