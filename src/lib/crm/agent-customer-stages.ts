/**
 * 旅行社（Agent）送来的终端客户的进度阶段。
 *
 * 这 7 个阶段属**旅游行业专属**，刻意不写进数据库 CHECK 约束（见
 * supabase/migrations/20260925001000_agent_customers.sql 的 stage 字段）。
 * 合法值只由本文件的常量白名单管住 —— 改阶段定义只动这一个文件，
 * 不用改表、不用跑 migration（实测证据：agent_customers.stage 无 CHECK，
 * 新增/删除阶段值不需要任何 DDL 变更）。
 *
 * 以后接非旅游客户（如地产）时，另建一份阶段常量，不要改这里。
 */

export const TRAVEL_AGENT_CUSTOMER_STAGES = [
  'new',
  'quoting',
  'quoted',
  'confirmed',
  'deposit_paid',
  'completed',
  'lost',
] as const

export type TravelAgentCustomerStage = typeof TRAVEL_AGENT_CUSTOMER_STAGES[number]

export function isValidStage(value: unknown): value is TravelAgentCustomerStage {
  if (typeof value !== 'string') return false
  return (TRAVEL_AGENT_CUSTOMER_STAGES as readonly string[]).includes(value)
}

/**
 * 7 个阶段的中文标签映射。UI 侧 import 使用，不再各自硬编码一份。
 */
export const TRAVEL_STAGE_LABELS: Record<TravelAgentCustomerStage, string> = {
  new: '新询价',
  quoting: '报价中',
  quoted: '已报价',
  confirmed: '已确认',
  deposit_paid: '已付定',
  completed: '已出行',
  lost: '流失',
}
