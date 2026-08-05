import { describe, it, expect } from 'vitest'
import { median, summariseStructure, MIN_SAMPLE, type ViralStructureRow } from './viral-structure'
import { pickShotRecipe, recipeMedianShotSeconds, SHOT_RECIPES } from './shot-recipes'

function row(
  medianShot: number,
  firstCut: number,
  shots: number,
  dur: number,
  hookType?: string,
  views = 1000,
): ViralStructureRow {
  return {
    shot_recipe: {
      rhythm: { median_shot_seconds: medianShot },
      hook: { first_cut_at: firstCut },
      shot_count: shots,
      duration_seconds: dur,
    },
    opening_hook: hookType ? { type: hookType } : null,
    view_count: views,
  }
}

const TEN = Array.from({ length: 10 }, (_, i) => row(2 + i * 0.1, 1.5, 6, 15, i < 6 ? 'visual_shock' : 'question'))

describe('median', () => {
  it('偶数取中间两个的平均，忽略 0 和非有限值', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([0, 0, 4, 6])).toBe(5)
    expect(median([])).toBe(0)
  })

  it('用中位数而非平均：一条异常爆款不该拽偏基线', () => {
    // 4.4 亿播放那条如果是 30s 长镜，平均会被拉高，中位数不受影响
    expect(median([2, 2, 2, 2, 30])).toBe(2)
  })
})

describe('summariseStructure — 样本量闸门', () => {
  it(`少于 ${MIN_SAMPLE} 条一律返回 null（不够格影响决策）`, () => {
    expect(summariseStructure('travel', TEN.slice(0, MIN_SAMPLE - 1))).toBeNull()
  })

  it('达到样本量才给结构，且带上 sampleSize', () => {
    const s = summariseStructure('travel', TEN)!
    expect(s).not.toBeNull()
    expect(s.sampleSize).toBe(10)
    expect(s.industry).toBe('travel')
    expect(s.medianShotSeconds).toBeGreaterThan(0)
    expect(s.dominantHookType).toBe('visual_shock')
    expect(s.hookTypeCounts[0]).toEqual({ type: 'visual_shock', n: 6 })
  })

  it('单镜行视为检测失败，既不计样本也不拉偏中位数（flooring 实测回归）', () => {
    // 真实分布：flooring 39 条里 20 条 shot_count=1，整片当一镜 → 镜长虚高到 8.61s
    const fake = Array.from({ length: 20 }, () => row(8.6, 1.9, 1, 14, undefined))
    const real = Array.from({ length: 10 }, () => row(2.37, 1.9, 6, 14, 'product_reveal'))
    const s = summariseStructure('flooring', [...fake, ...real])!
    expect(s.sampleSize).toBe(10)                 // 20 条假数据全部出局
    expect(s.medianShotSeconds).toBeCloseTo(2.37) // 没被 8.6 拽偏
  })

  it('剔除单镜后不足样本量 → 返回 null，不给假建议', () => {
    const fake = Array.from({ length: 30 }, () => row(8.6, 1.9, 1, 14))
    expect(summariseStructure('flooring', fake)).toBeNull()
  })

  it('没有 shot_recipe 的行不计入样本量', () => {
    const withNulls = [...TEN.slice(0, 5), ...Array.from({ length: 5 }, () => ({
      shot_recipe: null, opening_hook: null, view_count: 1,
    } as ViralStructureRow))]
    expect(summariseStructure('travel', withNulls)).toBeNull()
  })
})

describe('硬边界：只有结构数字能过境', () => {
  it('返回对象里不存在任何画面/文案字段', () => {
    const s = summariseStructure('travel', TEN)!
    const keys = Object.keys(s)
    for (const banned of [
      'video_title', 'title', 'script', 'source_url', 'style_description',
      'channel_title', 'notes', 'opening_hook',
    ]) {
      expect(keys, `不该导出 ${banned}`).not.toContain(banned)
    }
    // 序列化后也不该出现别人的文案（只有数字、行业名、钩子类型枚举）
    const json = JSON.stringify(s)
    expect(json).not.toContain('WATCHING')
    expect(json).not.toContain('http')
  })
})

describe('pickShotRecipe — 节奏缩池但保持轮换', () => {
  it('无节奏输入时行为不变（向后兼容）', () => {
    const a = pickShotRecipe('sales', 0)
    const b = pickShotRecipe('sales', 0, false, null)
    expect(a.key).toBe(b.key)
  })

  it('慢节奏行业（中位 3.6s）把快剪型挤出候选', () => {
    const slow = { medianShotSeconds: 3.6, sampleSize: 20 }
    const picks = [0, 1, 2, 3].map((seed) => pickShotRecipe('brand', seed, false, slow).key)
    expect(picks).not.toContain('fast_cut')
  })

  it('缩池后仍然轮换，不退化成永远同一个配方', () => {
    const slow = { medianShotSeconds: 3.6, sampleSize: 20 }
    const picks = new Set([0, 1, 2, 3, 4].map((s) => pickShotRecipe('brand', s, false, slow).key))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('缩池后不足 2 个候选时保留整池（宁可不改也不逼到死角）', () => {
    const absurd = { medianShotSeconds: 99, sampleSize: 20 }
    const withHint = [0, 1, 2].map((s) => pickShotRecipe('sales', s, false, absurd).key)
    const without = [0, 1, 2].map((s) => pickShotRecipe('sales', s).key)
    expect(withHint).toEqual(without)
  })

  it('叙事人格优先级高于节奏（PM 对 CTS 的第一人称决定不被数据推翻）', () => {
    const fast = { medianShotSeconds: 1.6, sampleSize: 50 }
    expect(pickShotRecipe('sales', 0, true, fast).key).toBe('personal_story')
  })
})

describe('recipeMedianShotSeconds', () => {
  it('每套配方都能算出正的中位镜长', () => {
    for (const r of SHOT_RECIPES) {
      expect(recipeMedianShotSeconds(r), r.key).toBeGreaterThan(0)
    }
  })
})
