/**
 * 子句级否定窗口检测 —— 「命中点所在的这一句里有没有否定词」。
 *
 * 从 `qualified-buyer.ts` 抽出来复用：地产「想看房」判定和 NAL 私信「真商机」
 * 判定都需要同一件事——纯子串匹配会把「我**不想**看房」「not interested in
 * a viewing」这类明确拒绝也当成正例命中。算法（找最近的分句符、只看那之后
 * 那一小段）两边完全一样，不同的只是各自的否定词表，所以只抽共用的这一半，
 * 词表留在各自调用方（地产的「不/没/别」跟物流的「not interested/cancelled」
 * 没有交集，硬合成一张表只会让改一边的词表意外影响另一边）。
 */

/**
 * 分句符。否定只在**同一个子句内**生效——固定长度的窗口两头不讨好：
 * 英文「not interested in a viewing」隔了 15 个字符，窗口小了漏；
 * 中文「这周不想看房，下周想约看房」窗口大了又会让前半句的「不」
 * 把后半句真实的意向也一起否掉。
 */
export const CLAUSE_BREAKS = /[，,。.；;！!？?\n、]/

/** 命中点所在的那个子句里有没有 `markers` 里的否定词。 */
export function isNegated(haystack: string, hitIndex: number, markers: readonly string[]): boolean {
  const before = haystack.slice(0, hitIndex)
  // 往前找最近的分句符，只看它之后那一段。
  let start = 0
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLAUSE_BREAKS.test(before[i])) {
      start = i + 1
      break
    }
  }
  const clause = before.slice(start)
  return markers.some((marker) => clause.includes(marker))
}
