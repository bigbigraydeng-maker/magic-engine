/**
 * 分镜配方测试。
 *
 * 这组测试守两件会「静默毁片」的事:
 * ① 转场名必须是 ffmpeg 真认识的 —— make_promo.py 零校验直接拼进 filter 字符串,
 *    传错名字不是降级,是整单装配失败。
 * ② 段时长必须大于转场时长 —— 段长 ≤ 转场会被过渡整段吞掉(这个 bug 修过一次,
 *    别用配方把它放回来)。
 */

import { describe, expect, it } from 'vitest'
import { SHOT_RECIPES, XFADE_TRANSITIONS, pickShotRecipe } from './shot-recipes'

/** ME 配置页允许的转场时长上限(client-config.ts MAX_XFADE_SEC) */
const MAX_XFADE_SEC = 0.9

describe('配方结构 — 防静默毁片', () => {
  it('🔴 所有转场名都在 ffmpeg 实测白名单里(传错名字=整单装配失败)', () => {
    for (const r of SHOT_RECIPES) {
      for (const s of r.shots) {
        expect(XFADE_TRANSITIONS, `${r.key}/${s.role} 用了白名单外的转场 "${s.transition}"`)
          .toContain(s.transition)
      }
    }
  })

  it('🔴 每段时长必须大于转场时长上限(否则该段被过渡整段吞掉)', () => {
    for (const r of SHOT_RECIPES) {
      for (const s of r.shots) {
        expect(s.duration_hint_s, `${r.key}/${s.role} 段长 ${s.duration_hint_s}s 不大于转场上限`)
          .toBeGreaterThan(MAX_XFADE_SEC)
      }
    }
  })

  it('每个配方都以 hook 开头、cta 收尾(装配层靠 role 排文案和结尾卡)', () => {
    for (const r of SHOT_RECIPES) {
      expect(r.shots[0].role, `${r.key} 首镜不是 hook`).toBe('hook')
      expect(r.shots[r.shots.length - 1].role, `${r.key} 末镜不是 cta`).toBe('cta')
    }
  })

  it('总时长落在竖屏完播甜区 10–30s(故事型刻意更长:讲情感需要时间)', () => {
    for (const r of SHOT_RECIPES) {
      const total = r.shots.reduce((s, x) => s + x.duration_hint_s, 0)
      expect(total, `${r.key} 总时长 ${total}s 越界`).toBeGreaterThanOrEqual(10)
      expect(total).toBeLessThanOrEqual(30)
    }
  })

  it('配方 key 唯一(pickShotRecipe 靠 key 查找)', () => {
    const keys = SHOT_RECIPES.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('配方多样性 — 这正是要治的病', () => {
  it('🔴 不同配方之间段数不能全一样(否则又回到千篇一律)', () => {
    const counts = new Set(SHOT_RECIPES.map((r) => r.shots.length))
    expect(counts.size).toBeGreaterThan(1)
  })

  it('🔴 单个配方内部转场不能全是同一种(那就是现在这版的毛病)', () => {
    for (const r of SHOT_RECIPES) {
      // 第 0 段无「转入」转场,装配层忽略,不计入多样性判断
      const used = new Set(r.shots.slice(1).map((s) => s.transition))
      expect(used.size, `${r.key} 的转场全是同一种`).toBeGreaterThan(1)
    }
  })

  it('全体配方合计用到多种转场,不是只会 fade', () => {
    const all = new Set(SHOT_RECIPES.flatMap((r) => r.shots.slice(1).map((s) => s.transition)))
    expect(all.size).toBeGreaterThanOrEqual(6)
    expect(all.has('fade') && all.size === 1).toBe(false)
  })
})

describe('pickShotRecipe — 选择与轮换', () => {
  it('纯函数:同输入同输出(本仓禁用随机/时间源,必须可复现)', () => {
    expect(pickShotRecipe('sales', 3).key).toBe(pickShotRecipe('sales', 3).key)
  })

  it('🔴 同客户连续出片会轮换配方(否则「按目标选」退化成新的千篇一律)', () => {
    const picked = [0, 1, 2].map((n) => pickShotRecipe('sales', n).key)
    expect(new Set(picked).size).toBeGreaterThan(1)
  })

  it('有真促销走转化型节奏,纯品牌走叙事型', () => {
    expect(pickShotRecipe('sales', 0).key).toBe('fast_cut')
    expect(pickShotRecipe('brand', 0).key).toBe('narrative')
  })

  it('🔴 有叙事人格 → 强制故事型(第一人称需要时间铺情感,短配方讲不完)', () => {
    for (const goal of ['sales', 'brand', null]) {
      expect(pickShotRecipe(goal, 0, true).key).toBe('personal_story')
    }
    // 无人格时不受影响,仍按目标选
    expect(pickShotRecipe('sales', 0, false).key).toBe('fast_cut')
  })

  it('故事型总时长接近真实爆款量级(≥24s,对标 28.2s 那条)', () => {
    const story = SHOT_RECIPES.find((r) => r.key === 'personal_story')!
    const total = story.shots.reduce((s, x) => s + x.duration_hint_s, 0)
    expect(total).toBeGreaterThanOrEqual(24)
  })

  it('未知/空目标不炸,返回合法配方', () => {
    for (const g of [null, '', 'nonsense']) {
      const r = pickShotRecipe(g, 0)
      expect(SHOT_RECIPES).toContain(r)
    }
  })

  it('种子为负 / 非整数 / 极大值都不炸', () => {
    for (const seed of [-5, 2.7, 1e9, NaN]) {
      expect(SHOT_RECIPES).toContain(pickShotRecipe('brand', seed))
    }
  })
})
