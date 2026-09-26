/**
 * 广告只读诊断 · 编排（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。纯函数。
 *
 * 顺序：按账户建上下文（角色、实验排除）→ 共用账户只做账户级/配置级（D1、D7、D9）→ 其余账户再跑 D3/D4/D5/D8
 * 与广告级 D2/D10 → 客户级体检（日报收件人、结果阶梯配置）。
 * 健康的一天输出为空：not_comparable 只在「本可能命中但判不了」时才出。
 *
 * D6（行业先验）本阶段不实现。
 */

import { buildAccountContext } from './context'
import { diagnoseDeliveryStall } from './d1-delivery-stall'
import { diagnoseSpendNoResult } from './d3-spend-no-result'
import { diagnoseUnharvestedAudience } from './d4-unharvested-audience'
import { diagnoseBudgetResultMismatch } from './d5-budget-result-mismatch'
import { diagnoseAccountHealth, diagnoseClientConfigHealth, diagnoseOutcomeTruthGap } from './d7-d8-health'
import { diagnosePlacementLeak } from './d9-placement-leak'
import { adLevelCoverage, diagnoseAdLevelRules } from './d2-d10-ad-rules'
import { diagnoseAudiencePoolStarved } from './d11-audience-pool-starved'
import type { AdLevelCoverage, Diagnosis, DiagnosisInput, DiagnosisRun, ExcludedEntity } from './types'

export function runDiagnostics(input: DiagnosisInput): DiagnosisRun {
  const diagnoses: Diagnosis[] = []
  const excluded: ExcludedEntity[] = []
  const coverage: AdLevelCoverage[] = []

  for (const account of input.accounts) {
    const ctx = buildAccountContext(account, input.date)
    excluded.push(...ctx.excluded)

    const d1 = diagnoseDeliveryStall(ctx, input.evaluatedAt)
    if (d1) diagnoses.push(d1)
    diagnoses.push(...diagnoseAccountHealth(ctx, input))
    // D9 是配置检查（这个广告组自己设置对不对），不涉及"这条结果算谁的"的归因问题，理论上可以对共用账户也跑。
    // 🔴 但实际上对登记为共用（shared=true）的账户没用：`snapshot-sync.ts` 对它们整个跳过 campaign/adset/ad/audience
    // 四层抓取（§14 M9），`ctx.adsets` 永远是空的。
    // 🔴 反过来也要当心：「登记表只登记给一个客户」不等于「账户里只有这个客户的广告」——2026-09-26 生产核实，
    //    有账户只登记给一个客户、五层快照照常抓，里面却在投别的客户主页的广告。广告级 D2/D10 因此按创意主页
    //    过滤（只判客户登记主页的广告）；D1/D3/D5/D9 这些广告组层判断还没有这层过滤，是已知缺口（见设计稿 §6）。
    diagnoses.push(...diagnosePlacementLeak(ctx))

    if (account.shared) {
      // §14 M9：同一账户登记给多个客户，未落广告系列级归属表前只到账户级
      excluded.push({
        adAccountId: account.adAccountId, level: 'account', id: account.adAccountId, name: ctx.accountRow?.entity_name ?? null,
        reason: 'shared_account', detail: '这个广告账户同时登记给了别的客户，只做账户级诊断（投放卡住、授权/数据体检）',
      })
      coverage.push({ adAccountId: account.adAccountId, ran: false, reason: 'shared_account', adsChecked: 0 })
      continue
    }

    diagnoses.push(...diagnoseSpendNoResult(ctx, input))
    const d4 = diagnoseUnharvestedAudience(ctx)
    if (d4) diagnoses.push(d4)
    diagnoses.push(...diagnoseBudgetResultMismatch(ctx, input))
    diagnoses.push(...diagnoseAdLevelRules(ctx, input))
    // D11 再营销受众池断供：只读发现 + 建议进待办，开顶层广告必须人点（手册 §二十八）
    diagnoses.push(...diagnoseAudiencePoolStarved(ctx, input))
    coverage.push(adLevelCoverage(ctx, input))
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

  // 客户没登记主页是客户级的一件事：多账户时只留一条
  const pageUnknown = diagnoses.filter(d => d.notComparableReason === 'client_page_unknown')
  for (const d of pageUnknown.slice(1)) diagnoses.splice(diagnoses.indexOf(d), 1)

  diagnoses.push(...diagnoseClientConfigHealth(input))
  const rank = (d: Diagnosis) => (d.status === 'hit' ? 0 : 1)
  diagnoses.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
  return { clientId: input.clientId, date: input.date, evaluatedAt: input.evaluatedAt, diagnoses, excluded, adLevelCoverage: coverage }
}
