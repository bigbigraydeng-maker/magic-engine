/**
 * Tests for the email digest decision + body — P21.K.4
 *
 * The decision logic is the anti-fatigue heart: green must NOT nag daily, but a
 * real alert or a recovery must always send. The body must lead with the
 * conclusion and never bury the action items.
 */

import { describe, it, expect } from 'vitest'
import { decideSend, buildSubject, buildBody, describeSendError } from '../digest'

describe('decideSend — green is de-frequenced, alerts always send', () => {
  it('always sends on alert', () => {
    expect(decideSend('alert', 'healthy', false)).toBe('alert')
    expect(decideSend('alert', 'alert', false)).toBe('alert')
  })

  it('always sends on watch', () => {
    expect(decideSend('watch', 'healthy', false)).toBe('watch')
  })

  it('sends when recovering from a bad state (good news is a state change)', () => {
    expect(decideSend('healthy', 'alert', false)).toBe('recovery')
    expect(decideSend('healthy', 'watch', false)).toBe('recovery')
  })

  it('does NOT nag with daily green when it was already healthy', () => {
    expect(decideSend('healthy', 'healthy', false)).toBe('skip')
    expect(decideSend('healthy', null, false)).toBe('skip')
  })

  it('sends a weekly summary when healthy on the weekly day', () => {
    expect(decideSend('healthy', 'healthy', true)).toBe('weekly_healthy')
  })

  it('skips entirely when there is not enough history to judge', () => {
    expect(decideSend('insufficient_history', null, true)).toBe('skip')
    expect(decideSend('insufficient_history', 'healthy', false)).toBe('skip')
  })

  it('never emails on an unexpected verdict value', () => {
    // Defensive: a garbage verdict must not fall through to a green send.
    expect(decideSend('nonsense' as never, null, true)).toBe('skip')
  })
})

describe('buildSubject — PM can triage from the subject line', () => {
  it('flags alerts loudly', () => {
    expect(buildSubject('CTS', '2026-07-20', 'alert')).toContain('🔴')
    expect(buildSubject('CTS', '2026-07-20', 'alert')).toContain('CTS')
  })

  it('marks weekly-healthy as green', () => {
    expect(buildSubject('CTS', '2026-07-20', 'weekly_healthy')).toContain('🟢')
  })
})

const alertPayload = {
  overall_verdict: 'alert' as const,
  headline: '1 条广告该动手了',
  evaluated: 3,
  generated_for: '2026-07-20',
  campaigns: [
    { campaign_name: 'Reborn', verdict: 'alert' as const, headline: '点击率比自身最好一周低 28%', latest_spend_7d: 529, latest_results_7d: 42 },
    { campaign_name: 'Retargeting', verdict: 'healthy' as const, headline: '健康', latest_spend_7d: 200, latest_results_7d: 40 },
    { campaign_name: 'ThruPlay', verdict: 'healthy' as const, headline: '健康', latest_spend_7d: 120, latest_results_7d: 0 },
  ],
}

describe('buildBody — inverted pyramid, only exceptions up top', () => {
  it('leads with the conclusion and lists only the campaigns needing action', () => {
    const html = buildBody(alertPayload, 'alert', 'https://x')
    expect(html).toContain('今天有 1 件事')
    expect(html).toContain('Reborn')
    expect(html).toContain('点击率比自身最好一周低 28%')
    // The healthy campaigns are summarised, not itemised.
    expect(html).not.toContain('Retargeting')
    expect(html).toContain('其余 2 条广告健康')
  })

  it('shows cost-per-lead only when there are results', () => {
    const html = buildBody(alertPayload, 'alert', 'https://x')
    // Reborn: 529 / 42 = $12.6
    expect(html).toContain('每个询盘 $12.6')
  })

  it('collapses an all-healthy weekly summary to a single reassuring line', () => {
    const healthy = { ...alertPayload, overall_verdict: 'healthy' as const, campaigns: [] }
    const html = buildBody(healthy, 'weekly_healthy', 'https://x')
    expect(html).toContain('持续健康')
    expect(html).not.toContain('件事')
  })

  it('does NOT count paused campaigns as healthy (the PR #631 lie, email exit)', () => {
    // Oztop scenario: 1 alert + 2 healthy + 5 paused. The old copy said
    // "其余 7 条广告健康" — 5 of them were stopped.
    const withPaused = {
      ...alertPayload,
      evaluated: 8,
      campaigns: [
        ...alertPayload.campaigns,
        ...Array.from({ length: 5 }, (_, i) => ({
          campaign_name: `Stopped-${i}`, verdict: 'paused' as const,
          headline: '已停投', latest_spend_7d: 0, latest_results_7d: 0,
        })),
      ],
    }
    const html = buildBody(withPaused, 'alert', 'https://x')
    expect(html).toContain('其余 2 条广告健康')
    expect(html).not.toContain('其余 7 条')
    expect(html).toContain('另 5 条已停投')
  })

  it('counts only active campaigns in the weekly-healthy lead', () => {
    const mixed = {
      ...alertPayload,
      overall_verdict: 'healthy' as const,
      campaigns: [
        { campaign_name: 'Live', verdict: 'healthy' as const, headline: '健康', latest_spend_7d: 100, latest_results_7d: 5 },
        { campaign_name: 'Stopped', verdict: 'paused' as const, headline: '已停投', latest_spend_7d: 0, latest_results_7d: 0 },
      ],
    }
    const html = buildBody(mixed, 'weekly_healthy', 'https://x')
    expect(html).toContain('在投的 1 条广告持续健康')
    expect(html).toContain('另 1 条已停投')
  })

  it('escapes campaign names to prevent HTML injection in the email', () => {
    const evil = {
      ...alertPayload,
      campaigns: [{ campaign_name: '<script>x</script>', verdict: 'alert' as const, headline: 'h', latest_spend_7d: 10, latest_results_7d: 1 }],
    }
    const html = buildBody(evil, 'alert', 'https://x')
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('describeSendError — a failed send must say WHY', () => {
  it('renders the Resend error object instead of "[object Object]"', () => {
    // The real 2026-07-23 shape: a plain object, not an Error. String() on it
    // produced "[object Object]" and cost us the only diagnosis we had.
    const out = describeSendError({
      statusCode: 403,
      name: 'validation_error',
      message: 'You can only send testing emails to your own email address',
    })
    expect(out).not.toContain('[object Object]')
    expect(out).toContain('403')
    expect(out).toContain('validation_error')
    expect(out).toContain('own email address')
  })

  it('falls back to JSON for an unexpected error shape', () => {
    expect(describeSendError({ weird: 'shape' })).toBe('{"weird":"shape"}')
  })

  it('still handles strings and Errors', () => {
    expect(describeSendError('boom')).toBe('boom')
    expect(describeSendError(new Error('kaboom'))).toContain('kaboom')
  })
})
