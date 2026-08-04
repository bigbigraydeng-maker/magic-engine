/**
 * 这一笔「我们发出的」到底是**人做的动作**，还是机器发的。
 *
 * 早上那一页只问一个问题：这个人今天有没有人跟过。答错的代价是不对称的 ——
 * 把机器发的算成人跟过，销售会看到一片灰卡、以为活做完了，而那些人其实
 * 一个电话都没接到。
 *
 * 已经踩过两次，形式不同、根子一样：
 *   2026-08-02  Mailchimp 群发是出站、没有任何互动标记，跟一通人工电话
 *               在数据上长得一模一样 —— 一封群发能把整块看板标成已跟进。
 *   2026-08-02  接邮箱时同一个坑换了件衣服：「Automatic reply / 我不在办公室」
 *               躺在已发送里，跟一封真回信长得一模一样。一个刚发来询价的
 *               热线索会因为收到自己触发的自动回执而在早上变灰。
 *
 * 所以判据有两条，来源不同、都必须认：
 *   · **按来源**  某些系统写出来的出站整类都是机器发的（群发工具）
 *   · **按标记**  写入方自己判定了这一笔是自动的（邮件同步标 automated）
 *
 * 机器发的那一笔**仍然留在时间线上**（客人确实收到了），只是不算「有人跟过他」。
 */

/**
 * 这些来源写出来的出站整类都是机器发的。
 *
 * 整类拉黑只用于「这个系统压根不产生人工动作」的来源。邮件不在这里 ——
 * info@ 的已发送里绝大多数是同事真的在回信，只有个别几封是自动回执，
 * 那种要靠下面的 `metadata.automated` 逐条标。
 */
const AUTOMATED_SOURCES = new Set(['mailchimp'])

/**
 * 这一笔是机器发的吗。
 *
 * @param source   contact_touchpoints.source
 * @param metadata contact_touchpoints.metadata（写入方可以在里面标 `automated: true`）
 */
export function isAutomatedTouch(
  source: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (AUTOMATED_SOURCES.has(source ?? '')) return true
  // 只认真正的 true。缺失 / null / 字符串 "false" 一律当「不是机器发的」——
  // 这个方向的误判只会让一张卡多留一天，反过来会把人埋掉。
  return metadata?.automated === true
}
