/**
 * 广告剧本入口：按 `clients.industry` 选剧本。纯函数，不查库。
 *
 * 只认行业值，**不认客户名 / 客户 ID**。行业为空、不在剧本表里 → default（中性词）。
 */

import type { AdsPlaybook } from './types'
import { DEFAULT_ADS_PLAYBOOK } from './default'
import { LOGISTICS_ADS_PLAYBOOK } from './logistics'
import { TRAVEL_ADS_PLAYBOOK } from './travel'
import { REAL_ESTATE_ADS_PLAYBOOK } from './real-estate'
import { ECOMMERCE_ADS_PLAYBOOK } from './ecommerce'

export type { AdsPlaybook, AdsPlaybookKey } from './types'
export { DEFAULT_ADS_PLAYBOOK }

/** 有行业剧本的全部行业（不含 default）。 */
export const INDUSTRY_ADS_PLAYBOOKS: readonly AdsPlaybook[] = [
  LOGISTICS_ADS_PLAYBOOK,
  TRAVEL_ADS_PLAYBOOK,
  REAL_ESTATE_ADS_PLAYBOOK,
  ECOMMERCE_ADS_PLAYBOOK,
]

const BY_KEY = new Map<string, AdsPlaybook>(INDUSTRY_ADS_PLAYBOOKS.map(p => [p.key, p]))

/**
 * 存量 `clients.industry` 可能是旧的自由文本（如 `Real Estate`），
 * 与 lib/memory 取数侧同样做大小写 / 空格归一，再精确匹配。
 */
function normaliseIndustry(industry: string): string {
  return industry.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function resolveAdsPlaybook(industry: string | null | undefined): AdsPlaybook {
  if (!industry) return DEFAULT_ADS_PLAYBOOK
  return BY_KEY.get(normaliseIndustry(industry)) ?? DEFAULT_ADS_PLAYBOOK
}
