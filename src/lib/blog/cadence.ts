/**
 * 出稿节奏 —— 「一周一篇」这个总量约束的唯一定义处。
 *
 * 单独一个文件（而不是留在 weekly-blog.ts 里）是为了让 DAPE 的自动执行循环
 * 能引用这个数字，而不用把整条博客生成链（AI SDK、题目选择、站内审计）
 * 拖进它的依赖图。
 *
 * 🔴 一周一篇是**总量**，人跑的和机器跑的都算在内。两条路径共用这一个数字，
 *    各写各的会变成一周两篇 —— 而客户看到的只是「怎么突然开始灌水」。
 */

/** 这么多天内已经有非失败的文章 → 这周不再写。 */
export const WEEKLY_COOLDOWN_DAYS = 6

/** 冷却窗口的起点。传 now 便于测试，不在函数里自己取当前时间。 */
export function weeklyCooldownStart(now: Date = new Date()): Date {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() - WEEKLY_COOLDOWN_DAYS)
  return d
}
