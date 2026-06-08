/**
 * 子牙 — Technical Brain Types
 * Reference: docs/agents/10-ziya.md
 */

export type TaskType =
  | 'diagnostic'       // 张骞→华佗→诸葛亮→鲁班
  | 'content_produce'  // AI Factory → 鲁班
  | 'data_collect'     // Data Engine adapter
  | 'fix_execute'      // 诸葛亮 confirm → 鲁班
  | 'code_review'      // 魏征
  | 'design_challenge' // 达芬奇
  | 'seo_plan'         // 东坡
  | 'product_review'   // 郑板桥（UX 体验 + 改进提案）
  | 'qa_test'          // 狄仁杰（功能验收 + 回归测试）
  | 'unknown'          // LLM fallback

export type RouteMethod = 'rule' | 'llm'

export interface ZiyaTaskInput {
  client_id?: string
  task_type?: TaskType
  task_description: string
  triggered_by: 'user' | 'cron' | 'api' | 'fde'
  constraints?: string[]
}

export interface ZiyaTaskResult {
  task_id: string
  route_taken: TaskType
  route_method: RouteMethod
  steps_executed: string[]
  summary: string
  error?: string
}
