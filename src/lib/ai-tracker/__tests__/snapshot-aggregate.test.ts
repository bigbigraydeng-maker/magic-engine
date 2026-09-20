import { describe, it, expect } from 'vitest'
import { computeSnapshotMetrics, type SnapshotRun } from '../snapshot-aggregate'

const CTS = { brandName: 'CTS Tours', domain: 'ctstours.co.nz', aliases: ['cts tours nz'] }

function run(partial: Partial<SnapshotRun>): SnapshotRun {
  return {
    ai_engine: 'openai',
    ai_model: 'gpt-4o',
    client_brand_rank: null,
    brands_mentioned: [],
    ...partial,
  }
}

describe('computeSnapshotMetrics', () => {
  it('counts only runs that ranked the client, and averages those ranks', () => {
    const m = computeSnapshotMetrics(
      [
        run({ client_brand_rank: 1 }),
        run({ client_brand_rank: 3 }),
        run({ client_brand_rank: null }),
      ],
      CTS
    )
    expect(m.totalRuns).toBe(3)
    expect(m.mentionsCount).toBe(2)
    expect(m.avgRank).toBe(2)
  })

  it('leaves avg_rank null when the client was never ranked', () => {
    const m = computeSnapshotMetrics([run({}), run({})], CTS)
    expect(m.mentionsCount).toBe(0)
    expect(m.avgRank).toBeNull()
  })

  it('counts engine coverage only where the client actually appeared', () => {
    const m = computeSnapshotMetrics(
      [
        run({ ai_engine: 'openai', client_brand_rank: 1 }),
        run({ ai_engine: 'perplexity', client_brand_rank: null }),
        run({ ai_engine: 'openai', client_brand_rank: 2 }),
      ],
      CTS
    )
    expect(m.engineCoverage).toBe(1)
    expect(m.modelsCovered).toEqual(['gpt-4o'])
  })

  it('merges the client brand variants into one canonical ranking row', () => {
    const m = computeSnapshotMetrics(
      [
        run({
          client_brand_rank: 1,
          brands_mentioned: [
            { brand: 'CTS Tours NZ Ltd', rank: 1 },
            { brand: 'Wendy Wu Tours', rank: 2 },
          ],
        }),
        run({
          client_brand_rank: 2,
          brands_mentioned: [
            { brand: 'Wendy Wu Tours', rank: 1 },
            { brand: 'CTS Tours', rank: 2 },
          ],
        }),
      ],
      CTS
    )
    const brands = (m.ranking_table as { brands: Array<{ name: string; mentions: number }> }).brands
    expect(brands.map(b => b.name).sort()).toEqual(['CTS Tours', 'Wendy Wu Tours'])
    expect(brands.find(b => b.name === 'CTS Tours')!.mentions).toBe(2)
  })

  it('does not merge a different company that merely shares a word', () => {
    const m = computeSnapshotMetrics(
      [
        run({
          brands_mentioned: [
            { brand: 'CTS Tours', rank: 1 },
            { brand: 'CTS Logistics', rank: 2 },
          ],
        }),
      ],
      CTS
    )
    const names = (m.ranking_table as { brands: Array<{ name: string }> }).brands.map(b => b.name)
    expect(names).toContain('CTS Logistics')
    expect(names).toContain('CTS Tours')
  })
})
