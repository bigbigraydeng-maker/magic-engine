/**
 * 广告只读诊断 · 编排（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。纯函数。
 *
 * 顺序：按账户建上下文（角色、实验排除）→ 共用账户只做账户级/配置级（D1、D7、D9）→ 其余账户再跑 D3/D4/D5/D8
 * → 客户级体检（日报收件人、结果阶梯配置）。
 * 健康的一天输出为空：not_comparable 只在「本可能命中但判不了」时才出。
 *
 * D2（按角色的疲劳模型）、D6（行业先验）本阶段不实现。
 */

import { buildAccountContext } from './context'
import { diagnoseDeliveryStall } from './d1-delivery-stall'
import { diagnoseSpendNoResult } from './d3-spend-no-result'
import { diagnoseUnharvestedAudience } from './d4-unharvested-audience'
import { diagnoseBudgetResultMismatch } from './d5-budget-result-mismatch'
import { diagnoseAccountHealth, diagnoseClientConfigHealth, diagnoseOutcomeTruthGap } from './d7-d8-health'
import { diagnosePlacementLeak } from './d9-placement-leak'
import type { Diagnosis, DiagnosisInput, DiagnosisRun, ExcludedEntity } from './types'

export function runDiagnostics(input: DiagnosisInput): DiagnosisRun {
  const diagnoses: Diagnosis[] = []
  const excluded: ExcludedEntity[] = []

  for (const account of input.accounts) {
    const ctx = buildAccountContext(account, input.date)
    excluded.push(...ctx.excluded)

    const d1 = diagnoseDeliveryStall(ctx, input.evaluatedAt)
    if (d1) diagnoses.push(d1)
    diagnoses.push(...diagnoseAccountHealth(ctx, input))
    // D9 是配置检查（这个广告组自己设置对不对），不涉及"这条结果算谁的"的归因问题，理论上可以对共用账户也跑。
    // 🔴 但实际上对共用账户没用：`snapshot-sync.ts` 对 `shared=true` 的账户整个跳过 campaign/adset/ad/audience
    // 四层抓取（§14 M9），`ctx.adsets` 永远是空的——挪到这里只是让意图正确，不代表真的覆盖了共用账户
    // （2026-09-22 代码复审发现，本条注释此前的说法是错的）。CTS 共用的个人账户 `act_2775766642787274`
    // 里那条被污染的 `ThruPlay - NZ - Reels`（现在是 PAUSED，暂不算活跃风险）目前还照不到，
    // 要覆盖它需要先解决"共用账户的广告组设置抓不抓、抓了归给哪个客户"这个更大的架构问题，不在这次改动范围内。
    diagnoses.push(...diagnosePlacementLeak(ctx))

    if (account.shared) {
      // §14 M9：同一账户登记给多个客户，未落广告系列级归属表前只到账户级
      excluded.push({
        adAccountId: account.adAccountId, level: 'account', id: account.adAccountId, name: ctx.accountRow?.entity_name ?? null,
        reason: 'shared_account', detail: '这个广告账户同时登记给了别的客户，只做账户级诊断（投放卡住、授权/数据体检）',
      })
      continue
    }

    diagnoses.push(...diagnoseSpendNoResult(ctx, input))
    const d4 = diagnoseUnharvestedAudience(ctx)
    if (d4) diagnoses.push(d4)
    diagnoses.push(...diagnoseBudgetResultMismatch(ctx, input))
    const d8 = diagnoseOutcomeTruthGap(ctx, input)
    if (d8) diagnoses.push(d8)
  }

  // 多账户客户：「没配目标单次成本」是客户级的一件事，合并成一条（子牙复审）
  const targetMissing = diagnoses.filter(d => d.code === 'D3' && d.notComparableReason === 'target_cost_not_configured')
  if (targetMissing.length > 1) {
    const [first, ...rest] = targetMissing
    first.units = targetMissing.flatMap(d => d.units)
    first.sample = [{ label: '近 7 天有花费的获客/再营销广告组', value: first.units.length }]
    for (const d of rest) diagnoses.splice(diagnoses.indexOf(d), 1)
  }

  diagnoses.push(...diagnoseClientConfigHealth(input))
  const rank = (d: Diagnosis) => (d.status === 'hit' ? 0 : 1)
  diagnoses.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
  return { clientId: input.clientId, date: input.date, evaluatedAt: input.evaluatedAt, diagnoses, excluded }
}
