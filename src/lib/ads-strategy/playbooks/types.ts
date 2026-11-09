/**
 * 广告剧本（Ads Industry Playbook）—— 行业差异只以**数据**进入广告共享代码。
 *
 * 为什么有这层：`src/lib/ads-strategy/` 是所有客户共用的判定与文案代码，
 * 以前把「询盘」「房源」直接写在里面 —— 旅游客户的日报也说「每个询盘」，
 * 电商客户的回读闸门也说「房源在哪」。这违反平台化红线：行业差异进
 * Playbook / Profile，不进 shared runtime（ME2 平台化原则 · 广告 IMPACT 设计 G11）。
 *
 * 剧本只放**参数和封闭词表**，不放表达式 / 函数 / 判断规则。
 * 按 `clients.industry` 选剧本，**不许按客户名 / 客户 ID 判断**。
 */

/**
 * 剧本 key。除 `default` 外，与 `src/lib/clients/industries.ts` 的
 * `INDUSTRY_OPTIONS` 规范值同一套写法（`logistics` 目前不在该词表内，见 logistics.ts）。
 */
export type AdsPlaybookKey = 'default' | 'logistics' | 'travel' | 'real_estate' | 'retail'

export interface AdsPlaybook {
  readonly key: AdsPlaybookKey
  /** 广告的「结果」在这个行业叫什么（内部日报 / 体检文案用），如 默认「结果」、旅游「咨询」。 */
  readonly resultNoun: string
  /** 单个结果成本的叫法，拼成「每个咨询 $12.6」「每个咨询成本」。 */
  readonly costPerResultLabel: string
  /** 投放地区对照时客户那一侧叫什么，拼成「房源在「Auckland」」。 */
  readonly expectedGeoNoun: string
  /**
   * 同组素材并排比较的样本门槛：每条素材的链接点击数（手册 E-02③：门槛按点击数、由行业层给）。
   * null = 这个行业还没定门槛，页面写「门槛未定」，不编数字。
   */
  readonly creativeCompareMinLinkClicks: number | null
  /** 素材只在「同一个 X」里比时 X 叫什么，如旅游「团和出发档期」。null = 这个行业不需要这条提醒。 */
  readonly creativeOfferNoun: string | null
}
