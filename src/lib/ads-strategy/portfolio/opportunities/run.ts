/**
 * 机会发现编排（spec 2026-09-24 §3 G3）。纯函数，全部只读，不出动作。
 *
 * 跟 `diagnostics/run.ts` 的分工：那边找「哪里不对」，这边找「哪里还有空间」，
 * 输出同一个 `Diagnosis` 形状，进同一条日报 / 看板管道。
 *
 * 🔴 数据不全的日子（completeness='partial'）整段跳过：机会判断都靠比例和趋势，
 * 分子被系统性拉低时最容易凭空报出「潜在爆款」。诊断那边照跑（D7 负责报数据坏了）。
 *
 * O4（剧本缺口）本阶段不实现——行业剧本目前只有词表、没有「该有哪些打法」的声明，
 * 硬加等于凭空编行业判断（见 Issue #1958 的 DEFER 记录）。
 */

import { buildAccountContext } from '../diagnostics/context'
import { scopeAccountToClient } from '../diagnostics/ownership'
import { findHotCreatives } from './o1-hot-creative'
import { findFunnelGap } from './o2-funnel-gap'
import { findBudgetMismatch } from './o3-budget-mismatch'
import type { Diagnosis, DiagnosisInput } from '../diagnostics/types'

export type DataCompleteness = 'complete' | 'partial'

export interface OpportunityRun {
  clientId: string
  date: string
  opportunities: Diagnosis[]
  /** 非 null = 这一轮整段没跑，值是人话原因（写进 ads_growth_states.payload 给日报用）。 */
  skippedReason: string | null
}

export function runOpportunities(input: DiagnosisInput, completeness: DataCompleteness): OpportunityRun {
  if (completeness === 'partial') {
    return {
      clientId: input.clientId,
      date: input.date,
      opportunities: [],
      skippedReason: '当天日数据或设置快照没拉全，机会发现整段跳过（诊断照常跑）',
    }
  }

  const opportunities: Diagnosis[] = []

  for (const raw of input.accounts) {
    // 跟诊断同一道切分：别的主页的系列/广告组不算这个客户的机会（被排除的实体由诊断那边的 excluded 列出）
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date, input.evaluatedAt)
    const account = scoped.account
    const ctx = buildAccountContext(account, input.date)

    if (scoped.accountLevelOnly) {
      opportunities.push({
        code: 'O1',
        status: 'not_comparable',
        notComparableReason: 'client_page_unknown',
        title: '客户没登记 Facebook 主页、账户里又有多个主页的广告，不做机会发现',
        units: [],
        evidence: { ad_account_id: account.adAccountId },
        sample: [],
        reasons: ['分不清哪些广告组是这个客户的，机会判断会把别人的实体算进来'],
        clientVisible: false,
      })
      continue
    }

    if (account.shared) {
      // §14 M9：同一账户登记给多个客户，机会判断会把别人的实体算进来，整段不做
      opportunities.push({
        code: 'O1',
        status: 'not_comparable',
        notComparableReason: 'shared_account',
        title: '共用账户不做机会发现',
        units: [],
        evidence: { ad_account_id: account.adAccountId },
        sample: [],
        reasons: ['这个广告账户同时登记给了别的客户，机会判断会把别人的实体算进来'],
        clientVisible: false,
      })
      continue
    }

    opportunities.push(...findHotCreatives(ctx))
    const o2 = findFunnelGap(ctx)
    if (o2) opportunities.push(o2)
    opportunities.push(...findBudgetMismatch(ctx, input))
  }

  const rank = (d: Diagnosis) => (d.status === 'hit' ? 0 : 1)
  opportunities.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
  return { clientId: input.clientId, date: input.date, opportunities, skippedReason: null }
}
