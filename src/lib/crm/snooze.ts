/**
 * 「这人先放一放」。
 *
 * PM 2026-08-03 问的是「能不能手动切换分组」。不给那个开关（手动维护的状态列
 * 必烂 —— CTS 那份手工 CRM 128 行里「阶段」列 0 个填了），但必须给这个出口：
 * 销售挂了电话知道「他三个月后才定」，现在唯一能做的是眼看着这个人明天、
 * 后天、大后天继续出现在名单上。名单开始说假话，人就不再用它。
 *
 * 关键差别：推迟**改变系统看到的事实**，不是把分批结果按住。所以它到期
 * 自己失效（见 lib/crm/segments 里那条规则），没有任何人需要记得去解除。
 */

/** 天数只收这个范围内的整数。 */
const MIN_DAYS = 1
/**
 * 一年封顶。
 *
 * 不是怕数字大，是怕**打错**：手滑输成 3650 天，这个人就在十年里从名单上
 * 彻底消失，而且没有任何地方会提醒谁去看他。真要永久排除，该走「别再联系」
 * 或者阶段那条路 —— 那两条有各自的语义和记录，比一个超长的推迟诚实。
 */
const MAX_DAYS = 365

export type SnoozeParse =
  | { ok: true; until: string | null }
  | { ok: false; error: string }

/**
 * 把「推迟几天」算成一个具体时间。
 *
 * 由**服务端**算，不接受前端直接传时间点：前端传时间点就要处理时区，
 * 而这一页同时给新西兰和澳洲的人用，算错一天就是一个人早一天或晚一天回名单。
 *
 * @param days null / 0 = 取消推迟
 */
export function parseSnoozeDays(days: unknown, now: Date): SnoozeParse {
  if (days === null || days === 0) return { ok: true, until: null }

  if (typeof days !== 'number' || !Number.isFinite(days) || !Number.isInteger(days)) {
    return { ok: false, error: '推迟天数必须是整数' }
  }
  if (days < MIN_DAYS || days > MAX_DAYS) {
    return { ok: false, error: `推迟天数要在 ${MIN_DAYS} 到 ${MAX_DAYS} 之间` }
  }

  return { ok: true, until: new Date(now.getTime() + days * 86_400_000).toISOString() }
}
