/**
 * AI 概况卡上的「生成于 X」。
 *
 * 为什么要写：简报是 AI 在某一刻生成的，里面常带「明天 11 点」「等待了 825 小时」
 * 这类跟生成时刻绑死的说法。卡上不写生成时间，员工没法判断它还新不新。
 *
 * 按新西兰日历日算「几天前」（CTS 员工在新西兰上班），不按 24 小时算：
 * 昨晚 11 点生成、今早 8 点看，是「昨天」不是「0 天前」。
 */

const NZ_TZ = 'Pacific/Auckland'

/** 超过这么多天，卡上多提醒一句「可能已过时」。 */
export const BRIEF_STALE_DAYS = 3

export interface BriefAge {
  /** 例：「生成于 10月26日（昨天）」 */
  label: string
  /** 超过 BRIEF_STALE_DAYS 天 */
  stale: boolean
}

function nzParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN)
  return { y: get('year'), m: get('month'), day: get('day') }
}

/** 返回 null = 时间没法读，卡上就不写（不猜）。 */
export function briefAge(generatedAt: string | null | undefined, now: Date = new Date()): BriefAge | null {
  if (!generatedAt) return null
  const made = new Date(generatedAt)
  if (Number.isNaN(made.getTime())) return null

  const a = nzParts(made)
  const b = nzParts(now)
  if ([a.y, a.m, a.day, b.y, b.m, b.day].some(Number.isNaN)) return null

  const days = Math.round((Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day)) / 86_400_000)
  if (days < 0) return null // 时钟对不上（生成时间在未来），不写

  const when = days === 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`
  return { label: `生成于 ${a.m}月${a.day}日（${when}）`, stale: days >= BRIEF_STALE_DAYS }
}
