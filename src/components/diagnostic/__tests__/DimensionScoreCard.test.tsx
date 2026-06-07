/**
 * DimensionScoreCard — fixes BUG-FMT-S14
 * Tests the "为什么是 X 分?" reveal and the null→"未配置" path (the bug that
 * produced "competitor=100 健康"). Mini-bar (S10) and config-CTA copy (S11) are
 * covered by their own commits' tests.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DimensionScoreCard } from '../DimensionScoreCard'

describe('DimensionScoreCard — score with explanation', () => {
  it('shows the numeric score in the embedded gauge', () => {
    render(<DimensionScoreCard dimension="seo" dimensionLabel="SEO" score={36} />)
    expect(screen.getByTestId('score-value')).toHaveTextContent('36')
  })

  it('toggles the explanation panel via the "为什么" button (S14)', () => {
    render(<DimensionScoreCard dimension="reputation" dimensionLabel="口碑" score={54} />)
    const toggle = screen.getByTestId('explain-toggle-reputation')
    expect(toggle).toHaveTextContent('为什么是 54 分?')
    expect(screen.queryByTestId('explain-panel-reputation')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByTestId('explain-panel-reputation')).toBeInTheDocument()
    expect(toggle).toHaveTextContent('收起')
  })

  it('explanation contains formula + data source + weight (S14)', () => {
    render(<DimensionScoreCard dimension="reputation" dimensionLabel="口碑" score={54} />)
    fireEvent.click(screen.getByTestId('explain-toggle-reputation'))
    const panel = screen.getByTestId('explain-panel-reputation')
    expect(panel).toHaveTextContent(/公式/)
    expect(panel).toHaveTextContent(/数据源/)
    expect(panel).toHaveTextContent(/Google Business Profile/)
    expect(panel).toHaveTextContent(/权重 10%/)
  })
})

describe('DimensionScoreCard — null score path (S14 root cause)', () => {
  it('renders 未配置 gauge instead of pretending null is a number', () => {
    render(
      <DimensionScoreCard
        dimension="competitor"
        dimensionLabel="竞品"
        score={null}
      />,
    )
    const gauge = screen.getByTestId('score-gauge')
    expect(gauge).toHaveAttribute('data-tier', 'unknown')
  })

  it('toggle label asks "未配置" question instead of a fake score', () => {
    render(<DimensionScoreCard dimension="competitor" dimensionLabel="竞品" score={null} />)
    expect(screen.getByTestId('explain-toggle-competitor')).toHaveTextContent('为什么"未配置"?')
  })

  it('renders the 去 Settings 配置 link with tooltip when configHref is given and score is null (S11)', () => {
    render(
      <DimensionScoreCard
        dimension="seo"
        dimensionLabel="SEO"
        score={null}
        configHref="/dashboard/clients/abc/settings"
      />,
    )
    const link = screen.getByRole('link', { name: /去 Settings 配置/ })
    expect(link).toHaveAttribute('href', '/dashboard/clients/abc/settings')
    expect(link).toHaveAttribute('title')
  })
})

describe('DimensionScoreCard — industry baseline comparison (S14)', () => {
  it('renders the baseline row when p50 is available', () => {
    render(
      <DimensionScoreCard
        dimension="reputation"
        dimensionLabel="口碑"
        score={54}
        baseline={{ p50: 67, p75: 78, p90: 88, source: 'BrightLocal 2025' }}
      />,
    )
    fireEvent.click(screen.getByTestId('explain-toggle-reputation'))
    const panel = screen.getByTestId('explain-panel-reputation')
    expect(panel).toHaveTextContent('p50=67')
    expect(panel).toHaveTextContent('p75=78')
    expect(panel).toHaveTextContent('低于行业中位')
    expect(panel).toHaveTextContent('BrightLocal 2025')
  })

  it('falls back to "暂无" line when baseline is empty', () => {
    render(
      <DimensionScoreCard
        dimension="ads"
        dimensionLabel="广告"
        score={31}
        baseline={null}
      />,
    )
    fireEvent.click(screen.getByTestId('explain-toggle-ads'))
    expect(screen.getByTestId('explain-panel-ads')).toHaveTextContent('暂无')
  })

  it('labels "行业 Top 25%" when score sits between p75 and p90', () => {
    render(
      <DimensionScoreCard
        dimension="seo"
        dimensionLabel="SEO"
        score={80}
        baseline={{ p50: 50, p75: 75, p90: 90, source: null }}
      />,
    )
    fireEvent.click(screen.getByTestId('explain-toggle-seo'))
    expect(screen.getByTestId('explain-panel-seo')).toHaveTextContent('行业 Top 25%')
  })
})

// ---------------------------------------------------------------------------
// S10: mini progress bar — visual gradient so 36 vs 31 vs 48 are
// distinguishable at a glance even though all three render as "red".
// ---------------------------------------------------------------------------

describe('DimensionScoreCard — mini progress bar (S10)', () => {
  it('renders the bar for a non-null score', () => {
    render(<DimensionScoreCard dimension="seo" dimensionLabel="SEO" score={36} />)
    expect(screen.getByTestId('score-bar-seo')).toBeInTheDocument()
  })

  it('does NOT render the bar when score is null', () => {
    render(<DimensionScoreCard dimension="competitor" dimensionLabel="竞品" score={null} />)
    expect(screen.queryByTestId('score-bar-competitor')).not.toBeInTheDocument()
  })

  it('exposes the tier-band tooltip on the bar', () => {
    render(<DimensionScoreCard dimension="ads" dimensionLabel="广告" score={31} />)
    expect(screen.getByTestId('score-bar-ads')).toHaveAttribute('title')
  })

  // 魏征 H2: clampPct edge cases — mutation showed removing Math.max kept tests
  // green. score=-5 would push width:-5% (invalid CSS, but React would still
  // set it). score=110 would overflow. Lock both ends here.
  it('clamps negative scores to 0% bar width', () => {
    render(<DimensionScoreCard dimension="seo" dimensionLabel="SEO" score={-5} />)
    const bar = screen.getByTestId('score-bar-seo').lastElementChild as HTMLElement
    expect(bar.style.width).toBe('0%')
  })

  it('clamps scores above 100 to 100% bar width', () => {
    render(<DimensionScoreCard dimension="seo" dimensionLabel="SEO" score={110} />)
    const bar = screen.getByTestId('score-bar-seo').lastElementChild as HTMLElement
    expect(bar.style.width).toBe('100%')
  })

  it('score=0 still renders the bar (not the null path) with 0% width', () => {
    render(<DimensionScoreCard dimension="ads" dimensionLabel="广告" score={0} />)
    const wrap = screen.getByTestId('score-bar-ads')
    expect(wrap).toBeInTheDocument()
    const bar = wrap.lastElementChild as HTMLElement
    expect(bar.style.width).toBe('0%')
  })
})
