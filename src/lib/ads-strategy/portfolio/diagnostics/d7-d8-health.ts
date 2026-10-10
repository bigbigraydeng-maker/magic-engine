/**
 * D7 · 授权/数据体检（只读）与 D8 · 结果真相断层。设计 §3.3。永不进客户版（§14 C6）。
 *
 * D7 发现问题**只下发人工任务三件套**，不自动改权限、不自动换令牌（§3.3「D7 只读」）。
 *   - 广告账户读不到（快照抓取记录里账户级失败）
 *   - 设置显示在投，但日数据停更 ≥2 天（授权断了、账户号指错、或真没花钱但状态还开着）
 *   - 日报收件人里有非内部邮箱（阶段 1 日报只许发内部）
 *   - 结果阶梯没配置（D3/D5 会一直判不了）
 * D8：领先结果有、主结果归不上（UNKNOWN）→ 提醒「数字好看不代表生意来了」。
 */

import type { AccountContext } from './context'
import { adsetRows, isDelivering, shiftDate, sumSpend } from './context'
import { countOutcome, OUTCOME_STEP_LABEL } from '../outcome-ladder'
import type { Diagnosis, DiagnosisInput } from './types'
import { D7_STALE_DATA_DAYS } from './thresholds'
import { isInternalEmail, splitAddresses } from './internal-email'

const accountUnit = (ctx: AccountContext) => ({ level: 'account' as const, id: ctx.account.adAccountId, name: ctx.accountRow?.entity_name ?? null, adAccountId: ctx.account.adAccountId })

export function diagnoseAccountHealth(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  const out: Diagnosis[] = []
  const unit = accountUnit(ctx)
  const settingsHref = `/dashboard/clients/${input.clientId}/settings`

  const accountCapture = ctx.account.latestCaptures.find(c => c.level === 'account')
  if (accountCapture && !accountCapture.complete && accountCapture.error) {
    out.push({
      code: 'D7', status: 'hit', clientVisible: false, units: [unit],
      title: '读不到这个广告账户：诊断和数据同步都拿不到它的设置',
      evidence: { captured_at: accountCapture.captured_at, error: accountCapture.error },
      sample: [], reasons: ['快照抓取账户级失败（只读诊断不自动改权限）'],
      manualTask: {
        what: `广告账户 ${ctx.account.adAccountId} 读不到（${accountCapture.error}），这个账户的广告诊断全部停摆。`,
        how: '先确认这是不是客户现在真正在投的账户；是的话，请客户在自己的 Meta 业务后台把该广告账户的查看权限分给 Magic Engine 业务组合；不是的话，在客户设置页把广告账户改回正确的号。',
        href: settingsHref,
      },
    })
  }

  // 「没数据」不能显示成「健康」（2026-09-14 魏征复审）：
  //   - 非共用账户却没有任何实体级设置快照 → 实体级诊断全部跑不了
  //   - 窗口里有系列级日数据、却没有任何广告组级日数据 → D3/D4/D5/D8 都拿不到判定单位的花费
  const hasEntitySnapshots = ctx.campaigns.size + ctx.adsets.size > 0
  const windowSet = new Set(ctx.window)
  const campaignRowsInWindow = ctx.account.daily.some(r => r.level === 'campaign' && windowSet.has(r.insight_date) && r.spend > 0)
  const adsetRowsInWindow = ctx.account.daily.some(r => r.level === 'adset' && windowSet.has(r.insight_date))
  // 没有实体快照但窗口里也没有任何花费（空账户）→ 不报，否则天天噪音（第二轮核验）
  const anySpendInWindow = campaignRowsInWindow || ctx.account.daily.some(r => windowSet.has(r.insight_date) && r.spend > 0)
  if (!ctx.account.shared && ((!hasEntitySnapshots && anySpendInWindow) || (campaignRowsInWindow && !adsetRowsInWindow))) {
    const why = !hasEntitySnapshots ? '没有这个账户的广告设置快照' : '有系列级花费，但广告组级日数据还没进来'
    out.push({
      code: 'D7', status: 'hit', clientVisible: false, units: [unit],
      title: `诊断缺数据：${why}，除「投放卡住」外的诊断这几天都跑不了`,
      evidence: { entity_snapshots: hasEntitySnapshots, campaign_spend_rows: campaignRowsInWindow, adset_rows: adsetRowsInWindow },
      sample: [], reasons: ['没数据不等于没问题'],
      manualTask: {
        what: `广告账户 ${ctx.account.adAccountId}：${why}。`,
        how: '先看每 3 小时的「广告设置快照」和每天的广告数据同步任务有没有报错（运行记录里按账户号搜）；是授权问题就按「读不到这个广告账户」处理。',
        href: settingsHref,
      },
    })
  }

  const deliveringUnits = ctx.allBudgetUnits.filter(u => isDelivering(u.level === 'campaign' ? ctx.campaigns.get(u.id) : ctx.adsets.get(u.id)))
  const last = ctx.account.lastInsightDate
  const staleSince = shiftDate(ctx.date, -D7_STALE_DATA_DAYS)
  if (deliveringUnits.length > 0 && (last === null || last < staleSince)) {
    out.push({
      code: 'D7', status: 'hit', clientVisible: false, units: [unit],
      title: `设置显示在投，但日数据${last ? `从 ${last} 起停更` : '一条都没有'}`,
      evidence: { last_insight_date: last, delivering_units: deliveringUnits.length, evaluated_day: ctx.date },
      sample: [{ label: '设置显示在投的预算单位', value: deliveringUnits.length }],
      reasons: ['要么授权/账户号出了问题导致拉不到数，要么广告其实没在花钱但状态还开着'],
      manualTask: {
        what: `广告账户 ${ctx.account.adAccountId} 有 ${deliveringUnits.length} 个单位显示在投，但数据${last ? `停在 ${last}` : '一直没有'}。`,
        how: '打开 Ads Manager 看这些广告系列有没有花费、付款方式有没有报错；有花费但系统没数据就是授权或账户号问题，没花费就确认是不是客户有意停投。',
        href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${ctx.account.adAccountId.replace(/^act_/, '')}`,
      },
    })
  }
  return out
}

export function diagnoseClientConfigHealth(input: DiagnosisInput): Diagnosis[] {
  const out: Diagnosis[] = []
  const unit = { level: 'account' as const, id: input.clientId, name: null, adAccountId: '' }
  const href = `/dashboard/clients/${input.clientId}/settings`
  const external = splitAddresses(input.digestRecipients).filter(e => {
    return !isInternalEmail(e)
  })
  if (external.length > 0) {
    out.push({
      code: 'D7', status: 'hit', clientVisible: false, units: [unit],
      title: `日报收件人里有 ${external.length} 个非内部邮箱，内部版日报不会发给他们`,
      evidence: { external_recipients: external.length },
      sample: [{ label: '非内部收件人', value: external.length }],
      reasons: ['阶段 1 只发内部；客户版另行设计（Gmail 通道，默认关闭）'],
      manualTask: { what: '广告日报收件人里混了非内部邮箱。', how: '在客户设置页「广告健康监测」里把收件人改成内部同事邮箱。', href },
    })
  }
  if (!input.outcomeConfigured || input.outcome.primary === null) {
    out.push({
      code: 'D7', status: 'hit', clientVisible: false, units: [unit],
      title: '还没设置「广告结果怎么算」：花钱没结果、钱和结果错配两条会一直判不了',
      evidence: { outcome_configured: input.outcomeConfigured, primary: input.outcome.primary, target_cost: input.outcome.targetCostPerPrimary },
      sample: [], reasons: ['不拿行业默认值代替客户目标'],
      manualTask: { what: '这个客户的领先结果 / 主结果 / 目标单次成本没设置。', how: '在客户设置页「广告结果怎么算」里选好两级结果、填目标单次成本。', href },
    })
  }
  return out
}

export function diagnoseOutcomeTruthGap(ctx: AccountContext, input: DiagnosisInput): Diagnosis | null {
  const { leading, primary } = input.outcome
  if (!input.outcomeConfigured || !leading || !primary || leading === primary) return null
  const adsets = Array.from(ctx.adsets.values()).filter(s => !ctx.experimentIds.has(s.entity_id) && ctx.roles.get(s.entity_id)?.role !== 'awareness')
  const rows = adsetRows(ctx, adsets.map(s => s.entity_id)).filter(r => r.spend > 0)
  if (rows.length === 0) return null
  const lead = rows.map(r => countOutcome(leading, r, { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal: ctx.adsets.get(r.entity_id)?.optimization_goal ?? null }))
  const prim = rows.map(r => countOutcome(primary, r, { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal: ctx.adsets.get(r.entity_id)?.optimization_goal ?? null }))
  const leadingTotal = lead.reduce((a, c) => a + (c.value ?? 0), 0)
  const unknownDays = prim.filter(c => c.value === null).length
  if (leadingTotal === 0 || unknownDays === 0) return null
  return {
    code: 'D8', status: 'hit', clientVisible: false,
    units: [accountUnit(ctx)],
    title: `结果真相断层：近 7 天${OUTCOME_STEP_LABEL[leading]} ${leadingTotal} 个，但${OUTCOME_STEP_LABEL[primary]}归不到广告，真生意来没来看不出`,
    evidence: { window_start: ctx.window[0], window_end: ctx.date, leading: leadingTotal, primary_unknown_rows: unknownDays, spend: sumSpend(rows) },
    sample: [{ label: OUTCOME_STEP_LABEL[leading], value: leadingTotal }, { label: '看不出带来多少真实生意的「广告组×天」', value: unknownDays }],
    reasons: [prim.find(c => c.note)?.note ?? '主结果 UNKNOWN'],
  }
}
