// 字幕关键词高亮 —— 只认「数字事实」，不认专有名词(那需要人工维护词表，容易漏/容易错)。
//
// 框架(切分 spans、原文可拼回)跟语言无关，是共享层；「什么算数字」按检测到的语言换规则——
// 大瑞这条线的脚本几乎全是中文数字口语("五十个访问"/"一百零六条"/"百分之五")，纯 \d 正则
// 一条都抓不到(2026-08-19 实查两条真实脚本验证过，见 caption-highlight.test.ts)。但
// reel-render.ts 的听写现在会自动识别语种(av-utils.ts)，不再只服务中文客户，所以数字规则
// 不能继续焊死成中文特例——按 language 选规则，未来新语言只需要在 NUMBER_POLICIES 里加一条，
// 不用碰这个文件的切分逻辑。
//
// 现在只做到「按语言选规则」，还没做到「按客户配置切换」(CLAUDE.md 的 Policy 层)——同一语言
// 目前只有一套写死的规则，没有 override 机制。真出现同语言不同客户要不同规则的需求再加，
// 现在加是没有调用方的抽象。

export interface HighlightSpan {
  text: string
  highlight: boolean
}

interface NumberHighlightPolicy {
  pattern: RegExp
  /** 命中后逐个过滤，返回 true 表示这次命中不该高亮(语法用法，不是数据事实)。 */
  shouldSkip?: (match: string) => boolean
}

/** 阿拉伯数字/货币 —— 跟语言无关，两侧不能贴着字母(避免命中 "GA4" 里的 "4")。 */
const DIGIT_CURRENCY_SRC = '(?:(?<![A-Za-z0-9.])\\$?\\d[\\d,]*(?:\\.\\d+)?%?(?![A-Za-z]))'

/** 中文数字字符集(不含"两"以外的量词，量词留在原色不高亮)。 */
const CN_NUM = '[零一二三四五六七八九十百千万亿两]'

// 三选一，按顺序匹配：
// ① 百分之 + 中文数字（"百分之五"整体高亮，含前缀）
// ② 中文数字连续段 + 可选的「多/几/来」（"五十""一百零六""六百多"），
//    但排除紧跟在「第」后面的——那是序数词("第一步")不是数据事实，不高亮
// ③ 阿拉伯数字/货币，跟语言无关的共享规则
const ZH_NUMBER_POLICY: NumberHighlightPolicy = {
  pattern: new RegExp(
    `(?:百分之${CN_NUM}+)` +
    `|(?:(?<!第)${CN_NUM}+[多几来]?)` +
    `|${DIGIT_CURRENCY_SRC}`,
    'g',
  ),
  // 单独一个"一"几乎总是语法用法("一条"/"一个"="a/an")，不是想强调的数字事实——
  // 真实脚本("一条不到十块钱")验证过，不排除会把"一条"的"一"也点亮，全是噪音。
  // "十"/"两"/"一百"这类不受影响，只挡"一"单字这一种。英语没有这个语法坑
  // (不存在"one"当量词前缀的用法)，所以这条排除规则是中文独有的，不下放到共享层。
  shouldSkip: (m) => m === '一',
}

// 英语基数词(0-99) + 百/千/百万/十亿量级 + percent。跟中文同样的设计:数字词整体连成一个
// 高亮块("twenty three"/"a hundred and six")，不逐词拆开。
const EN_UNIT =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
  'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen'
const EN_TEN = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety'
const EN_SCALE = 'hundred|thousand|million|billion'
// "fifty"/"fifty-two"/"fifty two"
const EN_TEN_UNIT = `(?:(?:${EN_TEN})(?:[-\\s](?:${EN_UNIT}))?)`
// 0-99 的词形："fifty"或"fifty-two"，或单个基数词"six"
const EN_BASIC = `(?:${EN_TEN_UNIT}|(?:${EN_UNIT}))`
// "a hundred"/"one hundred"/"a hundred and six"——量级前必须有基数词或 a/an 打头，
// 光一个"hundred"不算(避免命中"Hundred Islands"这类专有名词)
const EN_SCALED = `(?:(?:a|an|${EN_BASIC})\\s+(?:${EN_SCALE})(?:\\s+(?:and\\s+)?${EN_BASIC})?)`
const EN_CORE = `(?:${EN_SCALED}|${EN_BASIC})`
const EN_NUMBER_POLICY: NumberHighlightPolicy = {
  pattern: new RegExp(
    `\\b${EN_CORE}(?:\\s+percent)?\\b` +
    `|${DIGIT_CURRENCY_SRC}`,
    'gi',
  ),
}

/** 语言未适配(或听写没给出语种)时的兜底——只认语言无关的阿拉伯数字/货币，不猜文字形式数字。 */
const DEFAULT_NUMBER_POLICY: NumberHighlightPolicy = {
  pattern: new RegExp(DIGIT_CURRENCY_SRC, 'g'),
}

const NUMBER_POLICIES: Record<string, NumberHighlightPolicy> = {
  zh: ZH_NUMBER_POLICY,
  en: EN_NUMBER_POLICY,
}

function resolvePolicy(language: string): NumberHighlightPolicy {
  return NUMBER_POLICIES[language.trim().toLowerCase()] ?? DEFAULT_NUMBER_POLICY
}

/**
 * 把一行字幕切成「高亮/不高亮」的片段序列，原样拼回去等于原文(不改一个字，只是分段)。
 * language 用 ISO-639-1 代码('zh'/'en')，调用方(reel-render.ts)从 Whisper 听写结果里的
 * 检测语种传入；没有对应规则的语种走 DEFAULT_NUMBER_POLICY，不报错、不误判成中文/英语。
 */
export function highlightSpans(text: string, language: string): HighlightSpan[] {
  const policy = resolvePolicy(language)
  const spans: HighlightSpan[] = []
  let last = 0
  for (const m of text.matchAll(policy.pattern)) {
    if (policy.shouldSkip?.(m[0])) continue
    const start = m.index ?? 0
    if (start > last) spans.push({ text: text.slice(last, start), highlight: false })
    if (m[0]) spans.push({ text: m[0], highlight: true })
    last = start + m[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last), highlight: false })
  return spans.length ? spans : [{ text, highlight: false }]
}
