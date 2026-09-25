/**
 * Capability · `ads.auto_pause_on_d3` —— 依赖包。
 *
 * 拆出来是为了测试能注入假的 Meta 调用，不碰真 token / 真 Graph API
 * （跟 `page-apply-optimization/deps.ts` 同一个理由）。
 */

import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getAdSetStatus, setAdSetStatus } from '@/lib/meta/adsets'
import type { AdSetSummary } from '@/lib/meta/adsets'

export interface AdsAutoPauseDeps {
  /** 这个客户现在能用的 Meta token；没有配置返回 null。 */
  resolveToken: (clientId: string) => Promise<string | null>
  getAdSetStatus: (adSetId: string, token: string) => Promise<AdSetSummary | null>
  setAdSetStatus: (adSetId: string, token: string, status: 'ACTIVE' | 'PAUSED') => Promise<boolean>
}

export function defaultDeps(): AdsAutoPauseDeps {
  return {
    resolveToken: getMetaTokenForClient,
    getAdSetStatus,
    setAdSetStatus,
  }
}
