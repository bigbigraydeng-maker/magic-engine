/**
 * 价格 / 折扣声明识别 —— 「真实价格只能配真实画面」这条红线的**触发条件**。
 *
 * 这条逻辑原本只长在 factory/copy-generator(拦 AI 编造的广告数字)。社媒图文帖走的是
 * 另一条路:文案是人写的、配图从素材库挑,AI 编造那道闸根本不经过。但红线是同一条 ——
 * 文案里写了真价,配图就必须是真拍的。两处各写一套正则 = 迟早漂移,所以收敛到这里。
 *
 * 这里只回答「这段文字里有没有价格声明」,**不**回答「这个价格是不是真的」——
 * 后者是 copy-generator 的白名单在管,两件事别混。
 *
 * ⚠️ 两个口径,别用错:后果不一样,所以宽严不一样。
 */

/**
 * 宽口径(**召回优先**)—— 只给「误判代价很小」的场景用。
 *
 * copy-generator 命中后是落模板兜底(文案变平淡,没人被挡住),所以宁可错杀:
 * 裸百分比、裸 "X for Y" 全收。覆盖:货币前缀($ / A$ / NZ$ / AUD / ￥)、
 * 百分比 / off / dollars / bucks 后缀、per-unit 裸价(/m²、/sqm、per m)、"X for Y"。
 *
 * 带 `g` 标志,只允许用 `String.prototype.match` 调用 —— `RegExp.test` 会推进
 * `lastIndex`,跨模块共用同一个实例时会出现「隔次返回 false」的幽灵 bug。
 */
export const PRICE_CLAIM_RECALL_RE =
  /(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:%|\boff\b|\bdollars?\b|\bbucks\b|\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?)|\d[\d,]*\s*\bfor\b\s*\d/gi

/**
 * 严口径(**精确优先**)—— 给会**挡住人干活**的硬闸用。
 *
 * 跟宽口径的差别只有两处,都是实打实的误伤:
 *   · 裸百分比 —— 「100% Kiwi owned」「100% authentic」是最常见的社媒文案之一,
 *     按价格拦掉等于把正常发帖判死。这里要求 % 旁边有折扣词(save / off / sale…)。
 *   · 裸 "X for Y" —— 「Top 10 for 2026」会命中。这里收窄成 "Buy 2 for 1" 式明确报价。
 *
 * 真价该拦的一条没放:任何带货币符号的金额、单价(29/m²)、"99 dollars"、
 * "40% off"、"Save 30%" 全在。
 */
export const PRICE_CLAIM_STRICT_RE = new RegExp(
  [
    // $29 · A$1,299 · NZ$450 · AUD 88 · ￥3999
    String.raw`(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?`,
    // 99 dollars · 20 bucks
    String.raw`\d[\d,]*(?:\.\d+)?\s*(?:\bdollars?\b|\bbucks\b)`,
    // 40% off · 20 off
    String.raw`\d[\d,]*(?:\.\d+)?\s*%?\s*\boff\b`,
    // Save 30% · sale 15% · RRP 20%（% 必须挨着折扣词才算报价）
    String.raw`\b(?:save|saving|savings|discount|discounted|sale|rrp)\b[^\n]{0,12}?\d[\d,]*(?:\.\d+)?\s*%`,
    // 29/m² · 45 per m · 88/sqm
    String.raw`\d[\d,]*(?:\.\d+)?\s*(?:\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?\b)`,
    // Buy 2 for 1 · buy 3 get 1
    String.raw`\bbuy\s*\d[\d,]*\s*(?:\bfor\b|\bget\b)\s*\d`,
  ].join('|'),
  'gi',
)

/**
 * 这段对外文字里有没有价格 / 折扣声明 —— **硬闸专用**,走严口径。
 * 会挡住 FDE 交付,所以宁可漏一点也不能误伤正常文案(见 PRICE_CLAIM_STRICT_RE)。
 */
export function containsPriceClaim(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || text.length === 0) return false
  return text.match(PRICE_CLAIM_STRICT_RE) !== null
}
