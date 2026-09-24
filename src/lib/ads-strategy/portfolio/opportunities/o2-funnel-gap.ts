/**
 * O2 · 漏斗缺位（spec 2026-09-24 §3 G3）。只读，不出动作。
 *
 * 账户在花钱做破冰（awareness），但整个账户里一条再营销（retargeting）广告组都没有 ——
 * 看过视频的人没人接着追。
 *
 * 🔴 跟 D4 的分工：D4 管「有再营销组但没覆盖到攒下的受众」；O2 管「根本就没有再营销组」。
 * 两条不会同时命中同一个账户。
 */

import type { AccountContext } from '../diagnostics/context'
import { adsetRows, sumSpend, unitOf } from '../diagnostics/context'
import type { Diagnosis } from '../diagnostics/types'
import { D4_MIN_AWARENESS_SPEND } from '../diagnostics/thresholds'

export function findFunnelGap(ctx: AccountContext): Diagnosis | null {
  const awarenessIds = Array.from(ctx.adsets.keys())
    .filter(id => !ctx.experimentIds.has(id) && ctx.roles.get(id)?.role === 'awareness')
  const awarenessSpend = sumSpend(adsetRows(ctx, awarenessIds))
  if (awarenessSpend < D4_MIN_AWARENESS_SPEND) return null

  // 暂停的也算「有」：这条问的是「有没有建过」，不是「在不在投」
  const retargetingIds = Array.from(ctx.adsets.keys()).filter(id => ctx.roles.get(id)?.role === 'retargeting')
  if (retargetingIds.length > 0) return null

  const units = awarenessIds.map(id => unitOf(ctx, 'adset', id))
  const evidence = {
    window_start: ctx.window[0],
    window_end: ctx.date,
    awareness_spend: Math.round(awarenessSpend * 100) / 100,
    awareness_adsets: awarenessIds.length,
    retargeting_adsets: 0,
  }
  const sample = [{ label: '近 7 天有破冰花费的广告组', value: awarenessIds.length }]
  const base = { code: 'O2' as const, units, sample, clientVisible: false }

  if (awarenessIds.every(id => ctx.roles.get(id)?.confidence === 'low')) {
    return {
      ...base, status: 'not_comparable', notComparableReason: 'below_min_sample',
      title: '漏斗缺位判不了：破冰角色判定可信度低',
      evidence, reasons: ['破冰广告组的角色判定可信度全是「低」，说不清是不是真在破冰'],
    }
  }

  return {
    ...base, status: 'hit',
    title: '有破冰花费，但账户里没有再营销广告组——看过视频的人没人接着追',
    evidence,
    reasons: ['建议加一条再营销广告组（ads.add_retargeting_adset）——本阶段只发现，不出动作'],
  }
}
