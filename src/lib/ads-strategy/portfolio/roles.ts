/**
 * 漏斗角色判定（ads IMPACT 阶段 1，设计 §3.1）。
 *
 * 按**设置快照**判（不按名字判），每个结论带可信度与理由，给诊断用：
 *   破冰 awareness   —— 优化目标是 ThruPlay/触达/曝光/视频观看/互动，且**包含**列表没有自定义受众
 *   获客 acquisition —— 优化目标是留资/私信/网站转化，面向冷流量（**只有排除受众也算冷流量**）
 *   再营销 retargeting —— 包含互动/网站/客户名单类受众，且 advantage_audience=0 且名单外扩展=0
 *   扩量 expansion   —— 包含类似人群
 *   mixed            —— Advantage+ 购物（ASC）系列；系列目标与优化目标错位；再营销但扩展开着；
 *                       同时命中两行（再营销+类似人群）；包含了查不到子类型的受众
 *   unknown          —— 以上都不符
 *
 * 唯一的双命中例外（§3.1）：破冰+再营销（如 ThruPlay 投视频观众名单）→ 以包含受众优先判再营销，可信度「中」。
 * 特殊广告类别读**广告系列自己的** special_ad_categories；系列快照缺失时是 null（未知），不是 []（确认没有）。
 *
 * ⚠️ mixed 只表示「角色说不清」，不等于设置错误——Meta 允许的组合（如 LEADS 系列配 LINK_CLICKS）也会落进来。
 *
 * 纯函数、平台共享：不许出现客户名、客户 ID、行业判断。
 */

import type { EntitySnapshotRow } from './snapshot'

export type FunnelRole = 'awareness' | 'acquisition' | 'retargeting' | 'expansion' | 'mixed' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low'

export interface RoleVerdict {
  role: FunnelRole
  confidence: Confidence
  reasons: string[]
  /** 读自广告系列自己的 special_ad_categories；系列快照缺失 = null（未知） */
  specialAdCategories: string[] | null
  /** 包含受众里确认是「再营销类」的受众 id（D4 判「已收割」用）。查不到子类型的不算。 */
  retargetingAudienceIds: string[]
}

const AWARENESS_GOALS = new Set(['THRUPLAY', 'REACH', 'IMPRESSIONS', 'VIDEO_VIEWS', 'POST_ENGAGEMENT', 'ENGAGED_USERS', 'AD_RECALL_LIFT', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'])
const ACQUISITION_GOALS = new Set(['LEAD_GENERATION', 'QUALITY_LEAD', 'CONVERSATIONS', 'OFFSITE_CONVERSIONS', 'VALUE', 'QUALITY_CALL', 'APP_INSTALLS'])
const TRAFFIC_GOALS = new Set(['LINK_CLICKS', 'LANDING_PAGE_VIEWS'])

/** 系列目标 → 允许的优化目标组。不在表里的目标不判错位（未知 ≠ 错位）。 */
const OBJECTIVE_ALLOWS: Readonly<Record<string, ReadonlyArray<'awareness' | 'acquisition' | 'traffic'>>> = {
  OUTCOME_AWARENESS: ['awareness'],
  OUTCOME_ENGAGEMENT: ['awareness', 'acquisition'],
  OUTCOME_LEADS: ['acquisition'],
  OUTCOME_SALES: ['acquisition'],
  OUTCOME_TRAFFIC: ['traffic'],
  OUTCOME_APP_PROMOTION: ['acquisition'],
}

/** Meta 受众子类型 → 包含时的含义 */
const RETARGETING_SUBTYPES = new Set(['ENGAGEMENT', 'WEBSITE', 'CUSTOM', 'OFFLINE_CONVERSION', 'APP', 'VIDEO'])
const LOOKALIKE_SUBTYPES = new Set(['LOOKALIKE'])

/** 名字里带「再营销」一类通用词但设置判成冷流量 → 名字与设置矛盾，可信度下调。 */
const RETARGETING_NAME_HINT = /retarget|remarket|再营销|收割|warm/i

function goalGroup(goal: string | null): 'awareness' | 'acquisition' | 'traffic' | null {
  if (!goal) return null
  if (AWARENESS_GOALS.has(goal)) return 'awareness'
  if (ACQUISITION_GOALS.has(goal)) return 'acquisition'
  if (TRAFFIC_GOALS.has(goal)) return 'traffic'
  return null
}

export interface RoleInput {
  adset: EntitySnapshotRow
  campaign: EntitySnapshotRow | null
  /** 本账户受众快照，按 id 查子类型 */
  audiences: ReadonlyMap<string, EntitySnapshotRow>
}

export function classifyAdsetRole({ adset, campaign, audiences }: RoleInput): RoleVerdict {
  const reasons: string[] = []
  const base = { specialAdCategories: campaign ? campaign.special_ad_categories : null }
  const verdict = (role: FunnelRole, confidence: Confidence, why: string[], retargetingAudienceIds: string[] = []): RoleVerdict =>
    ({ ...base, role, confidence, reasons: [...reasons, ...why], retargetingAudienceIds })

  const retargetingIds: string[] = []
  const lookalikeIds: string[] = []
  const unknownIds: string[] = []
  for (const id of adset.included_audience_ids) {
    const subtype = audiences.get(id)?.audience_subtype ?? null
    if (subtype && LOOKALIKE_SUBTYPES.has(subtype)) lookalikeIds.push(id)
    else if (subtype && RETARGETING_SUBTYPES.has(subtype)) retargetingIds.push(id)
    else unknownIds.push(id)
  }

  if (campaign?.smart_promotion_type === 'AUTOMATED_SHOPPING_ADS') {
    return verdict('mixed', 'low', ['Advantage+ 购物系列：受众由 Meta 自动决定'])
  }

  const group = goalGroup(adset.optimization_goal)
  const allowed = campaign?.objective ? OBJECTIVE_ALLOWS[campaign.objective] : undefined
  if (allowed && group && !allowed.includes(group)) {
    return verdict('mixed', 'low', [`系列目标 ${campaign?.objective} 与优化目标 ${adset.optimization_goal} 错位`], retargetingIds)
  }

  // 查不到子类型的受众可能是共享来的类似人群或第三方受众：说不清冷热，不当再营销（子牙复审）
  if (unknownIds.length > 0) {
    return verdict('mixed', 'low', [`${unknownIds.length} 个包含受众在本账户快照里查不到子类型，冷热说不清`], retargetingIds)
  }

  // 同时命中再营销 + 扩量 → mixed（§3.1「同时命中两行」，只有破冰+再营销例外）
  if (retargetingIds.length > 0 && lookalikeIds.length > 0) {
    return verdict('mixed', 'low', ['同时包含再营销类受众和类似人群'], retargetingIds)
  }

  if (retargetingIds.length > 0) {
    const advantage = adset.advantage_audience
    const relaxation = adset.targeting_relaxation?.custom_audience
    const problems: string[] = []
    if (advantage !== 0) problems.push(`Advantage+ 受众=${advantage ?? '读不到'}`)
    if (relaxation !== 0) problems.push(`名单外扩展=${relaxation ?? '读不到'}`)
    if (problems.length > 0) {
      return verdict('mixed', 'low', [`包含再营销类受众，但${problems.join('、')}——实际在投冷流量（读不到的不当作已关闭）`], retargetingIds)
    }
    const alsoAwareness = group === 'awareness'
    return verdict(
      'retargeting',
      alsoAwareness ? 'medium' : 'high',
      ['包含再营销类受众，Advantage+ 受众与名单外扩展均已关闭', ...(alsoAwareness ? ['优化目标属破冰类，以包含受众优先判再营销'] : [])],
      retargetingIds,
    )
  }

  if (lookalikeIds.length > 0) {
    return verdict('expansion', 'high', ['包含类似人群'])
  }

  const nameConflict = RETARGETING_NAME_HINT.test(adset.entity_name ?? '')
  const coldNote = adset.excluded_audience_ids.length > 0 ? '只有排除受众，按冷流量处理' : '没有包含受众'
  const conflictNote = nameConflict ? ['名字像再营销，但设置是冷流量'] : []
  if (group === 'awareness') {
    return verdict('awareness', nameConflict ? 'medium' : 'high', [`优化目标 ${adset.optimization_goal}，${coldNote}`, ...conflictNote])
  }
  if (group === 'acquisition') {
    return verdict('acquisition', nameConflict ? 'medium' : 'high', [`优化目标 ${adset.optimization_goal}，${coldNote}`, ...conflictNote])
  }
  return verdict('unknown', 'low', [`优化目标 ${adset.optimization_goal ?? '缺失'} 不在任何角色判据里`])
}

/**
 * CBO 系列作为独立预算单位时的角色：组内角色一致 → 该角色（可信度取最低）；不一致 → mixed。
 */
export function rollupCampaignRole(verdicts: RoleVerdict[]): { role: FunnelRole; confidence: Confidence } {
  if (verdicts.length === 0) return { role: 'unknown', confidence: 'low' }
  const roles = new Set(verdicts.map(v => v.role))
  if (roles.size > 1) return { role: 'mixed', confidence: 'low' }
  const order: Confidence[] = ['low', 'medium', 'high']
  const minConf = verdicts.map(v => order.indexOf(v.confidence)).reduce((a, b) => Math.min(a, b), 2)
  return { role: verdicts[0].role, confidence: order[minConf] }
}
