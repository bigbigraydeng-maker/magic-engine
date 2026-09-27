/**
 * 广告只读诊断 · 编排（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。纯函数。
 *
 * 顺序：按创意主页切掉不是客户的系列/广告组（ownership.ts）→ 按账户建上下文（角色、实验排除）→ 共用账户只做
 * 账户级/配置级（D1、D7）→ 其余账户再跑 D9/D3/D4/D5/D8 与广告级 D2/D10/D11 → 客户级体检（日报收件人、结果阶梯配置）。
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
import { diagnosePageMismatch, flagDroppedAdsetUnits, scopeAccountToClient } from './ownership'
import type { AdLevelCoverage, Diagnosis, DiagnosisInput, DiagnosisRun, ExcludedEntity } from './types'

export function runDiagnostics(input: DiagnosisInput): DiagnosisRun {
  const diagnoses: Diagnosis[] = []
  const excluded: ExcludedEntity[] = []
  const coverage: AdLevelCoverage[] = []

  for (const raw of input.accounts) {
    // 先切成「只剩客户自己的」系列/广告组，再建上下文：账户里别的主页的广告组不进任何广告组/系列层判断（ownership.ts）。
    // 🔴 「登记表只登记给一个客户」不等于「账户里只有这个客户的广告」——2026-09-26 生产核实，有账户只登记给一个客户、
    //    五层快照照常抓，里面却在投别的客户主页的广告。客户没登记主页时不切（归属未核实，自动暂停另有一道闸拦），
    //    但账户里出现 ≥2 个主页就降级成只做账户级。
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date)
    const account = scoped.account
    const ctx = buildAccountContext(account, input.date)
    // 广告级 D2/D10/D11 在没切的上下文上跑：它们自己逐条按创意主页过滤；切掉「混着别的主页」的广告组会让
    // 客户自己挂在里面的广告静默漏检（子牙 2026-09-27）
    const rawCtx = account === raw ? ctx : buildAccountContext(raw, input.date)
    excluded.push(...scoped.excluded, ...ctx.excluded)

    const d1 = diagnoseDeliveryStall(ctx, input.evaluatedAt)
    if (d1) diagnoses.push(d1)
    diagnoses.push(...diagnoseAccountHealth(ctx, input))
    const mismatch = diagnosePageMismatch(raw, scoped, input.clientId, input.date)
    if (mismatch) diagnoses.push(mismatch)

    if (account.shared) {
      // §14 M9：同一账户登记给多个客户，未落广告系列级归属表前只到账户级
      excluded.push({
        adAccountId: account.adAccountId, level: 'account', id: account.adAccountId, name: ctx.accountRow?.entity_name ?? null,
        reason: 'shared_account', detail: '这个广告账户同时登记给了别的客户，只做账户级诊断（投放卡住、授权/数据体检）',
      })
      coverage.push({ adAccountId: account.adAccountId, ran: false, reason: 'shared_account', adsChecked: 0 })
      continue
    }
    if (scoped.accountLevelOnly) {
      // 客户没登记主页、账户里又有多个主页：只剩「去登记主页」那条提醒（D2/D10 的 client_page_unknown）
      diagnoses.push(...diagnoseAdLevelRules(rawCtx, input))
      coverage.push(adLevelCoverage(rawCtx, input))
      continue
    }

    // D9 是配置检查（这个广告组自己设置对不对）。放在账户级闸之后：共用账户本来就没有广告组快照（§14 M9），
    // 只做账户级的账户里广告组又分不清是谁的。
    diagnoses.push(...diagnosePlacementLeak(ctx))
    diagnoses.push(...diagnoseSpendNoResult(ctx, input))
    const d4 = diagnoseUnharvestedAudience(ctx)
    if (d4) diagnoses.push(d4)
    diagnoses.push(...diagnoseBudgetResultMismatch(ctx, input))
    diagnoses.push(...flagDroppedAdsetUnits(diagnoseAdLevelRules(rawCtx, input), scoped))
    // D11 再营销受众池断供：只读发现 + 建议进待办，开顶层广告必须人点（手册 §二十八）
    diagnoses.push(...flagDroppedAdsetUnits(diagnoseAudiencePoolStarved(rawCtx, input), scoped))
    coverage.push(adLevelCoverage(rawCtx, input))
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
