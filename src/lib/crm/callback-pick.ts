/**
 * 「约回电」快捷选时间 —— 销售在记一笔的框旁边点一个按钮，就把下次回电时间
 * 结构化地交给系统，不再靠 AI 去读「约了明天下午 2 点回电」这句话。
 *
 * 为什么要有这个：以前下一步时间只能靠 note-parser 的模型从原话里抠，抠不出来
 * （说得含糊 / 模型漏了）就静悄悄没排上，到那天没人提醒。按钮选出来的时间是
 * 确定的，不经过任何猜测。
 *
 * 三条规矩：
 *   1. 时间按**客户所在地**的时区算（CTS = Pacific/Auckland），不按服务器、
 *      也不按销售浏览器的时区 —— 所以三个快捷项只传「名字」，由服务端换算。
 *   2. 服务端必须再校验一遍：不能是过去、不能超过 60 天（超过多半是手滑选错年）。
 *   3. 这里只管「时间怎么算、怎么校验」。写触点在 touchpoints.ts，
 *      给销售的确认话术在 callbackBookedMessage。
 */

import { z } from 'zod'
import { tzOffsetMs } from './day-list'
import type { NoteParse } from './note-parser'
import { CALLBACK_PRESETS, CALLBACK_PRESET_LABELS, type CallbackPreset } from './callback-presets'

/** 最远能约多远。再远多半是选错了年份。 */
export const MAX_CALLBACK_AHEAD_DAYS = 60
const DAY_MS = 86_400_000

export { CALLBACK_PRESETS, CALLBACK_PRESET_LABELS, type CallbackPreset }

/** 请求体里跟回电有关的两个字段。两个都不传 = 没约。 */
export const CallbackRequestSchema = z
  .object({
    /** 自选时间：带时区的 ISO，或不带时区的当地时间「2026-11-03T14:00」（按客户所在地算）。 */
    callbackAt: z.string().trim().min(1).max(40).optional(),
    /** 三个一键快捷项之一。 */
    callbackPreset: z.enum(CALLBACK_PRESETS).optional(),
  })
  .refine((v) => !(v.callbackAt && v.callbackPreset), {
    message: '回电时间只能选一种方式',
  })

export type CallbackResolution =
  | { ok: true; iso: string | null }
  | { ok: false; error: string }

/** 某个时区「现在」的年月日和星期（0 = 周日）。 */
function localDate(now: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = day.split('-').map(Number)
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/**
 * 当地墙上时间 → 真实时刻。
 *
 * 偏移量要在「目标那一刻附近」取，不能在 UTC 零点取 —— 夏令时换季那天
 * 两者不一样（跟 day-list 的 localDayStartMs 同一个坑，同样迭代一次收敛）。
 */
function wallToInstant(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const asUtc = Date.UTC(y, m - 1, d, hh, mm, 0)
  const guess = asUtc - tzOffsetMs(new Date(asUtc), timeZone)
  return new Date(asUtc - tzOffsetMs(new Date(guess), timeZone))
}

/** 三个快捷项 → 客户所在地的真实时刻（ISO）。 */
export function resolveCallbackPreset(preset: CallbackPreset, now: Date, timeZone: string): string {
  const { y, m, d, weekday } = localDate(now, timeZone)
  let addDays = 1
  let hour = 10
  if (preset === 'tomorrow_pm') hour = 14
  if (preset === 'next_monday_am') {
    // 今天周日 → 明天就是下周一；今天周一 → 7 天后，不是今天。
    addDays = ((1 - weekday + 7) % 7) || 7
  }
  // Date.UTC 会自己处理跨月跨年（d + addDays 超出当月天数）。
  const target = new Date(Date.UTC(y, m - 1, d + addDays))
  return wallToInstant(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    hour,
    0,
    timeZone,
  ).toISOString()
}

const ZONED_ISO = /(Z|[+-]\d{2}:?\d{2})$/i
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

/** 自选时间的原始字符串 → 真实时刻。读不懂返回 null。 */
function parseCustomInstant(raw: string, timeZone: string): Date | null {
  if (ZONED_ISO.test(raw)) {
    const t = new Date(raw)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const w = WALL_CLOCK.exec(raw)
  if (!w) return null
  const [y, m, d, hh, mm] = [w[1], w[2], w[3], w[4], w[5]].map(Number)
  // 2026-02-31 这种日历上不存在的日子，Date.UTC 会悄悄滚到三月 —— 对不上就拒绝。
  const probe = new Date(Date.UTC(y, m - 1, d, hh, mm))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d ||
    hh > 23 ||
    mm > 59
  ) {
    return null
  }
  return wallToInstant(y, m, d, hh, mm, timeZone)
}

/**
 * 把请求里的回电字段变成一个校验过的 ISO 时刻。
 *
 * @returns iso = null 表示这次没约回电；ok=false 带一句能直接给销售看的原因。
 */
export function resolveCallbackRequest(
  input: { callbackAt?: unknown; callbackPreset?: unknown },
  now: Date,
  timeZone: string,
): CallbackResolution {
  if (input.callbackAt === undefined && input.callbackPreset === undefined) {
    return { ok: true, iso: null }
  }
  const parsed = CallbackRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: '回电时间格式不对，请重新选一次' }

  const { callbackAt, callbackPreset } = parsed.data
  const at = callbackPreset
    ? new Date(resolveCallbackPreset(callbackPreset, now, timeZone))
    : parseCustomInstant(callbackAt ?? '', timeZone)
  if (!at) return { ok: false, error: '回电时间格式不对，请重新选一次' }

  const delta = at.getTime() - now.getTime()
  if (delta <= 0) return { ok: false, error: '回电时间已经过了，请选一个以后的时间' }
  if (delta > MAX_CALLBACK_AHEAD_DAYS * DAY_MS) {
    return { ok: false, error: `回电时间最远只能约 ${MAX_CALLBACK_AHEAD_DAYS} 天以内` }
  }
  return { ok: true, iso: at.toISOString() }
}

/**
 * 把校验过的回电时间盖到解析结果上：**按钮选的时间赢过 AI 从原话里读出来的**。
 *
 * 例外两条，都是合规/事实压过日程：「别再联系」和「号码是坏的」。
 * 另外「没接」「先不考虑」保留员工原本的结论，只补时间。
 * 一个说了别再打的人，不能因为销售顺手点了个时间就被排进回电名单。
 * 员工写的原话（summary / raw）一个字不动，这里只改结论和时间。
 */
export function withStructuredCallback(parsed: NoteParse, callbackIso: string | null | undefined): NoteParse {
  if (!callbackIso) return parsed
  if (parsed.do_not_contact || parsed.outcome === 'bad_number') return parsed
  // 员工自己写的结论是「没接 / 客人说先不考虑」时保留它，只补回电时间 ——
  // 「没接，约明天再打」仍是一次没接通，不能改标成「聊上了约了回电」。
  const keepsOwnOutcome = parsed.outcome === 'no_answer' || parsed.outcome === 'not_interested_now'
  return {
    ...parsed,
    outcome: keepsOwnOutcome ? parsed.outcome : 'callback_set',
    callback_at: callbackIso,
    mentioned_next_step: true,
  }
}

/** 保存后给销售看的那句确认：「已约 11月2日周一 上午10:00 回电」。 */
export function callbackBookedMessage(iso: string, timeZone = 'Pacific/Auckland'): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const when = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d)
    return `已约 ${when} 回电`
  } catch {
    return null
  }
}
