import { describe, it, expect } from 'vitest'
import {
  classifyAspect,
  isUsableClip,
  fallbackSceneTag,
  buildCandidates,
  MIN_USABLE_SECONDS,
  type ProbedVideo,
} from './real-footage-ingest'

const probe = (w: number, h: number, dur: number): ProbedVideo => ({
  width: w,
  height: h,
  durationSeconds: dur,
  aspectRatio: classifyAspect(w, h),
})

describe('classifyAspect', () => {
  it('竖屏 iPhone 竖拍 → 9:16', () => {
    expect(classifyAspect(1080, 1880)).toBe('9:16')
    expect(classifyAspect(480, 836)).toBe('9:16')
  })

  it('横屏 720p → 16:9', () => {
    expect(classifyAspect(1280, 720)).toBe('16:9')
  })

  it('方图 → 1:1', () => {
    expect(classifyAspect(1000, 1000)).toBe('1:1')
  })

  it('探测不到宽高 → unknown，不硬猜', () => {
    expect(classifyAspect(0, 0)).toBe('unknown')
  })
})

describe('isUsableClip', () => {
  it('竖屏够长 → 收，且不用裁', () => {
    const r = isUsableClip(probe(1080, 1880, 12))
    expect(r.ok).toBe(true)
    expect(r.needsCrop).toBe(false)
  })

  it('🔴 横屏不拒收，只标「要裁」—— 库里现有 30-kiteroa 那批就是横屏裁进来的', () => {
    const r = isUsableClip(probe(1280, 720, 17.8))
    expect(r.ok).toBe(true)
    expect(r.needsCrop).toBe(true)
  })

  it('太短 → 拒（装配时撑不住一个镜头）', () => {
    const r = isUsableClip(probe(1080, 1880, MIN_USABLE_SECONDS - 0.1))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('太短')
  })

  it('时长探测失败 → 拒，不当成 0 秒收进来', () => {
    expect(isUsableClip(probe(1080, 1880, 0)).ok).toBe(false)
    expect(isUsableClip(probe(1080, 1880, NaN)).ok).toBe(false)
  })
})

describe('fallbackSceneTag', () => {
  it('相机默认名没有语义 → 兜底成 real_footage_NN，不编假标签', () => {
    expect(fallbackSceneTag('IMG_7630.MOV', 0)).toBe('real_footage_01')
    expect(fallbackSceneTag('DSC0001.mp4', 4)).toBe('real_footage_05')
    expect(fallbackSceneTag('20260802.mp4', 1)).toBe('real_footage_02')
  })

  it('有语义的文件名保留下来（出片按 scene_tag 与角度做词重叠挑片）', () => {
    expect(fallbackSceneTag('showroom_tile_stone_walls.mp4', 0)).toBe('showroom_tile_stone_walls')
    expect(fallbackSceneTag('OZtop PetFlooring 26.6.4.mov', 0)).toBe('oztop_petflooring_26_6_4')
  })

  it('超长文件名截断，不产出没法看的标签', () => {
    expect(fallbackSceneTag(`${'a'.repeat(200)}.mp4`, 0).length).toBeLessThanOrEqual(60)
  })
})

describe('buildCandidates', () => {
  const files = [
    { filePath: '/a/IMG_1.MOV', fileName: 'IMG_1.MOV', probe: probe(1080, 1880, 10) },
    { filePath: '/a/IMG_2.MOV', fileName: 'IMG_2.MOV', probe: probe(1280, 720, 18) },
    { filePath: '/a/tiny.MOV', fileName: 'tiny.MOV', probe: probe(1080, 1880, 0.5) },
  ]

  it('已入库的标出来跳过 —— 重复跑不会重复入库', () => {
    const out = buildCandidates(files, new Set(['/a/IMG_1.MOV']))
    expect(out[0].skip).toBe('已入库')
    expect(out[1].skip).toBeUndefined()
  })

  it('太短的标出原因，不静默丢掉', () => {
    const out = buildCandidates(files, new Set())
    expect(out[2].skip).toContain('太短')
  })

  it('横屏进候选但带「要裁」标记', () => {
    const out = buildCandidates(files, new Set())
    expect(out[1].skip).toBeUndefined()
    expect(out[1].needsCrop).toBe(true)
  })

  it('空输入返回空，不炸', () => {
    expect(buildCandidates([], new Set())).toEqual([])
  })
})
