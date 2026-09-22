import type { AdsPlaybook } from './types'

/**
 * 物流行业剧本。
 *
 * 注意：`logistics` 目前不在 `INDUSTRY_OPTIONS` 受控词表里，设置页选不到，
 * 所以只有 `clients.industry` 恰好是这个值时才会命中；否则走 default。
 */
export const LOGISTICS_ADS_PLAYBOOK: AdsPlaybook = {
  key: 'logistics',
  resultNoun: '真实询价',
  costPerResultLabel: '每个询价',
  expectedGeoNoun: '服务地区',
}
