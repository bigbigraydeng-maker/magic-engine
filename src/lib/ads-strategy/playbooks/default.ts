import type { AdsPlaybook } from './types'

/**
 * 兜底剧本：客户没填行业、行业不在词表、或行业读不到时用。
 * 必须是中性词 —— 不许出现任何一个行业的叫法（有测试锁住）。
 */
export const DEFAULT_ADS_PLAYBOOK: AdsPlaybook = {
  key: 'default',
  resultNoun: '结果',
  costPerResultLabel: '每个结果',
  expectedGeoNoun: '客户业务',
}
