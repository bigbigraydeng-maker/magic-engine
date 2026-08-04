/**
 * 客户状态受控词表 —— clients.client_status 的写入侧唯一来源。
 *
 * 为什么要这个字段：clients 表混着真客户和 Discovery 调研档案，
 * 所有周期性监测 cron（关键词快照 / AI 可见度 / SEO 盯梢…）只对
 * `client_status = 'active'` 的真客户跑 —— 这是花钱 API 的成本闸门。
 * 张骞 Discovery / prospecting 的一次性调用不看此字段（本来就该对调研档案跑）。
 *
 * spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 0
 */

import type { ClientStatus } from '@/types/magic-engine'

export interface ClientStatusOption {
  value: ClientStatus
  /** 后台下拉里给 FDE/PM 看的中文标签 */
  label: string
  /** 选项下方的一句话说明 */
  hint: string
}

export const CLIENT_STATUS_OPTIONS: ClientStatusOption[] = [
  { value: 'active',   label: '✅ 真客户（监测开）',  hint: '所有周期性监测 cron 只对这个状态跑，花钱的数据采集都在这里' },
  { value: 'prospect', label: '🔍 调研档案（默认）', hint: 'Discovery / 潜在客户档案，不进任何周期性监测，不花监测钱' },
  { value: 'archived', label: '📦 已归档',           hint: '停止合作或不再跟进，与 prospect 一样不进监测' },
]

const BY_VALUE = new Map(CLIENT_STATUS_OPTIONS.map((o) => [o.value, o]))

/** 是否为词表内的规范值 */
export function isKnownClientStatus(value: string): value is ClientStatus {
  return BY_VALUE.has(value as ClientStatus)
}
