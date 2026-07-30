// 内容工厂 · 5 段流水线的"状态→段"归组（单一来源）
//
// 背景：内容工厂看板把内容分 5 段展示：选题 → 备料 → 出片 → 发布 → 看表现。
// 数据来自两处，零 migration：
//   - 前两段（选题/备料）= content_posts 候选（选题助理产出，人确认后备料）
//   - 后三段（出片/发布/看表现）= content_work_orders 工单（生产生命周期，已有 16 态）
// 桥：候选备料齐了才建一条工单，进入出片段。
//
// 穷举护栏（魏征 H1/H2）：
//   - 工单线用 Record<WorkOrderStatus,...>，键漏了编译报错。
//   - 候选线用 stageOfContentPost 里的 switch + `never` 默认分支：加了 ContentPostStatus
//     的值却没归段，编译报错。两条线都是真护栏，不留"假承诺"。

import type { WorkOrderStatus } from './types'

export const FACTORY_STAGES = ['选题', '备料', '出片', '发布', '看表现'] as const
export type FactoryStage = (typeof FACTORY_STAGES)[number]

/** content_work_orders 16 态 → 5 段。工单最早从「出片」开始（选题/备料在工单之前的候选阶段）。 */
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
  // 看表现：统计效果 / 收尾 / 归档
  measuring: '看表现',
  closed: '看表现',
  archived: '看表现',
  superseded: '看表现',
}

/** content_posts 候选状态（DB CHECK 的 5 值）。 */
export type ContentPostStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'

/**
 * organic 内容（content_posts）→ 5 段。零 migration：从已有字段推导。
 * - 选题：draft/rejected 候选（选题助理产出，待确认）
 * - 备料：approved 但还没有视频（已确认，准备素材中）
 * - 出片：approved 且已有视频（素材到位，出片中）
 * - 发布：scheduled（已排期/待发）
 * - 看表现：published（回收数据）
 */
export function stageOfContentPost(input: {
  status: ContentPostStatus
  hasVideo: boolean
}): FactoryStage {
  const { status, hasVideo } = input
  switch (status) {
    case 'draft':
    case 'rejected':
      return '选题'
    case 'approved':
      return hasVideo ? '出片' : '备料'
    case 'scheduled':
      return '发布'
    case 'published':
      return '看表现'
    default: {
      // 穷举守卫：加了 ContentPostStatus 却没在上面归段 → 编译报错（真护栏，非假承诺）
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export function stageOfWorkOrder(status: WorkOrderStatus): FactoryStage {
  // content_work_orders 是 Meta 广告工厂（有 budget/ad_id）。这个映射留给"广告线看板"，
  // 大瑞的 organic 小红书/抖音内容不走这里 —— 走上面 stageOfContentPost。
  return WORK_ORDER_STAGE[status]
}
