import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAddCreativeDisplay } from '../display'
import type { CreativeOrder } from '../order'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'

const base: CreativeOrder = {
  adAccountId: 'act_123456789012',
  adSetId: '998877665544',
  imagePath: `renders/${CLIENT}/wo/poster.jpg`,
  primaryText: '正文一行',
  headline: '标题短句',
  ctaType: 'LEARN_MORE',
  adName: '测试广告名',
  status: 'PAUSED',
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.example.supabase.co')
})

describe('buildAddCreativeDisplay', () => {
  it('builds public image url and Chinese labels', () => {
    const view = buildAddCreativeDisplay(base)
    expect(view.imageUrl).toBe(
      `https://project.example.supabase.co/storage/v1/object/public/content-factory/${base.imagePath}`,
    )
    expect(view.imageFilename).toBe('poster.jpg')
    expect(view.ctaLabel).toBe('了解更多')
    expect(view.newAdStatusLabel).toBe('先暂停')
    expect(view.adSetLabel).toContain('998877665544')
    expect(view.adSetLabel).toContain('组名未记录')
    expect(view.confirmSentence).toContain('暂停中')
  })

  it('uses a stored ad set name when present', () => {
    const view = buildAddCreativeDisplay(base, '皇后镇转化组')
    expect(view.adSetLabel).toBe('皇后镇转化组')
    expect(view.adSetLabel).not.toContain('未记录')
  })
})