/**
 * 把一条错误信息压成「同一个原因」的签名 —— 好让同一个毛病的 N 次报错
 * 在日报里收成一行，而不是占 25 行把真告警淹死。
 *
 * 真实规模：2026-09-22 那封失败邮件 80 行，其中 prospecting-sweep 一家 25 行（31%，
 * 它因为 Google 地图账单没开已经连挂 505 次）、messenger-sync-hourly 24 行。
 *
 * 🔴 魏征 2026-09-23 复审抓到的关键约束：**不许一刀切抹掉所有数字。**
 *    抹光了会把互不相干的真问题合并成一条，等于降噪把真告警一起降掉：
 *      · PITFALLS F6 的三个根因 `(#10)` 缺权限 / `(#100)` 帖子不存在 / `(#12)` 端点下线
 *        —— 文档写死了每个都单独致命，抹掉数字后会变成同一行
 *      · `status 429` 和 `status 500` 会变成同一行 —— 而这个改动的核心卖点
 *        恰恰是「429 不等于没钱」，降噪这一步不能把刚建立的区分又抹平
 *
 *    所以反过来做：**平台错误码和 HTTP 状态码是白名单，必须保留**，
 *    只抹计数、耗时、行号、时间戳、长 id 这些「同一个毛病每次都不同」的东西。
 */

/** 同一个毛病每次都不同、但说的是同一件事 —— 这些先抹掉。 */
const NOISE_PATTERNS: RegExp[] = [
  // uuid
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // ISO 时间戳
  /\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2})?(\.\d+)?z?\b/gi,
  // url 的 query 串
  /\?[^\s"']{1,200}/g,
  // 长 id / token 串 —— **必须带数字**才抹。
  //
  // 🔴 魏征 2026-09-23 实施后复审抓到的假合并（实跑验证过）：
  //    原先写的是 `/\b[0-9a-z_-]{16,}\b/gi`，不管带不带数字一律抹掉。
  //    可 `insufficient_quota`（19 字符）和 `rate_limit_exceeded`（19 字符）
  //    都是纯 snake_case —— 双双被抹成 `#`，只要句子其余部分相同
  //    （同一个 wrapper 加的后缀很常见），**「没钱了」和「太快了」就收成同一行**。
  //    而「429 不等于没钱」正是这次改动的核心卖点，降噪这一步等于把它又抹平了。
  //
  //    真的 id / token / hash 一定含数字，snake_case 错误码不含 —— 以此区分。
  /\b(?=[0-9a-z_-]{16,}\b)[0-9a-z_-]*\d[0-9a-z_-]*\b/gi,
]

/**
 * 剩下的裸数字：先看它是不是白名单里的东西，是就原样留着。
 *
 * 交替的顺序是刻意的 —— `(#100)` 这个分支必须排在裸数字前面，
 * 否则正则在 `(` 的位置会先去匹配数字，把错误码拆散。
 */
const NUMBER_PATTERN = /\(#\d{1,4}\)|\b\d+\b/g

const MAX_SIGNATURE_LEN = 160

/**
 * 同一个原因 → 同一个签名。
 *
 * 空错误信息返回 `''`，由调用方决定怎么分组 —— **不要**把所有空错误合成一条：
 * 「这次跑整体没干成但没有可数的失败对象」在不同任务上是完全不同的事
 * （见 digest-cells.ts 的 `needs attention`）。
 */
export function failureSignature(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return ''

  let s = raw.toLowerCase()
  for (const re of NOISE_PATTERNS) s = s.replace(re, '#')

  s = s.replace(NUMBER_PATTERN, (match) => {
    // 平台错误码 `(#100)` —— 每个码是一个独立的根因，原样保留
    if (match.startsWith('(#')) return match
    // HTTP 状态码 —— 限流(429) 和「接口没了」(404/500) 不是一回事
    if (/^[45]\d{2}$/.test(match)) return match
    return '#'
  })

  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_SIGNATURE_LEN)
}
