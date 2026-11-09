import type { AdsPlaybook } from './types'

/** 旅游行业剧本（INDUSTRY_OPTIONS: `travel`）。 */
export const TRAVEL_ADS_PLAYBOOK: AdsPlaybook = {
  key: 'travel',
  resultNoun: '咨询',
  costPerResultLabel: '每个咨询',
  expectedGeoNoun: '客户服务市场',
  // 手册 §9.1 旅游 ⑧：素材对照每条至少 150 次点击才下结论（PM 2026-10-28，候选）
  creativeCompareMinLinkClicks: 150,
  creativeOfferNoun: '团和出发档期',
}
