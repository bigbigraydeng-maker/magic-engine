/**
 * Delivery scoring and the hard gates.
 *
 * The tests that matter here are the ones proving a *high score cannot buy a
 * pass*. A PR that documents itself beautifully while its CI is red, or whose
 * rating was computed against a commit that no longer exists, must be blocked
 * at 100/100 — otherwise the score becomes the thing agents optimise and the
 * gate becomes decorative.
 */

import { describe, expect, it } from 'vitest'

import {
  A_REQUIRED_SIGNALS,
  CODEX_QUALITY_FIELDS,
  READY_THRESHOLD,
  SPECIALIZED_EVIDENCE,
  SCORE_DIMENSIONS,
  UNKNOWN_CATEGORY_EVIDENCE,
  decideReadiness,
  evaluateSpecializedEvidence,
  knownSignalIds,
  requiredSpecializedEvidence,
  scoreDelivery,
} from '../src/quality.mjs'
import { RISK_CATEGORY } from '../src/risk.mjs'

const ALL_SIGNALS = knownSignalIds()

/** Every specialised item the given categories owe, as if all were produced. */
const allEvidenceFor = (categories: string[]) =>
  evaluateSpecializedEvidence({
    categories,
    observed: requiredSpecializedEvidence(categories).map((r: { id: string }) => r.id),
  })

const cleanGates = {
  evidenceReadable: true,
  shaMatches: true,
  requiredCiPassed: true,
  scopeGuardPassed: true,
  openBlockerCount: 0,
  // Non-A paths ignore this; A paths require it, and "we did not compute it" is
  // itself a blocker, so the clean baseline has to carry a real evaluation.
  specialized: allEvidenceFor([]),
}

describe('the scoring table itself', () => {
  it('is worth exactly 100', () => {
    expect(SCORE_DIMENSIONS.reduce((sum: number, d: { max: number }) => sum + d.max, 0)).toBe(100)
  })

  it('gives each dimension exactly the weight the spec assigns it', () => {
    const byKey = Object.fromEntries(
      SCORE_DIMENSIONS.map((d: { key: string; max: number }) => [d.key, d.max]),
    )
    expect(byKey).toEqual({ acceptance: 30, tests: 25, security: 20, reuse: 15, resilience: 10 })
  })

  it('has every dimension"s signals summing to its own max — no scoring out of 103', () => {
    for (const dimension of SCORE_DIMENSIONS as Array<{
      key: string
      max: number
      signals: Array<{ points: number }>
    }>) {
      const sum = dimension.signals.reduce((total, s) => total + s.points, 0)
      expect(sum, `${dimension.key} signals must sum to ${dimension.max}`).toBe(dimension.max)
    }
  })

  it('reports Codex quality fields as unavailable rather than inventing them', () => {
    expect(CODEX_QUALITY_FIELDS).toBe('unavailable')
  })
})

describe('scoreDelivery only counts evidence it was handed', () => {
  it('scores 0 with no signals — missing evidence is 0, not a benefit of the doubt', () => {
    expect(scoreDelivery({}).total).toBe(0)
    expect(scoreDelivery({ signals: [] }).total).toBe(0)
  })

  it('scores 100 with every signal', () => {
    expect(scoreDelivery({ signals: ALL_SIGNALS }).total).toBe(100)
  })

  it('adds up partial evidence per dimension', () => {
    const result = scoreDelivery({ signals: ['linked-issue', 'required-ci-green', 'reuse-statement'] })
    expect(result.total).toBe(30)
    const acceptance = result.dimensions.find((d: { key: string }) => d.key === 'acceptance')
    expect(acceptance?.awarded).toBe(10)
    expect(acceptance?.missing).toEqual(['acceptance-criteria', 'scope-statement'])
  })

  it('refuses an invented signal instead of silently ignoring it', () => {
    expect(() => scoreDelivery({ signals: ['looks-good-to-me'] })).toThrow(/unknown evidence signal/)
  })

  it('counts a repeated signal once', () => {
    expect(scoreDelivery({ signals: ['linked-issue', 'linked-issue'] }).total).toBe(10)
  })
})

describe('hard gates outrank the total', () => {
  const perfect = { total: 100 }

  it('is ready at threshold with clean gates', () => {
    const result = decideReadiness({
      risk: 'B',
      score: { total: READY_THRESHOLD.B },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.decision).toBe('READY_FOR_PRODUCT_OWNER')
    expect(result.blockers).toEqual([])
  })

  it('blocks a 100-point PR whose required CI is red', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, requiredCiPassed: false },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('必过 CI 未通过')
  })

  it('blocks a 100-point PR with an open Codex P0/P1/P2 on the current head', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, openBlockerCount: 2 },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('2 条 Codex P0/P1/P2')
  })

  it('blocks a 100-point PR whose rating is bound to a stale sha', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, shaMatches: false },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('对不上')
  })

  it('keeps the A-required list and the scoring table in sync', () => {
    for (const id of A_REQUIRED_SIGNALS as string[]) {
      expect(ALL_SIGNALS).toContain(id)
    }
  })

  /**
   * Codex finding on PR #1211 (P1): `scope-guard-green` used to be scored as
   * a 5-point signal only. A failed or unreadable auto-fix blast-radius
   * guard — the real security boundary on the auto-fix loop — could cost 5
   * points and still let a C-level PR reach READY on the rest of its score.
   * It is now a hard gate, same shape as `requiredCiPassed`: only `true`
   * clears it, everywhere, at any risk level.
   */
  it('blocks a 100-point PR whose auto-fix blast-radius guard failed', () => {
    const result = decideReadiness({
      risk: 'C',
      score: perfect,
      gates: { ...cleanGates, scopeGuardPassed: false },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('爆炸半径闸门')
  })

  it('blocks a 100-point PR whose auto-fix blast-radius guard status could not be read', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, scopeGuardPassed: null },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('爆炸半径闸门')
  })

  it('blocks when the guard gate is simply missing from the input, not just explicitly false', () => {
    const { scopeGuardPassed: _dropped, ...withoutGuard } = cleanGates
    const result = decideReadiness({
      risk: 'A',
      score: perfect,
      gates: withoutGuard,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
  })
})

/**
 * Codex finding on PR #1205 (P1): "A-level needs specialised evidence" used to
 * mean one fixed thing — client isolation — for every A change. These tests
 * pin the replacement: what a PR owes follows the risk categories it actually
 * hit, and the two failure directions (owing nothing when it should owe
 * something; owing isolation proof for a dependency bump) are both covered.
 */
describe('specialised evidence follows the risk categories hit', () => {
  it('asks a migration PR for migration evidence, not isolation evidence', () => {
    const required = requiredSpecializedEvidence([RISK_CATEGORY.DB_MIGRATION])
    expect(required.map((r: { id: string }) => r.id)).toEqual(['migration-evidence'])
  })

  it('asks a control-plane PR for control-plane evidence — the case that used to be unpassable', () => {
    // This PR is exactly that shape: A-level because it edits
    // tools/ops-review-loop/, with no client-isolation surface anywhere in it.
    const required = requiredSpecializedEvidence([RISK_CATEGORY.CONTROL_PLANE])
    expect(required.map((r: { id: string }) => r.id)).toEqual(['control-plane-evidence'])
  })

  it('asks for every category hit, deduplicated', () => {
    const required = requiredSpecializedEvidence([
      RISK_CATEGORY.DB_MIGRATION,
      RISK_CATEGORY.AUTH_ISOLATION,
      RISK_CATEGORY.DB_MIGRATION,
    ])
    expect(required.map((r: { id: string }) => r.id)).toEqual(['migration-evidence', 'isolation-evidence'])
  })

  it('asks for nothing when no A-level category was hit', () => {
    expect(requiredSpecializedEvidence([])).toEqual([])
  })

  it('gives every declared risk category an evidence entry', () => {
    for (const category of Object.values(RISK_CATEGORY) as string[]) {
      expect(SPECIALIZED_EVIDENCE[category], `${category} has no evidence entry`).toBeTruthy()
    }
  })

  it('demands a manual sign-off for a category the table does not know', () => {
    const required = requiredSpecializedEvidence(['some-future-category'])
    expect(required.map((r: { id: string }) => r.id)).toEqual([UNKNOWN_CATEGORY_EVIDENCE])
  })

  it('demands a manual sign-off when the diff could not be read', () => {
    const required = requiredSpecializedEvidence([RISK_CATEGORY.UNREADABLE])
    expect(required.map((r: { id: string }) => r.id)).toEqual(['manual-rating-evidence'])
  })
})

describe('evaluateSpecializedEvidence separates "none found" from "could not look"', () => {
  it('is complete when every required item was observed', () => {
    const result = evaluateSpecializedEvidence({
      categories: [RISK_CATEGORY.MONEY],
      observed: ['money-evidence'],
    })
    expect(result).toMatchObject({ complete: true, readable: true, missing: [] })
  })

  it('reports exactly what is missing, with the label a human can act on', () => {
    const result = evaluateSpecializedEvidence({
      categories: [RISK_CATEGORY.MONEY, RISK_CATEGORY.CREDENTIALS],
      observed: ['money-evidence'],
    })
    expect(result.complete).toBe(false)
    expect(result.missing.map((m: { id: string }) => m.id)).toEqual(['credential-evidence'])
    expect(result.missing[0].label).toContain('凭证')
  })

  it('is complete and readable when nothing was owed and nothing observed', () => {
    expect(evaluateSpecializedEvidence({ categories: [], observed: [] })).toMatchObject({
      complete: true,
      readable: true,
    })
  })

  it('is NOT readable when observed was never supplied', () => {
    const result = evaluateSpecializedEvidence({ categories: [RISK_CATEGORY.MONEY] })
    expect(result.readable).toBe(false)
    expect(result.complete).toBe(false)
    expect(result.missing).toHaveLength(1)
  })

  it('rejects a bare string rather than iterating it character by character', () => {
    // `observed: 'money-evidence'` is iterable in JavaScript. Accepting it would
    // produce fourteen single-character ids, match nothing, and report "observed
    // but none counted" — the most misleading of the three possible answers.
    const result = evaluateSpecializedEvidence({
      categories: [RISK_CATEGORY.MONEY],
      observed: 'money-evidence',
    })
    expect(result.readable).toBe(false)
  })

  it('ignores a category list handed in as a bare string', () => {
    expect(requiredSpecializedEvidence('db-migration')).toEqual([])
  })

  it('accepts a Set, not just an array', () => {
    const result = evaluateSpecializedEvidence({
      categories: new Set([RISK_CATEGORY.MONEY]),
      observed: new Set(['money-evidence']),
    })
    expect(result.complete).toBe(true)
  })
})

describe('the A-level specialised-evidence hard gate', () => {
  const A_CONTROL = [RISK_CATEGORY.CONTROL_PLANE]

  it('lets an A-level control-plane PR through on control-plane evidence alone', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 90 },
      gates: { ...cleanGates, specialized: allEvidenceFor(A_CONTROL) },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.blockers).toEqual([])
    expect(result.decision).toBe('READY_FOR_PRODUCT_OWNER')
  })

  it('blocks an A-level PR that owes evidence it did not produce, however high it scores', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: {
        ...cleanGates,
        specialized: evaluateSpecializedEvidence({ categories: A_CONTROL, observed: [] }),
      },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('control-plane-evidence')
  })

  it('names the missing evidence in words, not just an id', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: {
        ...cleanGates,
        specialized: evaluateSpecializedEvidence({
          categories: [RISK_CATEGORY.AUTH_ISOLATION],
          observed: [],
        }),
      },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.blockers.join('\n')).toContain('拒绝')
  })

  // "Never evaluated" and "evaluated but unreadable" are different facts and get
  // different diagnoses, for the same reason `risk.mjs` refuses to collapse
  // "no files" into "read no files": they send a human to fix different things.
  it('blocks an A-level PR whose specialised evidence was never evaluated', () => {
    const { specialized: _dropped, ...withoutSpecialized } = cleanGates
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: withoutSpecialized,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('压根没算过')
  })

  it('blocks an A-level PR whose specialised evidence could not be read', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: {
        ...cleanGates,
        specialized: evaluateSpecializedEvidence({ categories: A_CONTROL, observed: null }),
      },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('读不到')
  })

  it('does not demand isolation evidence from a dependency bump', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 90 },
      gates: { ...cleanGates, specialized: allEvidenceFor([RISK_CATEGORY.SUPPLY_CHAIN]) },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.blockers).toEqual([])
  })

  /**
   * Codex round-2 finding on PR #1205, head d0c12486.
   *
   * The gate used to ask the question backwards: it blocked only when it could
   * *prove* an item was missing, and passed by default otherwise. An absent or
   * mistyped `missing` field makes `Array.isArray(x.missing) && x.missing.length
   * > 0` false — which is the same answer success gives. So a partially-built,
   * partially-deserialised, or openly-unfinished evaluation object took a
   * score-100 A-level PR to READY with zero blockers.
   *
   * These are the three objects from that review, verbatim, plus the shapes
   * around them. Each must block.
   */
  describe.each([
    ['{readable:true} — no missing field at all', { readable: true }],
    ['{readable:true, missing:"not-an-array"}', { readable: true, missing: 'not-an-array' }],
    ['{readable:true, missing:[], complete:false}', { readable: true, missing: [], complete: false }],
  ])('malformed evaluation: %s', (_label, specialized) => {
    it('never reaches READY, even at 100 points with every other gate clean', () => {
      const result = decideReadiness({
        risk: 'A',
        score: { total: 100 },
        gates: { ...cleanGates, specialized },
        observedSignals: ALL_SIGNALS,
      })
      expect(result.ready).toBe(false)
      expect(result.decision).toBe('BLOCKED')
      expect(result.blockers.length).toBeGreaterThan(0)
    })
  })

  it.each([
    ['required is not an array', { readable: true, required: 'nope', missing: [], complete: true }],
    ['missing is not an array', { readable: true, required: [], missing: null, complete: true }],
    ['both fields absent', { readable: true, complete: true }],
  ])('blocks when the result is structurally invalid: %s', (_label, specialized) => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: { ...cleanGates, specialized },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('结构不合法')
  })

  it.each([
    ['complete: false', { readable: true, required: [], missing: [], complete: false }],
    ['complete absent', { readable: true, required: [], missing: [] }],
    ['complete: "true" as a string', { readable: true, required: [], missing: [], complete: 'true' }],
    ['complete: 1', { readable: true, required: [], missing: [], complete: 1 }],
  ])('requires a positive completion claim, not merely an empty missing list: %s', (_label, specialized) => {
    // Structurally valid and nothing listed as missing — yet still blocked.
    // "We found no missing items" and "we finished checking" are different
    // claims, and an evaluation that stopped early reports exactly this shape.
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: { ...cleanGates, specialized },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('已完成')
  })

  it('clears only on a structurally valid, positively complete result', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: { ...cleanGates, specialized: { readable: true, required: [], missing: [], complete: true } },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.blockers).toEqual([])
    expect(result.decision).toBe('READY_FOR_PRODUCT_OWNER')
  })

  it('names an undescribable missing item honestly instead of printing "undefined（undefined）"', () => {
    // Same boundary, found while reproducing the above: the blocker text is the
    // only thing a human can act on, and interpolating id/label on an item that
    // has neither produced a blocker naming nothing and clearable by nobody.
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: {
        ...cleanGates,
        specialized: { readable: true, required: [{}], missing: [{}], complete: true },
      },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).not.toContain('undefined')
    expect(result.blockers.join('\n')).toContain('说不出名字')
  })

  it('still names a well-formed missing item by id and label', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 100 },
      gates: {
        ...cleanGates,
        specialized: evaluateSpecializedEvidence({
          categories: [RISK_CATEGORY.MONEY],
          observed: [],
        }),
      },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.blockers.join('\n')).toContain('money-evidence（')
  })

  it('accepts what evaluateSpecializedEvidence actually produces — the gate is not unpassable', () => {
    // The other failure direction: a boundary this strict is worthless if the
    // real producer cannot satisfy it. Every category, evaluated for real.
    for (const category of Object.values(RISK_CATEGORY) as string[]) {
      const result = decideReadiness({
        risk: 'A',
        score: { total: 90 },
        gates: { ...cleanGates, specialized: allEvidenceFor([category]) },
        observedSignals: ALL_SIGNALS,
      })
      expect(result.blockers, `${category} must be satisfiable`).toEqual([])
    }
  })

  it('does not apply the specialised gate to B or C', () => {
    for (const risk of ['B', 'C']) {
      const { specialized: _dropped, ...withoutSpecialized } = cleanGates
      const result = decideReadiness({
        risk,
        score: { total: 100 },
        gates: withoutSpecialized,
        observedSignals: ALL_SIGNALS,
      })
      expect(result.blockers, `${risk} must not be asked for A-level evidence`).toEqual([])
    }
  })
})

describe('unreadable evidence fails closed', () => {
  it.each([
    ['evidenceReadable missing', { shaMatches: true, requiredCiPassed: true, openBlockerCount: 0 }],
    ['CI status unreadable', { ...cleanGates, requiredCiPassed: null }],
    ['Codex blocker count unreadable', { ...cleanGates, openBlockerCount: null }],
    ['no gates at all', undefined],
  ])('%s blocks', (_label, gates) => {
    const result = decideReadiness({
      risk: 'C',
      score: { total: 100 },
      gates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.length).toBeGreaterThan(0)
  })

  it('blocks when the score itself could not be computed', () => {
    const result = decideReadiness({ risk: 'C', score: {}, gates: cleanGates, observedSignals: ALL_SIGNALS })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('质量分算不出来')
  })

  it('lists every blocker at once, not just the first', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 10 },
      gates: { evidenceReadable: false, shaMatches: false, requiredCiPassed: false, openBlockerCount: 3 },
      observedSignals: [],
    })
    expect(result.blockers.length).toBeGreaterThanOrEqual(5)
  })
})

describe('the thresholds are per level', () => {
  it('applies 75 / 85 / 90', () => {
    expect(READY_THRESHOLD).toEqual({ A: 90, B: 85, C: 75 })
  })

  it.each([
    ['C', 74, false],
    ['C', 75, true],
    ['B', 84, false],
    ['B', 85, true],
  ])('%s at %i is ready=%s', (risk, total, expected) => {
    const result = decideReadiness({
      risk,
      score: { total },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(expected)
  })

  it('uses the strictest threshold for a level it does not recognise', () => {
    const result = decideReadiness({
      risk: 'nonsense',
      score: { total: 89 },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.threshold).toBe(90)
    expect(result.ready).toBe(false)
  })
})

describe('NEEDS_PRODUCT_DECISION is never inferred', () => {
  it('does not appear just because the PR is blocked and stuck', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 0 },
      gates: { ...cleanGates, requiredCiPassed: false },
      observedSignals: [],
    })
    expect(result.decision).toBe('BLOCKED')
  })

  it('appears only when the caller asserts a real business question', () => {
    const result = decideReadiness({
      risk: 'B',
      score: { total: 100 },
      gates: { ...cleanGates, productDecisionNeeded: true, productDecisionReason: '客户是否接受多花 $200' },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.decision).toBe('NEEDS_PRODUCT_DECISION')
    expect(result.ready).toBe(false)
    expect(result.productDecisionReason).toBe('客户是否接受多花 $200')
  })
})
