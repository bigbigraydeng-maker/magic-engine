import { describe, it, expect } from 'vitest'
import {
  FACTORY_STAGES,
  WORK_ORDER_STAGE,
  stageOfWorkOrder,
  stageOfContentPost,
} from './content-stages'

describe('content-stages · 状态归段', () => {
  it('工单 16 态全部映射到某一段（无遗漏）', () => {
    const all = [
      'queued', 'claimed', 'producing', 'rendered', 'in_review', 'review_rejected',
      'approved', 'publishing', 'publish_failed', 'published', 'measuring', 'closed',
      'failed', 'dead_letter', 'archived', 'superseded',
    ] as const
    expect(Object.keys(WORK_ORDER_STAGE).sort()).toEqual([...all].sort())
    for (const s of all) {
      expect(FACTORY_STAGES).toContain(WORK_ORDER_STAGE[s])
    }
  })

  it('广告工单关键映射正确（改坏会被抓）', () => {
    expect(stageOfWorkOrder('producing')).toBe('出片')
    expect(stageOfWorkOrder('rendered')).toBe('出片')
    expect(stageOfWorkOrder('dead_letter')).toBe('出片')  // 卡死留在出片显眼
    expect(stageOfWorkOrder('in_review')).toBe('发布')
    expect(stageOfWorkOrder('published')).toBe('发布')
    expect(stageOfWorkOrder('measuring')).toBe('看表现')
    expect(stageOfWorkOrder('closed')).toBe('看表现')
  })

  it('organic 内容(content_posts)按 status+有无视频 推导 5 段', () => {
    expect(stageOfContentPost({ status: 'draft', hasVideo: false })).toBe('选题')
    expect(stageOfContentPost({ status: 'rejected', hasVideo: false })).toBe('选题')
    expect(stageOfContentPost({ status: 'approved', hasVideo: false })).toBe('备料')  // 已确认，备料中
    expect(stageOfContentPost({ status: 'approved', hasVideo: true })).toBe('出片')   // 素材到位
    expect(stageOfContentPost({ status: 'scheduled', hasVideo: true })).toBe('发布')
    expect(stageOfContentPost({ status: 'published', hasVideo: true })).toBe('看表现')
  })

  it('恰好 5 段', () => {
    expect(FACTORY_STAGES).toEqual(['选题', '备料', '出片', '发布', '看表现'])
  })
})
