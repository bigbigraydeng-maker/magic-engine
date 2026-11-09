/**
 * 审核页的前端类型。
 *
 * 🔴 全部用 `import type` 从 `src/lib/knowledge/*` 取，编译期就被擦掉，运行
 * 时一行服务端代码都不会被打进浏览器包。这不是风格洁癖：本仓库出过
 * 「client 组件 import 了服务端模块 → build 和 CI 全绿，只在浏览器里整页
 * 崩」的事故。
 */

import type { CandidateGroup } from '@/lib/knowledge/review'
import type { PendingConfirmationFact } from '@/lib/knowledge/review'

export type { CandidateGroup, PendingConfirmationFact }

export interface CandidatesResponse {
  success: boolean
  groups?: CandidateGroup[]
  error?: string
}

export interface ConfirmationRequestRow {
  id: string
  confirmer_email: string
  status: string
  expires_at: string
  confirmed_at: string | null
  created_at: string
  created_by_email: string
  outcome: Record<string, unknown> | null
}

export interface ConfirmationsResponse {
  success: boolean
  facts?: PendingConfirmationFact[]
  confirmers?: string[]
  requests?: ConfirmationRequestRow[]
  error?: string
}
