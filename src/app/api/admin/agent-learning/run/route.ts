/**
 * POST /api/admin/agent-learning/run
 *
 * 管理员手动触发一次专家学习（名册 RSS → DeepSeek 提炼 → 脱敏 → 未启用候选经验）。
 * - `dryRun` 默认开：只有 body 明确写 `"dryRun": false` 才写库。
 * - 单次运行 0.20 美元硬上限（内存账本，不跨运行累计）；不登记 cron、不碰 Inngest。
 * - 写进去的都是 is_active=false，Ray 在广告引擎页逐条点开才算采纳。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { createFetchText } from '@/lib/agent-learning/collect/feeds'
import { createDeepSeekClient } from '@/lib/agent-learning/llm/deepseek-client'
import {
  DEFAULT_PER_SOURCE,
  runExpertLearning,
} from '@/lib/agent-learning/run-expert-learning'
import { checkShareable } from '@/lib/memory/lesson-shareability'
import { loadShareabilityContext, writeGlobalLesson } from '@/lib/memory/write-lesson'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // 没有 body 也行：全部走默认（dryRun）
  }
  const dryRun = body.dryRun !== false
  const perSource = typeof body.perSource === 'number' ? body.perSource : DEFAULT_PER_SOURCE

  // 客户端必须在 handler 内创建，不在模块顶层
  const client = createDeepSeekClient()
  if (!client.ok) {
    return NextResponse.json({ success: false, error: client.error }, { status: 500 })
  }

  const shareCtx = await loadShareabilityContext(supabaseAdmin)

  const summary = await runExpertLearning(
    {
      fetchText: createFetchText(),
      llm: client.value,
      ledger: createFakeLedger(),
      now: () => new Date(),
      existingKeys: async (keys) => {
        if (keys.length === 0) return []
        const { data, error } = await supabaseAdmin
          .from('global_learned_lessons')
          .select('lesson_key')
          .in('lesson_key', keys)
        // 查不出来就不能写：写错会把已启用的经验改回未启用
        if (error) throw new Error(`existing_keys_failed:${error.message}`)
        return ((data ?? []) as { lesson_key: string }[]).map((r) => r.lesson_key)
      },
      checkShareable: async (lesson, rationale) => checkShareable(lesson, rationale, shareCtx),
      writeLesson: (input) => writeGlobalLesson(supabaseAdmin, input),
    },
    { dryRun, perSource },
  )

  return NextResponse.json({ success: true, ...summary })
}
