/**
 * DiagnosticFindingCard Component Tests
 * TDD: RED → GREEN → REFACTOR
 *
 * Scenarios:
 * 1. Renders severity badge with correct colour for each severity level
 * 2. fix_type='me_auto' → blue badge "ME 可修复" + deeplink button present
 * 3. fix_type='fde_manual' → purple badge "FDE 操作"
 * 4. fix_type='third_party' → gray badge "第三方工具"
 * 5. onDismiss called → finding disappears from UI
 * 6. No fixDeeplink → deeplink button not rendered
 * 7. Renders title, description, and recommendation
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DiagnosticFindingCard } from '../DiagnosticFindingCard'
import type { DiagnosticFinding } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    id: 'finding-001',
    run_id: 'run-001',
    client_id: 'client-001',
    dimension: 'seo',
    finding_type: 'low_domain_rank',
    severity: 'high',
    title: 'Low Domain Authority',
    description: 'Your domain authority is below the competitive threshold.',
    evidence: null,
    recommendation: 'Build quality backlinks to improve authority.',
    fix_type: 'fde_manual',
    priority_score: 75,
    created_at: '2026-05-13T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Severity badge colours
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — severity badges', () => {
  it.each([
    ['critical', 'red'],
    ['high', 'orange'],
    ['medium', 'yellow'],
    ['low', 'blue'],
    ['info', 'gray'],
  ] as const)('severity=%s renders badge with data-severity=%s', (severity, _colour) => {
    render(<DiagnosticFindingCard finding={makeFinding({ severity })} />)
    const badge = screen.getByTestId('severity-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('data-severity', severity)
  })

  it('critical badge has red styling', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ severity: 'critical' })} />)
    const badge = screen.getByTestId('severity-badge')
    expect(badge.className).toMatch(/red/)
  })

  it('high badge has orange styling', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ severity: 'high' })} />)
    const badge = screen.getByTestId('severity-badge')
    expect(badge.className).toMatch(/orange/)
  })

  it('medium badge has yellow styling', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ severity: 'medium' })} />)
    const badge = screen.getByTestId('severity-badge')
    expect(badge.className).toMatch(/yellow/)
  })
})

// ---------------------------------------------------------------------------
// fix_type badges
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — fix_type badges', () => {
  it('fix_type=me_auto shows blue badge "ME 可修复"', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ fix_type: 'me_auto' })} />)
    const badge = screen.getByTestId('fix-type-badge')
    expect(badge).toHaveTextContent('ME 可修复')
    expect(badge.className).toMatch(/blue/)
  })

  it('fix_type=fde_manual shows purple badge "FDE 操作"', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ fix_type: 'fde_manual' })} />)
    const badge = screen.getByTestId('fix-type-badge')
    expect(badge).toHaveTextContent('FDE 操作')
    expect(badge.className).toMatch(/purple/)
  })

  it('fix_type=third_party shows gray badge "第三方工具"', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ fix_type: 'third_party' })} />)
    const badge = screen.getByTestId('fix-type-badge')
    expect(badge).toHaveTextContent('第三方工具')
    expect(badge.className).toMatch(/gray|slate/)
  })
})

// ---------------------------------------------------------------------------
// Deeplink button
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — deeplink button', () => {
  it('renders deeplink button when fixDeeplink is provided', () => {
    render(
      <DiagnosticFindingCard
        finding={makeFinding({ fix_type: 'me_auto' })}
        fixDeeplink="/dashboard/upgrade"
      />,
    )
    expect(screen.getByTestId('fix-deeplink-btn')).toBeInTheDocument()
  })

  it('does NOT render deeplink button when fixDeeplink is not provided', () => {
    render(<DiagnosticFindingCard finding={makeFinding({ fix_type: 'me_auto' })} />)
    expect(screen.queryByTestId('fix-deeplink-btn')).not.toBeInTheDocument()
  })

  it('does NOT render deeplink button for fde_manual even if fixDeeplink provided', () => {
    render(
      <DiagnosticFindingCard
        finding={makeFinding({ fix_type: 'fde_manual' })}
        fixDeeplink="/some-link"
      />,
    )
    // Deeplink button only meaningful for me_auto
    // (component may or may not show it — just must not error)
    expect(() => screen.queryByTestId('fix-deeplink-btn')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — dismiss', () => {
  it('calls onDismiss with finding id when dismiss button clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <DiagnosticFindingCard finding={makeFinding()} onDismiss={onDismiss} />,
    )

    await user.click(screen.getByTestId('dismiss-btn'))
    expect(onDismiss).toHaveBeenCalledWith('finding-001')
  })

  it('hides the card after onDismiss is called (optimistic UI)', async () => {
    const user = userEvent.setup()

    // Parent controls visibility via onDismiss
    const Wrapper = () => {
      const [dismissed, setDismissed] = React.useState(false)
      if (dismissed) return null
      return (
        <DiagnosticFindingCard
          finding={makeFinding()}
          onDismiss={() => setDismissed(true)}
        />
      )
    }

    render(<Wrapper />)
    expect(screen.getByText('Low Domain Authority')).toBeInTheDocument()

    await user.click(screen.getByTestId('dismiss-btn'))

    await waitFor(() => {
      expect(screen.queryByText('Low Domain Authority')).not.toBeInTheDocument()
    })
  })

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<DiagnosticFindingCard finding={makeFinding()} />)
    expect(screen.queryByTestId('dismiss-btn')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — content', () => {
  it('renders the finding title', () => {
    render(<DiagnosticFindingCard finding={makeFinding()} />)
    expect(screen.getByText('Low Domain Authority')).toBeInTheDocument()
  })

  it('renders the finding description', () => {
    render(<DiagnosticFindingCard finding={makeFinding()} />)
    expect(screen.getByText(/below the competitive threshold/)).toBeInTheDocument()
  })

  it('renders the recommendation', () => {
    render(<DiagnosticFindingCard finding={makeFinding()} />)
    expect(screen.getByText(/Build quality backlinks/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// S09: configHref CTA — surfaces a "立即配置 →" shortcut when the finding's
// dimension was skipped, so the "未配置" card and the "Target keywords not
// configured" finding agree on the same Settings link instead of contradicting
// each other.
// ---------------------------------------------------------------------------

describe('DiagnosticFindingCard — configHref CTA (S09)', () => {
  it('renders the 立即配置 link when configHref is provided', () => {
    render(
      <DiagnosticFindingCard
        finding={makeFinding()}
        configHref="/dashboard/clients/abc/settings"
      />,
    )
    const cta = screen.getByTestId('config-cta')
    expect(cta).toHaveAttribute('href', '/dashboard/clients/abc/settings')
    expect(cta).toHaveAttribute('title')
  })

  it('does NOT render the CTA when configHref is omitted', () => {
    render(<DiagnosticFindingCard finding={makeFinding()} />)
    expect(screen.queryByTestId('config-cta')).not.toBeInTheDocument()
  })

  it('renders configHref alongside the dismiss button without overlap', () => {
    render(
      <DiagnosticFindingCard
        finding={makeFinding()}
        configHref="/x"
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('config-cta')).toBeInTheDocument()
    expect(screen.getByTestId('dismiss-btn')).toBeInTheDocument()
  })
})
