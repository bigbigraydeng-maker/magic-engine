/**
 * Tests for the A-level risk gate in the auto-fix bot.
 *
 * The gate lives in handle-review.mjs (the dispatch-fix case): before invoking
 * Claude, it computes the PR's risk grade and blocks A-level or unreadable
 * diffs from receiving an automated push. This file tests the decision through
 * the same pure functions handle-review.mjs calls.
 */
import { describe, expect, it } from 'vitest'
import { classifyRisk, readDeclaredRisk } from '../src/risk.mjs'

describe('autofix risk gate: A-level PRs are blocked', () => {
  it('rates a PR touching .github/workflows as A', () => {
    const files = [{ filename: '.github/workflows/ci.yml', status: 'modified' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
  })

  it('rates a PR touching tools/ops-review-loop as A', () => {
    const files = [{ filename: 'tools/ops-review-loop/src/risk.mjs', status: 'modified' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
  })

  it('rates a PR with unreadable file list as A (fail closed)', () => {
    const rating = classifyRisk({ files: undefined })
    expect(rating.risk).toBe('A')
    expect(rating.readable).toBe(false)
  })

  it('rates an empty file list as A (fail closed)', () => {
    const rating = classifyRisk({ files: [] })
    expect(rating.risk).toBe('A')
  })

  it('rates a B-level PR correctly — auto-fix should proceed', () => {
    const files = [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('B')
  })

  it('rates a C-level PR correctly — auto-fix should proceed', () => {
    const files = [{ filename: 'docs/README.md', status: 'modified' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('C')
  })

  it('respects the declared risk as a floor', () => {
    const files = [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }]
    const declared = readDeclaredRisk('风险级别：A')
    const rating = classifyRisk({ files, declaredRisk: declared.risk, declaredUnreadable: declared.unreadable })
    expect(rating.risk).toBe('A')
  })

  it('handles renamed files — both old and new paths are rated', () => {
    const files = [{
      filename: 'docs/safe.md',
      status: 'renamed',
      previous_filename: '.github/workflows/dangerous.yml',
    }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
  })
})

describe('autofix risk gate: grading errors fail closed', () => {
  it('rates a file entry with no filename as A', () => {
    const files = [{ status: 'modified' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
    expect(rating.readable).toBe(false)
  })

  it('rates a rename with missing previous_filename as A', () => {
    const files = [{ filename: 'src/lib/foo.ts', status: 'renamed' }]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
    expect(rating.readable).toBe(false)
  })
})

describe('autofix risk gate: real incident scenarios', () => {
  it('PR #2131 scenario — touching ops-review-loop is A, bot should not push', () => {
    const files = [
      { filename: 'tools/ops-review-loop/src/handle-review.mjs', status: 'modified' },
      { filename: 'tools/ops-review-loop/tests/plan.test.ts', status: 'modified' },
    ]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('A')
  })

  it('PR #2115 scenario — pure business logic is B, bot may push', () => {
    const files = [
      { filename: 'src/lib/seo/optimizer.ts', status: 'modified' },
      { filename: 'src/lib/seo/optimizer.test.ts', status: 'modified' },
    ]
    const rating = classifyRisk({ files })
    expect(rating.risk).toBe('B')
  })
})
