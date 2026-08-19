// 字幕关键词高亮 —— 只认「数字事实」，不认专有名词(那需要人工维护词表，容易漏/容易错)。
// 大瑞这条线的脚本几乎全是中文数字口语("五十个访问"/"一百零六条"/"百分之五")，
// 不是阿拉伯数字，规则必须认中文数字，纯用 \d 正则会一条都抓不到(2026-08-19 实查两条
// 真实脚本验证过，见 caption-highlight.test.ts)。

/** 中文数字字符集(不含"两"以外的量词，量词留在原色不高亮)。 */
const CN_NUM = '[零一二三四五六七八九十百千万亿两]'

// 三选一，按顺序匹配：
// ① 百分之 + 中文数字（"百分之五"整体高亮，含前缀）
// ② 中文数字连续段 + 可选的「多/几/来」（"五十""一百零六""六百多"），
//    但排除紧跟在「第」后面的——那是序数词("第一步")不是数据事实，不高亮
// ③ 阿拉伯数字/货币（"$9.51"/"106"），但两侧不能贴着字母——避免命中 "GA4" 里的 "4"
const HIGHLIGHT_RE = new RegExp(
  `(?:百分之${CN_NUM}+)` +
  `|(?:(?<!第)${CN_NUM}+[多几来]?)` +
  `|(?:(?<![A-Za-z0-9.])\\$?\\d[\\d,]*(?:\\.\\d+)?%?(?![A-Za-z]))`,
  'g',
)

export interface HighlightSpan {
  text: string
  highlight: boolean
}

/** 把一行字幕切成「高亮/不高亮」的片段序列，原样拼回去等于原文(不改一个字，只是分段)。 */
export function highlightSpans(text: string): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  let last = 0
  for (const m of text.matchAll(HIGHLIGHT_RE)) {
    // 单独一个"一"几乎总是语法用法("一条"/"一个"="a/an")，不是想强调的数字事实——
    // 真实脚本("一条不到十块钱")验证过，不排除会把"一条"的"一"也点亮，全是噪音。
    // "十"/"两"/"一百"这类不受影响，只挡"一"单字这一种。
    if (m[0] === '一') continue
    const start = m.index ?? 0
    if (start > last) spans.push({ text: text.slice(last, start), highlight: false })
    if (m[0]) spans.push({ text: m[0], highlight: true })
    last = start + m[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last), highlight: false })
  return spans.length ? spans : [{ text, highlight: false }]
}
