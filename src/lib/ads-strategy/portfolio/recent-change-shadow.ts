/**
 * 「刚动过的广告组」影子判断（Agent 闭环升级第 1 步，docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md §4）。
 *
 * 纯函数：只读诊断输入里已有的设置变化（`AccountInput.settingChanges`，快照算出来的，
 * 人在 Ads Manager 里手改的也算），不查库、不改任何传进来的东西。
 *
 * 收放分开（硬规则）：
 *   - 放类（O1 加预算）：72 小时内动过这个广告组或它的系列 → 记「本该压住」；
 *   - 收类（D3 花钱没结果 / 止损）：**永远不压**，只记「本该加一行标注」。
 *
 * 🔴 本步只影子跑：结果只写进每日任务的运行日志（`cron_run_logs.summary`），
 *    正式诊断、待办、日报、D3 / O1 的提议一个字不改。影子期满 PM 看过结果才另开改动单生效。
 */

import type { Diagnosis, DiagnosisInput } from './diagnostics/types'

/** 跟内核授权的冷却期同一个数（`kernel/outward-authorization.ts` 的 MIN_ALLOWED_HOURS_SINCE_LAST_CHANGE）。 */
export const RECENT_CHANGE_COOLDOWN_HOURS = 72

/** 放类：会让我们往这个组多花钱的建议。 */
const SCALE_UP_CODES: ReadonlySet<string> = new Set(['O1'])
/** 收类：止损。只标注，不压。 */
const STOP_LOSS_CODES: ReadonlySet<string> = new Set(['D3'])

const MAX_SAMPLES = 3

export interface RecentChangeFlag {
  code: string
  adset_id: string
  changed_at: string
  hours_ago: number
}

export interface RecentChangeShadow {
  scale_up_hits: number
  would_suppress: number
  stop_loss_hits: number
  would_annotate: number
  samples: RecentChangeFlag[]
}

const HOUR_MS = 3_600_000

/** 每个实体（广告组 / 系列）在冷却期内最近一次设置变化的时间。 */
function latestChangesInWindow(input: DiagnosisInput): Map<string, string> {
  const now = Date.parse(input.evaluatedAt)
  const out = new Map<string, string>()
  for (const account of input.accounts) {
    for (const c of account.settingChanges ?? []) {
      if (c.level !== 'adset' && c.level !== 'campaign') continue
      const at = Date.parse(c.captured_at)
      const hours = (now - at) / HOUR_MS
      if (!Number.isFinite(hours) || hours < 0 || hours >= RECENT_CHANGE_COOLDOWN_HOURS) continue
      const prev = out.get(c.entity_id)
      if (!prev || Date.parse(prev) < at) out.set(c.entity_id, c.captured_at)
    }
  }
  return out
}

/** 广告组 → 所属系列（CBO 加预算加的是系列预算，系列刚动过也算）。 */
function campaignOfAdset(input: DiagnosisInput): Map<string, string> {
  const out = new Map<string, string>()
  for (const account of input.accounts) {
    for (const s of account.snapshots) {
      if (s.level === 'adset' && s.campaign_id) out.set(s.entity_id, s.campaign_id)
    }
  }
  return out
}

/** 对一批诊断 / 机会结论做影子判断。只看 status='hit' 的放类和收类结论。 */
export function recentChangeShadow(input: DiagnosisInput, findings: readonly Diagnosis[]): RecentChangeShadow {
  const changes = latestChangesInWindow(input)
  const campaignOf = campaignOfAdset(input)
  const now = Date.parse(input.evaluatedAt)
  const shadow: RecentChangeShadow = { scale_up_hits: 0, would_suppress: 0, stop_loss_hits: 0, would_annotate: 0, samples: [] }

  for (const f of findings) {
    if (f.status !== 'hit') continue
    const scaleUp = SCALE_UP_CODES.has(f.code)
    const stopLoss = STOP_LOSS_CODES.has(f.code)
    if (!scaleUp && !stopLoss) continue
    if (scaleUp) shadow.scale_up_hits += 1
    else shadow.stop_loss_hits += 1

    const adset = f.units.find(u => u.level === 'adset')
    if (!adset) continue
    const campaignId = campaignOf.get(adset.id)
    const changedAt = changes.get(adset.id) ?? (campaignId ? changes.get(campaignId) : undefined)
    if (!changedAt) continue

    if (scaleUp) shadow.would_suppress += 1
    else shadow.would_annotate += 1
    if (shadow.samples.length < MAX_SAMPLES) {
      shadow.samples.push({
        code: f.code,
        adset_id: adset.id,
        changed_at: changedAt,
        hours_ago: Math.round((now - Date.parse(changedAt)) / HOUR_MS),
      })
    }
  }
  return shadow
}

/** 影子判断出错只记一句，绝不让正式流程（诊断、巡察、日报）跟着挂。 */
export function safeRecentChangeShadow(
  input: DiagnosisInput,
  findings: readonly Diagnosis[],
): RecentChangeShadow | { error: string } {
  try {
    return recentChangeShadow(input, findings)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
