/**
 * 按客户类型（clients.client_kind）决定概览页哪些区块可见。
 *
 * NULL / 缺列 / 读不到 → 与普通客户相同（见 readEffectiveClientKind）。
 * 个人 IP 首屏改为五格关键数字，隐藏普通客户那套 DAPE 诊断大卡，其余 tab 不变。
 */

import type { ClientKind } from '@/types/diagnostic'
import { readClientKind } from '@/lib/huatuo/personal-ip'

/** 概览 tab 里的区块开关。普通客户全开（personal_ip_metrics 除外）。 */
export type KindOverviewSection =
  | 'workflow_progress'
  | 'next_step'
  | 'brand_health'
  | 'zhuge_priority'
  | 'intelligence_summary'
  | 'brief_banner'
  | 'personal_ip_metrics'

const ALL_SECTIONS: readonly KindOverviewSection[] = [
  'workflow_progress',
  'next_step',
  'brand_health',
  'zhuge_priority',
  'intelligence_summary',
  'brief_banner',
  'personal_ip_metrics',
] as const

/** 资料里的 client_kind；缺省 = standard。 */
export function readEffectiveClientKind(raw: unknown): ClientKind {
  return readClientKind(raw)
}

export function hasKindOverviewSection(
  kind: ClientKind | null | undefined,
  section: KindOverviewSection,
): boolean {
  return kindFeatureFlags(kind)[section]
}

/** 一次拿齐概览区块开关。 */
export function kindFeatureFlags(
  kind: ClientKind | null | undefined,
): Record<KindOverviewSection, boolean> {
  const effective = kind ?? 'standard'
  if (effective !== 'personal_ip') {
    return {
      workflow_progress: true,
      next_step: true,
      brand_health: true,
      zhuge_priority: true,
      intelligence_summary: true,
      brief_banner: true,
      personal_ip_metrics: false,
    }
  }
  return {
    workflow_progress: false,
    next_step: true,
    brand_health: false,
    zhuge_priority: false,
    intelligence_summary: false,
    brief_banner: true,
    personal_ip_metrics: true,
  }
}

export function allKindOverviewSections(): readonly KindOverviewSection[] {
  return ALL_SECTIONS
}
