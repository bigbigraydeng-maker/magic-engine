/**
 * 「存对话事实」的当场试跑 —— **干跑**：真的读库、真的问模型，但不抢占、不写任何东西。
 *
 * 为什么有它：这个任务要等迁移上线、开关打开之后才会自己跑；CLAUDE.md 要求「以后才会自动跑的
 * 东西，交付前必须当场手动触发一次完整链路」。迁移在 PM 点头合并之前不能 apply，所以只能干跑
 * （`dryRun: true` 保证没有任何写、没有 rpc 抢占）。
 *
 *   CRM_FACTS_MODEL=gpt-4o npx tsx --env-file=/path/.env.local scripts/probe-conversation-facts-dryrun.ts <对话id,对话id,...>
 *
 * 输出只有七个是 / 否，没有任何引文、理由、id 或客人信息。
 */
import { inferConversationFacts, readFactsConfig } from '@/lib/crm/facts/infer'
import { supabaseFactsIo } from '@/lib/crm/facts/io'

async function main(): Promise<void> {
  const ids = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    console.error('用法: probe-conversation-facts-dryrun.ts <对话id,对话id,...>')
    process.exit(1)
  }
  const base = readFactsConfig()
  const res = await inferConversationFacts(new Date(), {
    io: supabaseFactsIo(),
    dryRun: true,
    onlyConversationIds: ids,
    config: { ...base, perRun: Math.min(ids.length, 20) },
  })
  console.log(JSON.stringify({ ...res, dryRun: undefined }))
  ;(res.dryRun ?? []).forEach((r, i) => {
    const f = r.facts
    console.log(
      `#${i + 1} 垃圾种类=${f.spam_kind} 给了具体货物=${f.customer_gave_specifics} 我们真人报价=${f.we_gave_price} 约了下一步=${f.next_step_arranged} 已下单=${f.ordered_or_paid} 我们做不了=${f.we_declined} 客人说不要=${f.customer_said_not_now}`,
    )
  })
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
