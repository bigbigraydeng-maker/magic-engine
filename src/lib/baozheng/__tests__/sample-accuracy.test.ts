import { describe, expect, it } from 'vitest'
import { pickRandom, pickStratified, type SampleCandidate } from '../sample'
import { computeAccuracy, type ReviewedItem } from '../accuracy'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-10T00:00:00Z')

function cands(stage: string, n: number): SampleCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${stage}-${String(i).padStart(3, '0')}`, stage }))
}

describe('pickStratified (BZ-15)', () => {
  it('takes everything when under the cap', () => {
    const s = pickStratified([...cands('quoted', 3), ...cands('contacted', 8)], 20, 'cts:2026-W45')
    expect(s.picked).toHaveLength(11)
  })

  it('allocates the cap by stage share and is deterministic for the same seed', () => {
    const all = [...cands('contacted', 30), ...cands('quoted', 9), ...cands('deferred', 1)]
    const a = pickStratified(all, 20, 'cts:2026-W45')
    const b = pickStratified([...all].reverse(), 20, 'cts:2026-W45')
    expect(a.picked).toHaveLength(20)
    // 4.5 and 0.5 tie on remainder; stage name breaks the tie (deferred < quoted)
    expect(a.pickedByStage).toEqual({ contacted: 15, quoted: 4, deferred: 1 })
    expect(a.populationByStage).toEqual({ contacted: 30, quoted: 9, deferred: 1 })
    expect(b.picked).toEqual(a.picked)
  })

  it('a different week picks a different set', () => {
    const all = cands('contacted', 40)
    const a = pickStratified(all, 10, 'cts:2026-W45').picked.map((p) => p.id)
    const b = pickStratified(all, 10, 'cts:2026-W46').picked.map((p) => p.id)
    expect(a).not.toEqual(b)
  })

  it('cap 0 picks nothing; pickRandom k ≤ 0 is empty', () => {
    expect(pickStratified(cands('quoted', 5), 0, 's').picked).toHaveLength(0)
    expect(pickRandom(cands('new', 5), 0, 's')).toHaveLength(0)
    expect(pickRandom(cands('new', 5), 3, 's')).toHaveLength(3)
  })
})

function item(stage: string, daysAgo: number, result: ReviewedItem['result'], ruling: ReviewedItem['ruling'] = null): ReviewedItem {
  return { judgmentId: `${stage}-${daysAgo}-${result}-${Math.random()}`, stage, reviewedAt: new Date(NOW - daysAgo * DAY).toISOString(), result, ruling }
}

describe('computeAccuracy (BZ-20)', () => {
  it('unruled disagreements widen the range instead of leaving the denominator (子牙 P0-1)', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item('quoted', i, 'agree')),
      item('quoted', 1, 'disagree'),
      item('quoted', 2, 'disagree'),
    ]
    const [q] = computeAccuracy(items, NOW)
    expect(q).toMatchObject({ n: 10, agree: 8, unknown: 2, lower: 0.8, upper: 1, point: 0.9, agreementRate: 0.8 })
  })

  it('no single number when unknown share is over 20% or n < 10', () => {
    const many = [...Array.from({ length: 7 }, (_, i) => item('quoted', i, 'agree')), item('quoted', 1, 'disagree'), item('quoted', 2, 'disagree'), item('quoted', 3, 'disagree')]
    expect(computeAccuracy(many, NOW)[0]?.point).toBeNull()
    const few = Array.from({ length: 9 }, (_, i) => item('quoted', i, 'agree'))
    expect(computeAccuracy(few, NOW)[0]).toMatchObject({ n: 9, lower: 1, upper: 1, point: null })
  })

  it('rulings move items between right and wrong; review_unclear leaves the denominator', () => {
    const items = [
      item('contacted', 1, 'agree'),
      item('contacted', 1, 'disagree', 'ai_right'),
      item('contacted', 1, 'disagree', 'review_right'),
      item('contacted', 1, 'disagree', 'neither'),
      item('contacted', 1, 'review_unclear'),
      item('contacted', 1, 'agree', 'review_right'),
    ]
    const [c] = computeAccuracy(items, NOW)
    expect(c).toMatchObject({ sampled: 6, n: 5, agree: 2, aiRight: 1, reviewRight: 1, neither: 1, unknown: 0, reviewUnclear: 1 })
    expect(c?.lower).toBeCloseTo(3 / 5)
    expect(c?.upper).toBeCloseTo(3 / 5)
  })

  it('only the last 8 weeks count', () => {
    const items = [item('quoted', 10, 'agree'), item('quoted', 57, 'disagree', 'review_right')]
    expect(computeAccuracy(items, NOW)[0]).toMatchObject({ n: 1, lower: 1 })
  })
})
