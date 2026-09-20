/**
 * 回填脚本 `planChanges` 的回归测试（A 级风险，改生产数据前必须有）。
 *
 * 守的是三条「不许凭空判断」的闸和一条幂等性 —— 这几条都是子牙/魏征复审
 * 2026-09-20 实测抓出来的问题，加测试是为了以后没人能悄悄把闸拆掉。
 */
import { describe, it, expect } from 'vitest'
import { planChanges, type RunRow } from '../recompute-cts-ai-visibility-rank'

const CTS = { brandName: 'CTS Tours', domain: 'ctstours.co.nz', aliases: ['cts tours nz'] }

function row(partial: Partial<RunRow> & { id: string }): RunRow {
  return {
    ran_at: '2026-07-01T00:00:00.000Z',
    raw_response: null,
    brands_mentioned: [],
    client_brand_rank: null,
    ...partial,
  }
}

describe('planChanges', () => {
  it('没存原文的行一律跳过 —— 没有原文就没有证据', () => {
    const plan = planChanges(
      [row({ id: 'a', raw_response: null, client_brand_rank: 2 })],
      CTS
    )
    expect(plan.changes).toHaveLength(0)
    expect(plan.skippedNoRaw).toBe(1)
    // 没原文却带着名次是异常，必须报出来而不是悄悄跳过
    expect(plan.skippedButRanked).toEqual(['a'])
  })

  it('有原文但品牌列表是空的行跳过 —— 没有竞品就没有排第几的参照系', () => {
    const plan = planChanges(
      [
        row({
          id: 'b',
          raw_response: 'Top picks in New Zealand: Wendy Wu Tours, then CTS Tours.',
          brands_mentioned: [],
        }),
      ],
      CTS
    )
    expect(plan.changes).toHaveLength(0)
    expect(plan.skippedNoParse).toBe(1)
  })

  it('原文里根本没提到客户，却记了名次 → 改成空，并把后面的竞品名次补齐', () => {
    const plan = planChanges(
      [
        row({
          id: 'c',
          raw_response: 'Only Wendy Wu Tours and Intrepid operate these trips.',
          brands_mentioned: [
            { brand: 'Wendy Wu Tours', rank: 1 },
            { brand: 'CTS Tours', rank: 2 },
            { brand: 'Intrepid', rank: 3 },
          ],
          client_brand_rank: 2,
        }),
      ],
      CTS
    )
    expect(plan.changes).toHaveLength(1)
    const c = plan.changes[0]
    expect(c.kind).toBe('false_positive')
    expect(c.new_rank).toBeNull()
    expect(c.new_brands.map(b => `${b.rank}.${b.brand}`)).toEqual([
      '1.Wendy Wu Tours',
      '2.Intrepid',
    ])
  })

  it('原文只引用了客户网址 → 补上名次（域名算提到，是有意的口径）', () => {
    const plan = planChanges(
      [
        row({
          id: 'd',
          raw_response: 'Try Wendy Wu Tours first, then see ctstours.co.nz for NZ departures.',
          brands_mentioned: [{ brand: 'Wendy Wu Tours', rank: 1 }],
          client_brand_rank: null,
        }),
      ],
      CTS
    )
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].kind).toBe('missed')
    expect(plan.changes[0].new_rank).toBe(2)
  })

  it('判定结果跟库里一致的行不进改动清单', () => {
    const plan = planChanges(
      [
        row({
          id: 'e',
          raw_response: 'CTS Tours leads, Wendy Wu Tours second.',
          brands_mentioned: [
            { brand: 'CTS Tours', rank: 1 },
            { brand: 'Wendy Wu Tours', rank: 2 },
          ],
          client_brand_rank: 1,
        }),
      ],
      CTS
    )
    expect(plan.changes).toHaveLength(0)
  })

  it('幂等：把第一遍算出来的新值当输入再跑一遍，不会再改', () => {
    const initial = [
      row({
        id: 'f',
        raw_response: 'Try Wendy Wu Tours first, then see ctstours.co.nz for NZ departures.',
        brands_mentioned: [{ brand: 'Wendy Wu Tours', rank: 1 }],
        client_brand_rank: null,
      }),
      row({
        id: 'g',
        raw_response: 'Only Wendy Wu Tours operates these trips.',
        brands_mentioned: [
          { brand: 'Wendy Wu Tours', rank: 1 },
          { brand: 'CTS Tours', rank: 2 },
        ],
        client_brand_rank: 2,
      }),
    ]
    const first = planChanges(initial, CTS)
    expect(first.changes).toHaveLength(2)

    const applied = initial.map(r => {
      const c = first.changes.find(x => x.id === r.id)
      return c ? { ...r, client_brand_rank: c.new_rank, brands_mentioned: c.new_brands } : r
    })
    // 'g' 改完品牌列表只剩 Wendy Wu Tours（非空），仍会被重新判定；
    // 'f' 改完含客户条目，走 min(rank) 分支。两者都必须收敛。
    expect(planChanges(applied, CTS).changes).toHaveLength(0)
  })
})
