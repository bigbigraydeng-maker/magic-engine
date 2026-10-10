import { describe, expect, it } from 'vitest'
import {
  DAILY_PLAN_UTM_CAMPAIGN,
  buildDailyPlanAutoChecks,
  buildDailyPlanFirstComment,
  buildDailyPlanPostMessage,
  dailyPlanContentId,
  dailyPlanPostLeaksCta,
  type DailyPlanFirstCommentPost,
} from './daily-plan-first-comment'

const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const DATE = '2026-10-08'
const CONTENT_ID = 'b0000000-2026-10-08'

const post: DailyPlanFirstCommentPost = {
  hook: 'Christmas Eve in Shanghai',
  body: 'Our 16-day tour departs 22 Dec 2026.',
  cta: 'Send an enquiry →',
  cta_url:
    'https://www.ctstours.co.nz/tours/china/discovery/china-icons-collection?utm_source=facebook&utm_medium=organic_social&utm_campaign=cts_christmas_dailyplan_2026',
}

function withBody(body: string): DailyPlanFirstCommentPost {
  return { ...post, body }
}

describe('dailyPlanContentId', () => {
  it('strips dashes, takes the first 8 chars, and appends the date', () => {
    expect(dailyPlanContentId(PLAN_ID, DATE)).toBe(CONTENT_ID)
  })
})

describe('buildDailyPlanFirstComment', () => {
  it('builds text as cta newline trackedUrl', () => {
    const result = buildDailyPlanFirstComment({ cta: post.cta, ctaUrl: post.cta_url, planId: PLAN_ID, date: DATE })
    expect(result).not.toBeNull()
    expect(result!.text).toBe(`${post.cta}\n${result!.trackedUrl}`)
  })

  it('preserves an existing utm_campaign and sets utm_content', () => {
    const result = buildDailyPlanFirstComment({ cta: post.cta, ctaUrl: post.cta_url, planId: PLAN_ID, date: DATE })
    const url = new URL(result!.trackedUrl)
    expect(url.searchParams.get('utm_campaign')).toBe('cts_christmas_dailyplan_2026')
    expect(url.searchParams.get('utm_content')).toBe(CONTENT_ID)
  })

  it('falls back to the daily plan campaign when none is present', () => {
    const result = buildDailyPlanFirstComment({
      cta: post.cta,
      ctaUrl: 'https://www.ctstours.co.nz/tours/china',
      planId: PLAN_ID,
      date: DATE,
    })
    const url = new URL(result!.trackedUrl)
    expect(url.searchParams.get('utm_campaign')).toBe(DAILY_PLAN_UTM_CAMPAIGN)
  })

  it('returns null for an empty cta', () => {
    expect(buildDailyPlanFirstComment({ cta: '   ', ctaUrl: post.cta_url, planId: PLAN_ID, date: DATE })).toBeNull()
  })

  it('returns null for an insecure http url', () => {
    expect(
      buildDailyPlanFirstComment({ cta: post.cta, ctaUrl: 'http://insecure.example/x', planId: PLAN_ID, date: DATE }),
    ).toBeNull()
  })

  it('returns null for an unparseable url', () => {
    expect(
      buildDailyPlanFirstComment({ cta: post.cta, ctaUrl: 'not a url', planId: PLAN_ID, date: DATE }),
    ).toBeNull()
  })
})

describe('buildDailyPlanPostMessage', () => {
  it('joins hook and body with a blank line', () => {
    expect(buildDailyPlanPostMessage(post)).toBe(`${post.hook}\n\n${post.body}`)
  })

  it('trims and drops empty parts', () => {
    expect(buildDailyPlanPostMessage({ hook: '  Hook  ', body: '   ' })).toBe('Hook')
    expect(buildDailyPlanPostMessage({ hook: '', body: 'Body' })).toBe('Body')
  })

  it('never contains the CTA text', () => {
    expect(buildDailyPlanPostMessage(post)).not.toContain(post.cta)
  })
})

describe('dailyPlanPostLeaksCta', () => {
  it('is false for the clean fixture', () => {
    expect(dailyPlanPostLeaksCta(post)).toBe(false)
  })

  it.each([
    ['https://x.test/a'],
    ['WWW.ctstours.co.nz'],
    ['ctstours.co.nz/tours'],
    ['utm_source=facebook'],
    ['bit.ly/abc'],
    ['Send an ENQUIRY'],
    ['Send an enquiry!'],
    ['ｈｔｔｐｓ：／／example.com'],
    ['book at example.com.au'],
    ['https%3A%2F%2Fx.test'],
  ])('is true when the body contains %s', body => {
    expect(dailyPlanPostLeaksCta(withBody(body))).toBe(true)
  })
})

describe('buildDailyPlanAutoChecks', () => {
  it('passes both checks for the clean fixture', () => {
    const checks = buildDailyPlanAutoChecks({ post, planId: PLAN_ID, date: DATE })
    expect(checks).toHaveLength(2)
    expect(checks[0].key).toBe('cta_in_first_comment_not_body')
    expect(checks[0].judge).toBe('AUTO')
    expect(checks[0].outcome).toBe('PASS')
    expect(checks[0].source_ref).toBeNull()
    expect(checks[1].key).toBe('first_comment_link_has_tracking_params')
    expect(checks[1].judge).toBe('AUTO')
    expect(checks[1].outcome).toBe('PASS')
    expect(checks[1].source_ref).toBeNull()
  })

  it('fails the first check but passes tracking when the body leaks', () => {
    const checks = buildDailyPlanAutoChecks({ post: withBody('See https://x.test/a'), planId: PLAN_ID, date: DATE })
    expect(checks[0].outcome).toBe('FAIL')
    expect(checks[1].outcome).toBe('PASS')
  })

  it('fails both checks for an invalid cta_url', () => {
    const checks = buildDailyPlanAutoChecks({
      post: { ...post, cta_url: 'not a url' },
      planId: PLAN_ID,
      date: DATE,
    })
    expect(checks[0].outcome).toBe('FAIL')
    expect(checks[1].outcome).toBe('FAIL')
  })
})
