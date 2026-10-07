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
 * 2026-10-05 补强币种写法:NZD/USD/AUD/RMB、¥、元、纽币、新西兰元、澳元、美元、澳币、
 * 新西兰币、美金;币种在数字前后两种顺序;k 后缀。
 *
 * 注意:CNY **故意**不收 —— 在旅游文案里 CNY 是 Chinese New Year 的意思
 * ("CNY 2027 tours"、"Spring 2027 CNY special"),当成人民币会把正常帖子判成价格声明。
 * 要写人民币请用 RMB / 人民币 / ¥。
 */
const CURRENCY_CODE_BEFORE = String.raw`(?:nzd|aud|usd|rmb)`
// 币种码在数字后:允许 "NZDpp"(价格写法),否则后面不能跟字母、"_" 或 "-"。
const CURRENCY_CODE_AFTER = String.raw`(?:nzd|aud|usd|rmb)(?:pp\b|(?![a-z_-]))`
// 口语币种词:纽元/澳刀/美刀 也收。
const CURRENCY_WORD = String.raw`(?:人民币|纽币|纽元|新西兰元|新西兰币|澳元|澳币|澳刀|美元|美金|美刀)`
// before the number. NO trailing \b on purpose: in "NZD4999" there is no word boundary between D and 4.
const CURRENCY_BEFORE = String.raw`(?:\b${CURRENCY_CODE_BEFORE}|\bus\$|[¥￥]|${CURRENCY_WORD})`
// after the number. A letter code must not be followed by a letter, "_" or "-" (so "5 audience",
// "2 NZD-friendly cafes" are not prices); "元" must not be followed by 旦 宵 素 件 帅 老 宇 首 年 朝 月
// 宝 朗 气 数 祖 代 曲 (元旦 元宵 元素 元件 元帅 元老 元宇宙 元首 元年 元朝 元月 元宝 元朗 元气 元数 元祖 元代 元曲).
const CURRENCY_AFTER = String.raw`(?:${CURRENCY_CODE_AFTER}|元(?![旦宵素件帅老宇首年朝月宝朗气数祖代曲])|${CURRENCY_WORD})`
const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?`
// 万/千: "1.2万元" "8千元" "2万纽币"
const AMOUNT_K = String.raw`${AMOUNT}(?:k\b|万|千)?`
// IMPORTANT: horizontal whitespace only, so "All prices in NZD\n7 day tour" never pairs across a line break.
const HSPACE = String.raw`[^\S\r\n]*`
// "NZD 7 day itinerary", "USD 3 nights", "NZD 2 adults", "澳币 3 天", "美金 10 人" are NOT prices. The digit guard (?!\d) stops the amount from backtracking to a shorter number; 人 followed by 均 ("人均") IS a price and is not excluded.
const AMOUNT_UNIT_GUARD = String.raw`(?!\d)(?![^\S\r\n]*(?:(?:days?|nights?|adults?|child(?:ren)?|stars?|people|persons?|pax|guests?|hours?|weeks?)\b|[天晚]|人(?!均)))`
const CURRENCY_CLAIM_SOURCES = [
  String.raw`${CURRENCY_BEFORE}${HSPACE}${AMOUNT_K}${AMOUNT_UNIT_GUARD}`,
  String.raw`${AMOUNT_K}${HSPACE}${CURRENCY_AFTER}`,
]

// 无币种符号的旅游报价:"3,499pp"、"2,699 per person"、"from 2,699"、"only 2699"、"price: 2699"、"Twin share 3,499"。
// 金额至少 3 位(或带千分位),所以 "2 per person"、"only 2 left" 不会命中。
const PRICE_NUMBER = String.raw`(?:\d{3,}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?`
const NON_PRICE_UNIT = String.raw`(?:people|persons?|guests?|spots?|seats?|places?|rooms?|tickets?|followers?|reviews?|km|years?|visitors?|members?|days?|nights?|adults?|child(?:ren)?|stars?|pax|hours?|weeks?)`
const PRICE_UNIT_CLAIM_SOURCES = [
  String.raw`(?<![\d,.])${PRICE_NUMBER}${HSPACE}(?:pp\b|p\.p\.|(?:per|a)${HSPACE}(?:person|adult|head|couple|pax)\b|twin${HSPACE}share\b|per${HSPACE}room\b)`,
  String.raw`\b(?:from|only|just|price[sd]?|priced?${HSPACE}at|costs?|fares?|twin${HSPACE}share)${HSPACE}[:：]?${HSPACE}(?!(?:19|20)\d\d(?![\d,]))(?<![\d,.])${PRICE_NUMBER}(?![\d,])(?!${HSPACE}${NON_PRICE_UNIT}\b)`,
]

/**
 * 宽口径(**召回优先**)—— 只给「误判代价很小」的场景用。
 *
 * copy-generator 命中后是落模板兜底(文案变平淡,没人被挡住),所以宁可错杀:
 * 裸百分比、裸 "X for Y" 全收。覆盖:货币前缀($ / A$ / NZ$ / AUD / ￥)、
 * 百分比 / off / dollars / bucks 后缀、per-unit 裸价(/m²、/sqm、per m)、"X for Y",
 * 以及 2026-10-05 补强的币种写法(NZD/USD/AUD/RMB、¥、元、纽币、新西兰元、澳元、美元、
 * 澳币、新西兰币、美金,币种在数字前后两种顺序,带 k 后缀)。
 *
 * 最后一条是**裸 k 后缀金额**("1.3k"、"20k")。宽口径命中后只是落模板兜底,多触发无害;
 * 但 2K/4K/8K 是视频分辨率,排除掉。这里只做**识别**,不把 1.3k 归一成 1300 ——
 * 数字归一化是第 4 步的事。
 *
 * 带 `g` 标志,只允许用 `String.prototype.match` 调用 —— `RegExp.test` 会推进
 * `lastIndex`,跨模块共用同一个实例时会出现「隔次返回 false」的幽灵 bug。
 */
export const PRICE_CLAIM_RECALL_RE = new RegExp(
  [
    // —— LEGACY 三条,语义与旧字面量完全一致 ——
    String.raw`(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?`,
    String.raw`\d[\d,]*(?:\.\d+)?\s*(?:%|\boff\b|\bdollars?\b|\bbucks\b|\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?)`,
    String.raw`\d[\d,]*\s*\bfor\b\s*\d`,
    // —— 2026-10-05 补强:币种写法 ——
    ...CURRENCY_CLAIM_SOURCES,
    // —— 2026-10-08 补强:无币种符号的旅游报价 ——
    ...PRICE_UNIT_CLAIM_SOURCES,
    // —— 裸 k 后缀金额(仅宽口径)——
    String.raw`\b(?!(?:2|4|8)k\b)${AMOUNT}k\b`,
  ].join('|'),
  'gi',
)

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
 *
 * 2026-10-05 补强:币种写法(NZD/USD/AUD/RMB、¥、元、纽币、新西兰元、澳元、美元、澳币、
 * 新西兰币、美金,币种在数字前后两种顺序,带 k 后缀)也纳入严口径 —— 每一条
 * CURRENCY_CLAIM_SOURCES 命中都要求币种词/符号紧贴数字,且数字后面不是 天/晚/人/days/nights/adults/stars 这类单位词;仍有少量误伤(见下面「已知误伤」)。
 *
 * **不加**裸 k 后缀那条:裸 "1.3k" / "10k followers" 绝不能挡住一条帖子。
 *
 * 已知没覆盖(有意为之,别当 bug):
 *   · 中文数字(三千九百元)
 *   · 符号在数字后(4999$、10 US$)
 *   · 币种后带冒号或括号(NZD: 4999、Price (NZD): 4,999)
 *   · 4999 NZ dollars / yuan / 3999块
 *   · € £ EUR GBP HKD SGD
 *   · CNY 3999(CNY 故意不收,见文件头)
 *   · 全角数字(３９９９元、＄４５０)
 *   · NZD 4 999(千分位用空格,只识别到 NZD 4)
 *   · 无币种的裸 k(从 1.3k 起)
 *   · 数值落在 1900–2099 的裸价(from 2050 会被当年份放过)
 *
 * 已知误伤(有意保留,别当 bug):
 *   · 币种码紧贴年份(#NZD2027、2027 NZD rates)会命中;域名/账号里夹币种码加数字(nzd5.com、rmb88)也会命中
 *   · 旧的 AUD 源(\baud\b\s*\d)允许跨行配对,"All prices in AUD↵7 day tour" 仍命中 —— 为保证超集不能改旧源
 *   · 币种在数字前、后面跟 free/per 等词时仍算价格("NZD 99 free cancellation" 命中,有意)
 *   · "纽币"之外的口语说法(澳刀/美刀已收;块、毛 没收)
 *   · "only 500 fans"、"from 300 meters" 这类 3 位数 + 非列表单位的说法会命中
 *
 * 带 `g` 标志,只允许用 `String.prototype.match` 调用 —— `RegExp.test` 会推进
 * `lastIndex`,跨模块共用同一个实例时会出现「隔次返回 false」的幽灵 bug。
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
    // —— 2026-10-05 补强:币种写法 ——
    ...CURRENCY_CLAIM_SOURCES,
    // —— 2026-10-08 补强:无币种符号的旅游报价 ——
    ...PRICE_UNIT_CLAIM_SOURCES,
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
