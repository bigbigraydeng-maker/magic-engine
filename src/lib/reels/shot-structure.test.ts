/**
 * 分镜头结构测量测试。
 *
 * 样本用真实数据:
 * - 我们自己那条被 PM 判「千篇一律」的成片(24.4 秒,标准阈值下只有 1 个切点)
 * - ffmpeg showinfo 的真实 stderr 片段格式
 *
 * 这个模块存在的意义就是「不再猜数字」,所以它自己的测试尤其不能是空架子。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENE_THRESHOLD,
  buildShotRecipe,
  parseSceneTimestamps,
  summariseRecipes,
} from './shot-structure'

// ffmpeg 8.1.2 真实输出格式(节选自本机实跑)
const REAL_STDERR = `
[Parsed_select_0 @ 0x7f8] n:  12 pts: 12288 pts_time:0.4
[Parsed_showinfo_1 @ 0x7f9] n:   0 pts:  25600 pts_time:0.853333 duration:512
[Parsed_showinfo_1 @ 0x7f9] n:   1 pts:  76800 pts_time:2.56 duration:512
[Parsed_showinfo_1 @ 0x7f9] n:   2 pts: 153600 pts_time:5.12 duration:512
frame=  100 fps=0.0 q=-0.0 size=N/A time=00:00:03.33 bitrate=N/A speed=6.66x
`

describe('parseSceneTimestamps — 从 ffmpeg stderr 抠切点', () => {
  it('抠出 showinfo 行的时刻', () => {
    expect(parseSceneTimestamps(REAL_STDERR)).toEqual([0.853333, 2.56, 5.12])
  })

  it('🔴 只认 showinfo 行 —— 别的滤镜也会打 pts_time,混进来数字就错了', () => {
    // 上面样本里 Parsed_select_0 那行有 pts_time:0.4,不能被算成切点
    expect(parseSceneTimestamps(REAL_STDERR)).not.toContain(0.4)
  })

  it('同一时刻打两行 → 去重', () => {
    const s = `[Parsed_showinfo_1 @ 0x1] pts_time:3.5\n[Parsed_showinfo_1 @ 0x1] pts_time:3.5`
    expect(parseSceneTimestamps(s)).toEqual([3.5])
  })

  it('乱序输入 → 升序输出', () => {
    const s = `[Parsed_showinfo_1 @ 0x1] pts_time:9.0\n[Parsed_showinfo_1 @ 0x1] pts_time:2.0`
    expect(parseSceneTimestamps(s)).toEqual([2, 9])
  })

  it('无切点 / 空串 / 垃圾文本 → 空数组,不炸', () => {
    expect(parseSceneTimestamps('')).toEqual([])
    expect(parseSceneTimestamps('no matches here')).toEqual([])
    expect(parseSceneTimestamps('[Parsed_showinfo_1] pts_time:abc')).toEqual([])
  })
})

describe('buildShotRecipe — 组装配方', () => {
  it('🔴 我们自己那条片:24.4 秒 1 个切点 = 整条几乎是一个长镜头', () => {
    const r = buildShotRecipe({ durationSeconds: 24.4, cutTimes: [21.43] })
    expect(r.shot_count).toBe(2)
    expect(r.rhythm.median_shot_seconds).toBeGreaterThan(10) // 慢到离谱
    expect(r.rhythm.cuts_per_second).toBeLessThan(0.05)
    expect(r.hook.shots_in_first_3s).toBe(1) // 开场 3 秒一刀都没有
  })

  it('快剪样本:22 秒 18 刀 → 中位镜头约 1 秒出头', () => {
    const cuts = Array.from({ length: 18 }, (_, i) => Number(((i + 1) * 1.15).toFixed(2)))
    const r = buildShotRecipe({ durationSeconds: 22, cutTimes: cuts })
    expect(r.shot_count).toBe(19)
    expect(r.rhythm.median_shot_seconds).toBeCloseTo(1.15, 1)
    expect(r.rhythm.cuts_per_second).toBeCloseTo(0.82, 1)
    expect(r.hook.shots_in_first_3s).toBe(3)
  })

  it('🔴 无切点 → 一个镜头(不是零个),否则汇总时会被当成坏样本丢掉', () => {
    const r = buildShotRecipe({ durationSeconds: 15, cutTimes: [] })
    expect(r.shot_count).toBe(1)
    expect(r.shots).toEqual([{ start: 0, duration: 15 }])
    expect(r.hook.first_cut_at).toBeNull()
  })

  it('🔴 首尾误报的切点要丢掉(检测器会在第 0 帧和末帧误命中)', () => {
    const r = buildShotRecipe({ durationSeconds: 10, cutTimes: [0, 4, 10, 12, -1] })
    expect(r.cut_times).toEqual([4])
    expect(r.shot_count).toBe(2)
  })

  it('切点乱序/重复 → 仍然算对', () => {
    const r = buildShotRecipe({ durationSeconds: 10, cutTimes: [6, 2, 6, 2] })
    expect(r.cut_times).toEqual([2, 6])
    expect(r.shots.map((s) => s.duration)).toEqual([2, 4, 4])
  })

  it('时长取不到(0 / NaN)→ 空配方,不炸', () => {
    for (const d of [0, -5, NaN, Infinity]) {
      const r = buildShotRecipe({ durationSeconds: d, cutTimes: [1, 2] })
      expect(r.shot_count).toBe(0)
      expect(r.duration_seconds).toBe(0)
    }
  })

  it('🔴 测量口径必须存下来 —— 不同阈值的数字不能直接比', () => {
    const a = buildShotRecipe({ durationSeconds: 10, cutTimes: [5] })
    expect(a.measured_with.scene_threshold).toBe(DEFAULT_SCENE_THRESHOLD)
    const b = buildShotRecipe({ durationSeconds: 10, cutTimes: [5], sceneThreshold: 0.1 })
    expect(b.measured_with.scene_threshold).toBe(0.1)
    expect(b.measured_with.method).toBe('ffmpeg_scene_detect')
  })

  it('镜头首尾相接,总和等于时长(不丢帧不重叠)', () => {
    const r = buildShotRecipe({ durationSeconds: 12, cutTimes: [3, 7.5] })
    const total = r.shots.reduce((s, x) => s + x.duration, 0)
    expect(total).toBeCloseTo(12, 2)
    for (let i = 1; i < r.shots.length; i++) {
      expect(r.shots[i].start).toBeCloseTo(r.shots[i - 1].start + r.shots[i - 1].duration, 2)
    }
  })

  it('前 3 秒镜头数按边界算对(恰好 3.0 秒的切点不算进开场)', () => {
    expect(buildShotRecipe({ durationSeconds: 10, cutTimes: [2.99] }).hook.shots_in_first_3s).toBe(2)
    expect(buildShotRecipe({ durationSeconds: 10, cutTimes: [3.0] }).hook.shots_in_first_3s).toBe(1)
  })
})

describe('summariseRecipes — 汇总成目标值', () => {
  const mk = (dur: number, cuts: number[]) => buildShotRecipe({ durationSeconds: dur, cutTimes: cuts })

  it('🔴 用中位数不用均值(样本里混一条长片,均值会被拖飞)', () => {
    const fast = Array.from({ length: 5 }, () => mk(20, [4, 8, 12, 16]))
    const outlier = mk(600, [300]) // 一条 10 分钟长片
    const s = summariseRecipes([...fast, outlier])
    expect(s.median_duration_seconds).toBe(20) // 没被 600 拖走
    expect(s.sample_size).toBe(6)
  })

  it('空配方(时长取不到的坏样本)不计入分母', () => {
    const s = summariseRecipes([mk(20, [10]), mk(0, []), mk(0, [])])
    expect(s.sample_size).toBe(1)
  })

  it('空输入 → 全 0,不炸', () => {
    expect(summariseRecipes([]).sample_size).toBe(0)
    expect(summariseRecipes([]).median_shot_seconds).toBe(0)
  })

  it('🔴 汇总结果能直接回答「单镜头该几秒」—— 这正是之前答不出来的问题', () => {
    const s = summariseRecipes(Array.from({ length: 9 }, () => mk(24, [1.2, 2.4, 3.6, 4.8, 6, 7.2])))
    expect(s.median_shot_seconds).toBeGreaterThan(0)
    expect(s.median_shot_count).toBeGreaterThan(0)
    expect(s.median_shots_in_first_3s).toBeGreaterThanOrEqual(2)
  })
})
