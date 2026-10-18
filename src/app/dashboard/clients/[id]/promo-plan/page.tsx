/**
 * 推广计划 —— PM 每周看的一页纸。付费客户 / 管理员可见（和 Marketing Plan 同一道门）。
 * 设计稿：docs/specs/2026-10-14-promo-plan-board-design-v0.1.md
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { PromoPlanClient } from './_client'

const SUBTITLE = '推广计划：先有计划，批准了才动手；每周一页看清花了多少、做得怎么样。'

export default function Page() {
  return (
    <ServerFeatureLock feature='推广计划' subtitle={SUBTITLE}>
      <PromoPlanClient />
    </ServerFeatureLock>
  )
}
