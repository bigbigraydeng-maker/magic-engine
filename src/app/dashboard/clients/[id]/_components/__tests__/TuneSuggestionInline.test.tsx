/**
 * Smoke tests for TuneSuggestionInline —— 4 种决策 + null 占位 + caveats。
 * evaluator 已经把决策语义测过；这里只锁 UI 侧的文案与占位。
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TuneSuggestionInline } from '../TuneSuggestionInline'
import type { TuneRecommendation } from '@/lib/flywheel/tune/types'

function rec(over: Partial<TuneRecommendation> = {}): TuneRecommendation {
  return {
    decision: 'REPEAT',
    rationale: '本条明显比同类历史好',
    primaryMetric: 'likes',
    targetValue: 20,
    cohortMean: 10,
    deltaPct: 100,
    sampleSize: 3,
    caveats: [],
    sourceActionIds: ['a-target'],
    thresholdsUsed: { minSampleSize: 3, repeatDeltaPct: 30, stopDeltaPct: -30 },
    ...over,
  }
}

afterEach(() => cleanup())

describe('TuneSuggestionInline', () => {
  it('null 建议 → 显示「等 T+72」占位', () => {
    render(<TuneSuggestionInline suggestion={null} />)
    expect(screen.getByText(/等 T\+72/)).toBeTruthy()
  })

  it('REPEAT → 「值得再做一次」+ rationale', () => {
    render(<TuneSuggestionInline suggestion={rec({ decision: 'REPEAT', rationale: '本条明显好' })} />)
    expect(screen.getByText(/值得再做一次/)).toBeTruthy()
    expect(screen.getByText(/本条明显好/)).toBeTruthy()
  })

  it('STOP → 「不建议再做」', () => {
    render(<TuneSuggestionInline suggestion={rec({ decision: 'STOP' })} />)
    expect(screen.getByText(/不建议再做/)).toBeTruthy()
  })

  it('ITERATE → 「差不多，微调再试」', () => {
    render(<TuneSuggestionInline suggestion={rec({ decision: 'ITERATE' })} />)
    expect(screen.getByText(/差不多，微调再试/)).toBeTruthy()
  })

  it('INCONCLUSIVE → 「数据还不够说话」', () => {
    render(<TuneSuggestionInline suggestion={rec({ decision: 'INCONCLUSIVE' })} />)
    expect(screen.getByText(/数据还不够说话/)).toBeTruthy()
  })

  it('caveats 翻译成人话', () => {
    render(
      <TuneSuggestionInline
        suggestion={rec({ caveats: ['shares_missing_on_target', 'fell_back_from_likes_to_comments'] })}
      />,
    )
    expect(screen.getByText(/转发数没能取到/)).toBeTruthy()
    expect(screen.getByText(/likes 覆盖不够/)).toBeTruthy()
  })

  it('未知 caveat key 原样显示（不隐藏 fallback）', () => {
    render(<TuneSuggestionInline suggestion={rec({ caveats: ['some_new_caveat'] })} />)
    expect(screen.getByText(/some_new_caveat/)).toBeTruthy()
  })

  it('fetchFailed=true 时忽略 suggestion 显示「读不到」占位', () => {
    // 即使传入完整 recommendation，读失败态优先 —— 防止 PITFALLS「读失败伪装成没到点」。
    render(<TuneSuggestionInline suggestion={rec({ decision: 'REPEAT' })} fetchFailed />)
    expect(screen.getByText(/暂时读不到/)).toBeTruthy()
    expect(screen.queryByText(/值得再做一次/)).toBeNull()
    expect(screen.queryByText(/等 T\+72/)).toBeNull()
  })

  it('fetchFailed=true 时 suggestion=null 也走「读不到」（不再走「等 T+72」）', () => {
    render(<TuneSuggestionInline suggestion={null} fetchFailed />)
    expect(screen.getByText(/暂时读不到/)).toBeTruthy()
    expect(screen.queryByText(/等 T\+72/)).toBeNull()
  })
})
