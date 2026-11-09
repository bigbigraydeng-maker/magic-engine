/**
 * D4 · 攒了人没收割（破冰），设计 §3.3 + §14 M8。只读。按账户看。
 *
 * 近 7 天破冰广告组花费 > X、有花费的天数 ≥ 3，且：
 *   - 没有任何视频受众的规则 object_id 覆盖这些破冰广告的视频（按 creative.video_id 匹配，**不按名字**）；或
 *   - 有覆盖的受众，但近 7 天没有「再营销」角色的广告组包含它（M8：只有再营销角色算已收割；
 *     Advantage+/名单外扩展开着的是 mixed，不算）
 * not_comparable：覆盖的受众人数下限 ≤1000；受众建成 <72 小时；再营销组用的是主页互动类受众，无法确认含视频观众。
 * 实验中的破冰组不计入花费（§14 M7）；实验中的再营销组仍算「在收割」（它确实在投这批人）。
 */

import type { AccountContext } from './context'
import { adsetRows, isDelivering, localDayEndUtc, money, sumSpend, unitOf } from './context'
import type { Diagnosis } from './types'
import { D4_AUDIENCE_FLOOR, D4_AUDIENCE_MIN_AGE_HOURS, D4_MIN_AWARENESS_DAYS, D4_MIN_AWARENESS_SPEND } from './thresholds'

const VIDEO_EVENTS = /video/i

export function diagnoseUnharvestedAudience(ctx: AccountContext): Diagnosis | null {
  const awareness = Array.from(ctx.adsets.values())
    .filter(s => !ctx.experimentIds.has(s.entity_id) && ctx.roles.get(s.entity_id)?.role === 'awareness')
  const rows = adsetRows(ctx, awareness.map(s => s.entity_id))
  const spend = sumSpend(rows)
  const activeDays = new Set(rows.filter(r => r.spend > 0).map(r => r.insight_date)).size
  if (spend <= D4_MIN_AWARENESS_SPEND || activeDays < D4_MIN_AWARENESS_DAYS) return null

  const awarenessIds = new Set(awareness.map(s => s.entity_id))
  const videos = new Set(ctx.ads.filter(a => a.adset_id && awarenessIds.has(a.adset_id)).flatMap(a => a.creative_video_ids))
  const units = awareness.filter(s => rows.some(r => r.entity_id === s.entity_id && r.spend > 0)).map(s => unitOf(ctx, 'adset', s.entity_id))
  const endOfDay = localDayEndUtc(ctx.date, ctx.account.timezone)

  const covering = Array.from(ctx.audiences.values()).filter(a =>
    a.audience_rule_object_ids.some(id => videos.has(id)) &&
    (a.audience_created_at === null || Date.parse(a.audience_created_at) <= endOfDay))

  const baseEvidence = { window_start: ctx.window[0], window_end: ctx.date, awareness_spend: spend, awareness_active_days: activeDays, video_count: videos.size, covering_audiences: covering.length }
  const sample = [{ label: '破冰有花费的天数', value: activeDays }, { label: '破冰视频数', value: videos.size }]
  const base = { code: 'D4' as const, units, sample, clientVisible: false }

  // 在投（或近 7 天有花费）的再营销组
  const retargetingIncludes = new Set<string>()
  const pageAudienceRetarget: string[] = []
  for (const s of Array.from(ctx.adsets.values())) {
    const v = ctx.roles.get(s.entity_id)
    if (v?.role !== 'retargeting') continue
    const recent = adsetRows(ctx, [s.entity_id]).some(r => r.spend > 0) || isDelivering(s)
    if (!recent) continue
    for (const id of v.retargetingAudienceIds) {
      retargetingIncludes.add(id)
      const aud = ctx.audiences.get(id)
      if (aud && aud.audience_rule_object_ids.length > 0 && !aud.audience_rule_events.some(e => VIDEO_EVENTS.test(e)) && aud.audience_subtype === 'ENGAGEMENT') pageAudienceRetarget.push(id)
    }
  }

  // 没取到任何破冰视频（广告级快照缺失、或破冰用的是图片/复用帖）→ 按 object_id 判不了，不能报「没受众」（子牙/魏征复审）
  if (videos.size === 0) {
    return { ...base, status: 'not_comparable', notComparableReason: 'no_video_creatives', title: '攒了人没收割判不了：找不到破冰广告用的视频', evidence: baseEvidence, reasons: ['广告级设置里没有视频 id（快照缺失或不是视频广告）'] }
  }

  if (covering.length === 0) {
    if (pageAudienceRetarget.length > 0) {
      return { ...base, status: 'not_comparable', notComparableReason: 'page_audience_unverifiable', title: '攒了人没收割判不了：再营销用的是主页互动类受众，确认不了是否含视频观众', evidence: { ...baseEvidence, page_audiences: pageAudienceRetarget.join(',') }, reasons: ['按 object_id 匹配不到视频受众'] }
    }
    return {
      ...base, status: 'hit',
      title: `攒了人没收割：近 7 天破冰广告花了 ${money(ctx, spend)}（${activeDays} 天），但没有建「看过这些视频的人」这个受众，看过的人没被找回来`,
      evidence: baseEvidence,
      reasons: ['没有建「看过这些视频的人」这个受众（按视频编号核对，不按名字猜）'],
    }
  }

  const harvested = covering.filter(a => retargetingIncludes.has(a.entity_id))
  if (harvested.length > 0) return null

  const isYoung = (a: (typeof covering)[number]) => !!a.audience_created_at && (endOfDay - Date.parse(a.audience_created_at)) / 3_600_000 < D4_AUDIENCE_MIN_AGE_HOURS
  const isSmall = (a: (typeof covering)[number]) => (a.audience_count_lower ?? 0) <= D4_AUDIENCE_FLOOR
  // 只有「够老又够大」的覆盖受众没被收割才算命中；一个太新、一个太小也是判不了（魏征复审）
  const usable = covering.filter(a => !isYoung(a) && !isSmall(a))
  if (usable.length === 0) {
    const young = covering.filter(isYoung)
    if (young.length > 0) {
      return { ...base, status: 'not_comparable', notComparableReason: 'audience_too_new', title: '攒了人没收割判不了：看过视频的受众刚建不到 72 小时', evidence: { ...baseEvidence, newest_audience_created_at: young.map(a => a.audience_created_at).sort().at(-1) ?? null }, reasons: [`受众建成不满 ${D4_AUDIENCE_MIN_AGE_HOURS} 小时`] }
    }
    return { ...base, status: 'not_comparable', notComparableReason: 'audience_below_floor', title: '攒了人没收割判不了：受众人数还在 Meta 显示下限（≤1000）', evidence: baseEvidence, reasons: ['人数下限 ≤1000，攒没攒够说不清'] }
  }
  return {
    ...base, status: 'hit',
    title: `攒了人没收割：看过这些视频的人已经攒成受众（${usable.length} 个），但近 7 天没有再营销广告在找回他们`,
    evidence: { ...baseEvidence, unharvested_audiences: usable.map(a => a.entity_id).join(',') },
    reasons: ['受众已存在，但只有「再营销」角色的组才算收割（Advantage+/扩展开着的不算）'],
  }
}
