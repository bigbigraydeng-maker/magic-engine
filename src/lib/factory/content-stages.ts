// 内容工厂 · 5 段流水线的"状态→段"归组(单一来源)
//
// 背景：内容工厂看板把内容分 5 段展示：选题 → 录制 → 出片 → 发布 → 复盘。
// 数据来自两处，零 migration：
//   - 前两段（选题/录制）= content_posts 候选（选题助理产出，人确认后待录）
//   - 后三段（出片/发布/复盘）= content_work_orders 工单（生产生命周期，已有 16 态）
// 桥：候选上传素材后才建一条工单，进入出片段。
//
// 两个 Record 都用编译期穷举守卫（照 statusMeta.ts 范式）：加了状态却忘了归段会编译报错，
// 否则该状态的卡片会在看板上静默消失。

import type { WorkOrderStatus } from './types'

export const FACTORY_STAGES = ['选题', '录制', '出片', '发布', '复盘'] as const
export type FactoryStage = (typeof FACTORY_STAGES)[number]

/** content_work_orders 16 态 → 5 段。工单最早从「出片」开始（选题/录制在工单之前的候选阶段）。 */
export const WORK_ORDER_STAGE: Record<WorkOrderStatus, FactoryStage> = {
  // 出片：装配中 / 已出片（rendered 为历史停用态，仍归出片）
  queued: '出片',
  claimed: '出片',
  producing: '出片',
  rendered: '出片',
  failed: '出片',       // 生产失败，卡在出片
  dead_letter: '出片',  // 生产卡死待处理，留在出片段显眼
  // 发布：审核 → 通过 → 发布
  in_review: '发布',
  review_rejected: '发布',
  approved: '发布',
  publishing: '发布',
  publish_failed: '发布',
  published: '发布',
  // 复盘：统计效果 / 收尾 / 归档
  measuring: '复盘',
  closed: '复盘',
  archived: '复盘',
  superseded: '复盘',
}

/** content_posts 候选状态（DB CHECK 的 5 值）→ 5 段的前段。 */
export type ContentPostStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'
export const CONTENT_POST_STAGE: Record<ContentPostStatus, FactoryStage> = {
  draft: '选题',      // 选题助理产出的候选，待人确认
  approved: '录制',   // 已确认，待录 / 录制中（等素材上传后转工单）
  rejected: '选题',   // 打回，回到选题段
  scheduled: '发布',  // 少数不经工厂、直接排期的老数据
  published: '复盘',  // 同上，已发布的老数据
}

export function stageOfWorkOrder(status: WorkOrderStatus): FactoryStage {
  return WORK_ORDER_STAGE[status]
}
export function stageOfContentPost(status: ContentPostStatus): FactoryStage {
  return CONTENT_POST_STAGE[status]
}
