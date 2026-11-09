/**
 * D3（花钱没结果）诊断结论 → `GrowthActionCandidate` 包装。
 *
 * 🔴 只做**结构包装 + 校验**，不参与授权判断——Growth 契约本身就规定候选
 *    不带 risk / sideEffect / policy / approved 任何一项（WP00 §8.2）。
 *    这一层存在的意义是让诊断结论在提交 Kernel 之前，先过一遍平台统一的
 *    「Finding 必须有 Evidence」「花钱必须说得出上界」这类结构性红线，
 *    而不是让每条域自己发明一套不受约束的证据形状。
 *
 * 🔴 D1-D9 诊断（`portfolio/diagnostics/`）产出的是 `Diagnosis`，不是
 *    `GrowthFinding`——两套系统字段不同构，这里手动做一次浅映射，
 *    不改动 diagnostics 模块本身（那是独立、只读、平台共享的判定层）。
 */

import type { Diagnosis, DiagnosisUnit } from './diagnostics/types'
import type { GrowthActionCandidate } from '@/lib/growth'

export function buildD3GrowthCandidate(args: {
  clientId: string
  insightDate: string
  diagnosis: Diagnosis
  unit: DiagnosisUnit
}): GrowthActionCandidate {
  const { insightDate, diagnosis, unit } = args
  return {
    identity: { domain: 'ads', intent: 'pause_spend_no_result_adset' },
    input: {
      ad_account_id: unit.adAccountId,
      adset_id: unit.id,
      insight_date: insightDate,
    },
    basis: [
      {
        pillar: 'ads',
        severity: 'high',
        statement: diagnosis.title,
        evidence: [
          {
            source: { kind: 'ads_portfolio_diagnostics_d3', sourceId: `${unit.adAccountId}:${unit.id}:${insightDate}` },
            observedAt: new Date().toISOString(),
            rawLocator: { known: false, reason: 'not_recorded_by_source' },
            interpretation: { known: true, value: { parserVersion: 'd3-spend-no-result-v1' } },
            confidence: { known: false, reason: 'not_applicable' },
          },
        ],
      },
    ],
    expectedImpact: 'medium',
    cost: { spendsMoney: false, ceilingUsd: { known: true, value: 0 } },
    verification: {
      metricRef: 'ads.adset_daily_spend',
      windowDays: 7,
      baseline: '暂停前近 7 天该广告组的花费与主结果数',
      criteria: {
        success: '暂停后该广告组花费降为 0，且没有被人工重新开启',
        failure: '暂停后仍在花费，或被重新开启后 7 天内又命中同一条 D3',
        indeterminate: '暂停前不足 7 天数据，或诊断因缺数据判不了',
      },
    },
  }
}
