/**
 * 工厂试跑 —— 下一单，看系统打算怎么拍，**不真的出片**（2026-08-03）。
 *
 * 为什么要有这个：出片的钱花在后台工人那一步，而「系统挑了哪几个真实镜头、
 * 还要新生成几个、按什么节奏剪」这些决定在下单那一刻就定了。先把这份方案
 * 拿出来给 PM 看，比直接烧钱做一条再讨论便宜得多。
 *
 * Usage:
 *   DRY_RUN_CLIENT_ID=<uuid> npx tsx --env-file=.env.local scripts/factory-dry-run.ts
 */

import { supabaseAdmin } from '@/lib/supabase'
import { evaluateSignal, nzDay } from '@/lib/factory/evaluate'

const clientId = process.env.DRY_RUN_CLIENT_ID
if (!clientId) {
  console.error('缺 DRY_RUN_CLIENT_ID')
  process.exit(1)
}

async function main() {
  const { data: client } = await supabaseAdmin
    .from('clients').select('name').eq('id', clientId!).single()
  console.log(`\n═══ 试跑：${client?.name ?? clientId}\n`)

  const { data: signal, error } = await supabaseAdmin
    .from('content_demand_signals')
    .insert({
      client_id: clientId,
      signal_type: 'new_campaign',
      source: 'factory-dry-run',
      dedupe_key: `dry-run:${clientId}:${nzDay(new Date())}`,
      evidence: {},
      request: { notes: '人工试跑（PM 2026-08-03 批准，上限 $2）' },
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = 今天已经下过一单,幂等挡住了
    console.error(error.code === '23505' ? '今天已经试跑过了（幂等挡住）' : error.message)
    process.exit(1)
  }

  const r = await evaluateSignal(signal.id)
  console.log('判定：', r.outcome, r.reject_reason ? `（${r.reject_reason}）` : '')

  if (!r.work_order_id) {
    console.log('\n没出工单 —— 上面那条理由就是原因。没有花任何钱。\n')
    return
  }

  const { data: wo } = await supabaseAdmin
    .from('content_work_orders').select('*').eq('id', r.work_order_id).single()

  const brief = (wo?.brief ?? {}) as Record<string, unknown>
  const segments = (brief.segments ?? []) as Array<Record<string, unknown>>
  // ⚠️ 出片计划在 brief.clip_generation_plan 里,不是工单表的列。
  //    首版按列名取,结果恒为空 → 报「0 条要生成」而实际有 2 条(会误导花钱判断)。
  const plan = (brief.clip_generation_plan ?? []) as Array<Record<string, unknown>>

  console.log(`\n工单 ${r.work_order_id}  状态 ${wo?.status}`)
  console.log(`爆款结构：${brief.viral_style_directive ?? '—'}`)
  console.log(`\n镜头方案（共 ${segments.length} 镜）：`)
  segments.forEach((s, i) => {
    const ids = (s.clip_ids ?? []) as unknown[]
    console.log(`  ${i + 1}. ${s.description ?? '?'}  ${s.duration_hint_s ?? '?'}s  ${ids.length ? '✅ 现成真实片段' : '⚠️ 要新生成'}`)
  })

  const copy = (brief.copy ?? {}) as Record<string, unknown>
  const endcard = (copy.endcard ?? {}) as Record<string, unknown>
  const offers = (endcard.offer ?? []) as string[]
  if (offers.length) {
    console.log('\n⚠️ 文案里承诺了这些 —— 客户真有这些服务吗？没有就是编的：')
    offers.forEach((o) => console.log(`   · ${o}`))
  }

  const cost = plan.length * 0.225
  console.log(`\n要新生成：${plan.length} 条  预估 $${cost.toFixed(2)}`)
  console.log(plan.length === 0
    ? '→ 全部用现成真实素材，这一单不花钱\n'
    : `→ 这 ${plan.length} 条由后台工人生成时才扣费\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
