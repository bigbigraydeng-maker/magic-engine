import { describe, it, expect } from 'vitest'
import {
  FACTORY_B_TRACK_SCENE_TAGS,
  FACTORY_CLIENT_DERIVED_SCENE_TAG,
} from './constants'

/**
 * 2026-08-03 实测事故：Oztop 第一条片子做出来了（15 秒成品在硬盘上），
 * 但入库那一步报 `b_generated scene_tag 'gen_middle' not in abstract whitelist`。
 *
 * 死结链条：排产写 scene_tag='pending_resolution' → worker 兜底成 `gen_<role>`
 * → 入库闸只认 6 个抽象标签 → **任何含生成镜头的工单都在最后一步卡死**。
 * 这解释了工厂长期只有 1 条 published、1 条卡在 rendered。
 */
describe('生成镜头的场景标签 —— 必须能通过入库闸', () => {
  const allowed = [...FACTORY_B_TRACK_SCENE_TAGS, FACTORY_CLIENT_DERIVED_SCENE_TAG]

  it('🔴 worker 的兜底标签一律进不了闸 —— 所以排产不许留「待定」', () => {
    for (const role of ['hook', 'middle', 'cta']) {
      expect(allowed).not.toContain(`gen_${role}`)
    }
    expect(allowed).not.toContain('pending_resolution')
  })

  it('客户自己照片衍生的片段有专属类别，能入库', () => {
    expect(allowed).toContain(FACTORY_CLIENT_DERIVED_SCENE_TAG)
  })

  it('它跟抽象白名单是两类，别混 —— 放行理由不同', () => {
    expect(FACTORY_B_TRACK_SCENE_TAGS as readonly string[])
      .not.toContain(FACTORY_CLIENT_DERIVED_SCENE_TAG)
  })

  it('抽象白名单本身没被改动（防止有人为了放行随手往里塞）', () => {
    expect([...FACTORY_B_TRACK_SCENE_TAGS]).toEqual([
      'sunset_mood', 'texture_detail', 'aerial_abstract',
      'water_reflection', 'light_bokeh', 'cloud_timelapse',
    ])
  })
})
