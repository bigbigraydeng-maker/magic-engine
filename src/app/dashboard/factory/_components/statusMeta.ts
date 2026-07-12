// P21.J A1 架构整理 — 工单状态的展示元数据(单一来源)
// Record<WorkOrderStatus,...> 强制穷举:加了 status 却忘了 meta 会编译报错(以前散在 page.tsx
// 用裸 string,加状态漏 meta 只会 UI fallback 空白,不报错)。UI 组件从这里 import,不再各写各的。

import type { WorkOrderStatus } from '@/lib/factory/types'

export const STATUS_META: Record<WorkOrderStatus, { label: string; color: string }> = {
  queued: { label: '排队中', color: 'bg-slate-100 text-slate-700' },
  claimed: { label: '已领取', color: 'bg-blue-100 text-blue-700' },
  producing: { label: '生产中', color: 'bg-blue-100 text-blue-700' },
  rendered: { label: '已出片', color: 'bg-indigo-100 text-indigo-700' },
  in_review: { label: '待审核', color: 'bg-amber-100 text-amber-800' },
  review_rejected: { label: '已打回', color: 'bg-orange-100 text-orange-700' },
  approved: { label: '已通过', color: 'bg-emerald-100 text-emerald-700' },
  publishing: { label: '发布中', color: 'bg-teal-100 text-teal-700' },
  publish_failed: { label: '发布失败', color: 'bg-red-100 text-red-700' },
  published: { label: '已发布', color: 'bg-green-100 text-green-700' },
  measuring: { label: '归因中', color: 'bg-cyan-100 text-cyan-700' },
  closed: { label: '已归档', color: 'bg-slate-100 text-slate-500' },
  failed: { label: '失败', color: 'bg-red-100 text-red-700' },
  dead_letter: { label: '死信队列', color: 'bg-red-200 text-red-900' },
  archived: { label: '已归档', color: 'bg-slate-100 text-slate-500' },
  superseded: { label: '已取代', color: 'bg-slate-100 text-slate-500' },
}

/** 看板分组展示顺序(要拍板的状态在前:死信/发布失败/待审) */
export const STATUS_ORDER = [
  'dead_letter', 'publish_failed', 'in_review', 'rendered', 'review_rejected',
  'producing', 'claimed', 'queued', 'approved', 'publishing', 'published',
  'measuring', 'failed', 'closed', 'archived', 'superseded',
] as const satisfies readonly WorkOrderStatus[]

// 编译期穷举:STATUS_ORDER 漏了某状态即报错——否则该状态工单会在全局看板静默消失(魏征 A1 复审)
type _MissingFromOrder = Exclude<WorkOrderStatus, (typeof STATUS_ORDER)[number]>
const _statusOrderComplete: _MissingFromOrder extends never ? true : ['STATUS_ORDER 缺状态', _MissingFromOrder] = true
void _statusOrderComplete
