// Facebook 的转公开平台规则:自 guards / context / resume / publish-steps 原样搬入,行为不变。
// 主页 id 在 Facebook 里就是「账号 id」;存库字段名(page_id 等)保持不变。

import type { PublishTarget } from '../../types'
import { asRecord, nonEmptyString } from './record'
import type { IdsCheck, PortFailure, PromotePlatformPort } from './platform-port'
import type { MetaReelView, PromoteOrder, TrafficRow } from './types'

/** 发布目标:必须是 Facebook 主页,且配置了防误发品牌名。 */
function checkTarget(target: PublishTarget | null): PortFailure | null {
  if (!target || target.platform !== 'facebook' || !nonEmptyString(target.page_id)) {
    return { status: 422, error: '发布目标未配置或不是 Facebook 主页,不能转公开' }
  }
  if (!nonEmptyString(target.expect_brand)) {
    return { status: 422, error: '防误发品牌名缺失,不能转公开' }
  }
  return null
}

/** 视频 id 与主页 id 三方一致(顺序:先视频 id,后主页 id)。 */
function checkIds(order: PromoteOrder, row: TrafficRow, target: PublishTarget): IdsCheck {
  const publishedRef = asRecord(order.published_ref)
  const payload = asRecord(row.payload)

  const orderVideoId = nonEmptyString(publishedRef['video_id'])
  const rowVideoId = nonEmptyString(payload['video_id'])
  if (!orderVideoId || !rowVideoId || orderVideoId !== rowVideoId) {
    return { ok: false, status: 409, error: '工单与流量记录的视频 id 不一致,不能转公开' }
  }

  const orderPageId = nonEmptyString(publishedRef['page_id'])
  const rowPageId = nonEmptyString(payload['page_id'])
  if (!orderPageId || !rowPageId || orderPageId !== target.page_id || rowPageId !== target.page_id) {
    return { ok: false, status: 409, error: '工单、流量记录与发布目标的主页 id 不一致,不能转公开' }
  }

  return { ok: true, videoId: orderVideoId, accountId: orderPageId }
}

/** 区分「Meta 没返回所属主页」与「不属本页」(设计稿第 4 节)。 */
function checkOwnership(view: MetaReelView, accountId: string): PortFailure | null {
  if (!view.fromId) return { status: 422, error: 'Meta 没有返回视频所属主页,保守拒绝' }
  if (view.fromId !== accountId) return { status: 409, error: '这条视频不属于本客户的主页,已拦截' }
  return null
}

export const facebookPromotePort: PromotePlatformPort = {
  platform: 'facebook',
  checkTarget,
  checkIds,
  checkOwnership,
  matchesStoredAccount: (target, storedAccountId) => target.page_id === storedAccountId,
  publishedRefExtras: () => ({ ig_crosspost_blocked: true }),
}
