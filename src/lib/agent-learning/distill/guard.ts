/**
 * 蒸馏输出的注入与噪声防护（纯函数，无网络、无 DB、无 SDK）。
 * 原文与模型输出都按不可信数据处理：命中即丢弃该条，绝不执行、绝不升格状态。
 */

/** 提示词注入的可疑模式：大小写不敏感；命中即可疑指令，不当规则用 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all |the )?(previous|above|prior)/i,
  /忽略(以上|上面|之前)/,
  /you are now/i,
  /你现在是/,
  /system prompt/i,
  /系统提示/,
  /\badopted\b/i,
  /call (the )?tool/i,
  /调用工具/,
  /function_call/i,
  /<\/?script/i,
]

/** URL / 站点名：规则句里出现链接即不可注入（链接属来源卡，不属规则正文） */
export const URL_RE: RegExp = /https?:\/\/|www\./i

/** 作者给的数字或效果（百分比、钱、倍数）：属「作者说法」，不得进规则句 */
export const AUTHOR_NUMBER_RE: RegExp = /\d+(?:\.\d+)?\s*(?:%|％|percent|倍|x\b)|[$€£¥]\s*\d|\d+(?:\.\d+)?\s*(?:美元|元|块|dollars?)/i

/** 单条文本的守护结论：ok，或命中的第一个原因 */
export type GuardVerdict =
  | { ok: true }
  | { ok: false; reason: 'injection_suspected' | 'contains_url' | 'contains_author_number' }

/** 文本里是否出现疑似注入指令（只看模式，不判断语义） */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 守护一条规则句：先查注入，再查 URL，最后查作者数字。
 * 顺序固定，保证同一个输入永远得到同一个原因，调用方按 reason 记录 `fail_reason`。
 */
export function guardRuleText(text: string): GuardVerdict {
  if (looksLikeInjection(text)) return { ok: false, reason: 'injection_suspected' }
  if (URL_RE.test(text)) return { ok: false, reason: 'contains_url' }
  if (AUTHOR_NUMBER_RE.test(text)) return { ok: false, reason: 'contains_author_number' }
  return { ok: true }
}
