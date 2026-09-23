/**
 * Runner → 断电台账 的接线层。
 *
 * AI 可见度 tracker 有四个 runner（openai / gemini / perplexity / claude），
 * 每个的 catch 分支都需要：分类 → 判是否值得落库 → 节流 → 动态引入 supabase → 写入。
 * 把这套流程抽成一个函数，避免四个 runner 各自重复 15 行一模一样的样板代码 ——
 * 更重要的是，避免漏掉其中某一步（节流、吞错、动态 import 各自都有讲究）。
 *
 * 🔴 这不是「新建一套告警」—— 它调的就是 `outage-ledger.ts` / `provider-failure.ts`
 *    里已有的那套东西，只是把「从 runner catch 到那套东西」的接线公因式提了出来。
 *
 * OpenAI runner 不需要走这里：它用 `getOpenAIClient()` → `instrumentedFetch` ——
 * 在 fetch 层就已经接上了，比 catch 块更早。
 */

import type { ProviderFailureKind } from '@/lib/ai/provider-failure'
import {
  isRecordable,
  shouldWriteNow,
  recordProviderOutage,
  makeSupabaseOutageWriter,
} from '@/lib/ai/outage-ledger'

/**
 * Runner catch 块的公共后半段：拿到分类结果后，判是否值得落库 → 节流 → 写入。
 *
 * @param provider  写进 `provider_outages.provider` 的值（如 `google` / `perplexity`）
 * @param kind      `classifyXxxFailure` 的返回值
 * @param detail    供人看的错误摘要（截断到 500 字）
 *
 * 🔴 绝不向调用方抛 —— 跟 `openai-client.ts` 里 `inspectFailure` 的纪律一致：
 *    告警管道自己坏了不能反过来把业务调用也弄挂。
 */
export async function recordRunnerOutage(
  provider: string,
  kind: ProviderFailureKind,
  detail: string,
): Promise<void> {
  if (!isRecordable(kind)) return

  const now = new Date()
  if (!shouldWriteNow(provider, kind, now)) return

  try {
    // 🔴 动态引入 —— 跟 openai-client.ts 同一个理由：
    //    `@/lib/supabase` 在模块加载时就 createClient，缺 env 直接 throw。
    //    而 runner 文件被多个模块 import（含单测），顶层引进来会让那些单测在
    //    import 阶段就炸。见 CLAUDE.md §7。
    const { supabaseAdmin } = await import('@/lib/supabase')
    await recordProviderOutage(makeSupabaseOutageWriter(supabaseAdmin), {
      provider,
      reason: kind,
      detail: detail.slice(0, 500),
      now,
    })
  } catch (e) {
    // 吞掉，但不静默 —— 读的那一侧还有 `ai_alerting_broken` 待办兜底
    console.error(
      `[${provider}-runner] 记录断电事件时出错:`,
      e instanceof Error ? e.message : String(e),
    )
  }
}
