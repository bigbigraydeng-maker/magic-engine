/**
 * ② 频率有没有过高。
 *
 * 🔴 频率只有数据新才说得出「没过高」。数据日落后今天超过 2 天，这句话只能是「判不了」，
 *    并写明数据停在哪天（魏征 2026-10-16 必改 1：广告停了 6 天，页面还绿灯说没过高）。
 * 🔴 「近 7 天花费」要标真实日期区间（数据日往前 7 天），不是「今天往前 7 天」。
 */

import { FATIGUE_FREQUENCY_HIGH } from '../rules/fatigue'
import { diffDays, nzDay, shiftDay, shortDay } from './util'
import type { FrequencyRow, Headline, Light, StoppedCampaign, WarMapInput } from './types'

/** 数据日落后今天超过这么多天，就算数据停了 */
export const DATA_STALE_DAYS = 2

export function dataStaleDays(input: WarMapInput): number | null {
  const day = input.clocks.dataDay
  return day ? diffDays(day, nzDay(input.now)) : null
}

export function windowLabel(dataDay: string | null): string | null {
  return dataDay ? `${shortDay(shiftDay(dataDay, -6))}–${shortDay(dataDay)}` : null
}

function rowOf(c: WarMapInput['campaigns'][number], names: Map<string, string>, stale: boolean, dataDay: string | null): FrequencyRow {
  const f = c.frequency7d
  let light: Light = 'green'
  let note = '没过红线 3'
  if (f === null) {
    light = 'unknown'
    note = '没有 7 天频率'
  } else if (f > FATIGUE_FREQUENCY_HIGH) {
    light = 'red'
    note = '高于 3：同一批人在反复看，要换人或降预算'
  } else if (stale) {
    light = 'unknown'
    note = `数据停在 ${dataDay ? shortDay(dataDay) : '更早'}，只供参考`
  }
  return {
    campaignId: c.campaignId,
    campaignName: c.campaignName ?? c.campaignId,
    accountName: names.get(c.adAccountId) ?? c.adAccountId,
    frequency7d: f,
    spend7d: c.spend7d,
    light,
    note,
  }
}

function maxFrequency(rows: FrequencyRow[]): number | null {
  const nums = rows.map(r => r.frequency7d).filter((v): v is number => v !== null)
  return nums.length > 0 ? Math.max(...nums) : null
}

export function frequencyHeadline(rows: FrequencyRow[], staleDays: number | null, dataDay: string | null): Headline {
  if (dataDay === null) return { light: 'unknown', sentence: '频率判不了：没有广告数据' }
  if (rows.length === 0) return { light: 'unknown', sentence: '频率判不了：近 7 天没有花钱的广告' }
  const red = rows.filter(r => r.light === 'red').length
  const stale = staleDays !== null && staleDays > DATA_STALE_DAYS
  const max = maxFrequency(rows)
  if (red > 0) {
    const tail = stale ? `（数据停在 ${shortDay(dataDay)}）` : ''
    return { light: 'red', sentence: `有 ${red} 条广告频率高于 3，在反复打扰同一批人${tail}` }
  }
  if (stale) {
    const peak = max === null ? '' : `；最近读到的最高是 ${max.toFixed(2)}`
    return { light: 'unknown', sentence: `频率判不了：广告数据停在 ${shortDay(dataDay)}，已经 ${staleDays} 天没有新数据${peak}` }
  }
  if (max === null) return { light: 'unknown', sentence: '频率判不了：广告没有 7 天频率' }
  const missing = rows.filter(r => r.frequency7d === null).length
  if (missing > 0) {
    return { light: 'yellow', sentence: `频率没过高（最高 ${max.toFixed(2)}），但有 ${missing} 条广告没有 7 天频率，判不了` }
  }
  return { light: 'green', sentence: `频率没过高，最高 ${max.toFixed(2)}，红线 3` }
}

/** 比表头数据日早 2 天以上就没再花钱的系列 = 已停 */
function isStopped(c: WarMapInput['campaigns'][number], dataDay: string | null): boolean {
  return !!c.lastSpendDay && !!dataDay && diffDays(c.lastSpendDay, dataDay) >= DATA_STALE_DAYS
}

/** dataDay / staleDays 由表头统一算好传进来，频率卡和表头同一个数据日 */
export function buildFrequency(
  input: WarMapInput,
  names: Map<string, string>,
  fresh: { dataDay: string | null; staleDays: number | null },
): { headline: Headline; rows: FrequencyRow[]; windowLabel: string | null; stopped: StoppedCampaign[] } {
  const { dataDay, staleDays } = fresh
  const stale = staleDays !== null && staleDays > DATA_STALE_DAYS
  const spending = input.campaigns.filter(c => c.spend7d > 0)
  const rows = spending
    .filter(c => !isStopped(c, dataDay))
    .sort((a, b) => b.spend7d - a.spend7d)
    .map(c => rowOf(c, names, stale, dataDay))
  const stopped = spending
    .filter(c => isStopped(c, dataDay))
    .map((c): StoppedCampaign => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName ?? c.campaignId,
      accountName: names.get(c.adAccountId) ?? c.adAccountId,
      lastSpendDay: c.lastSpendDay ?? '',
      frequency7d: c.frequency7d,
    }))
  return {
    headline: frequencyHeadline(rows, staleDays, dataDay),
    rows,
    windowLabel: windowLabel(dataDay),
    stopped,
  }
}
