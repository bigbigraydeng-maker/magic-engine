/**
 * kindToDimension — 子牙 + 魏征复审要求：newsletter_email 必须显式映射到
 * 'social'，不能靠"else 分支默认归社媒"蒙对（2026-09-08 newsletter 排期设计）。
 * 加新 PlanTaskKind 时如果忘了在这里也加一行，这个测试会挂，提醒回来补映射。
 */

import { describe, expect, it } from 'vitest'
import { kindToDimension } from '../task-dispatcher'
import type { PlanTaskKind } from '../types'

describe('kindToDimension', () => {
  it('blog_article 归 seo', () => {
    expect(kindToDimension('blog_article')).toBe('seo')
  })

  it('newsletter_email 显式归 social（不是靠默认分支蒙对）', () => {
    expect(kindToDimension('newsletter_email')).toBe('social')
  })

  it.each<PlanTaskKind>(['social_post', 'social_reel', 'social_story'])(
    '%s 归 social',
    (kind) => {
      expect(kindToDimension(kind)).toBe('social')
    },
  )
})
