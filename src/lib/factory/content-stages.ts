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
  // content_work_orders 是 Meta 广告工厂（有 budget/ad_id）。这个映射留给"广告线看板"，
  // 大瑞的 organic 小红书/抖音内容不走这里 —— 走下面 stageOfContentPost。
  return WORK_ORDER_STAGE[status]
}

/**
 * organic 内容（content_posts）→ 5 段。零 migration：从已有字段推导，不新增状态。
 * - 选题：draft/rejected 候选（选题助理产出，待确认）
 * - 录制：approved 但还没有视频（已确认，等大瑞录/传素材）
 * - 出片：approved 且已有视频（素材到位，出片助理处理中/已出片，待排期）
 * - 发布：scheduled 或已进发布通道
 * - 复盘：published（回收数据）
 */
export function stageOfContentPost(input: {
  status: ContentPostStatus
  hasVideo: boolean
}): FactoryStage {
  const { status, hasVideo } = input
  if (status === 'published') return '复盘'
  if (status === 'scheduled') return '发布'
  if (status === 'approved') return hasVideo ? '出片' : '录制'
  return '选题' // draft / rejected
}
