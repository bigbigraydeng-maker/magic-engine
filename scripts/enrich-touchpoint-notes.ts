/**
 * 富化：把已入库触点的原始文本，用 AI 抽成结构化字段。
 *
 * 导入时只跑了规则（outcome / 别再联系 / 坏号码 —— 这三件不能交给 AI）。
 * 这一遍补细微的部分：什么时候走、想去哪个团、被哪家抢了、约了几点回电。
 *
 * 「什么时候走」是这批数据里最值钱的一列：一个说「明年三月」的人，现在打
 * 一百个电话也没用，但明年二月找他成交率极高。没有这一列就只能对着 335 个
 * 人一视同仁地打。
 *
 * 只读 raw、只写 metadata，不动 outcome —— 规则的结论不许被 AI 覆盖。
 * 可重复跑：已经富化过的（metadata.enriched=true）跳过。
 *
 * 用法：npx tsx scripts/enrich-touchpoint-notes.ts [--limit N] [--redo]
 */

import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CONCURRENCY = 8

async function main() {
  const { parseNote } = await import('../src/lib/crm/note-parser')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 1000
  const redo = process.argv.includes('--redo')

  const { data: rows, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id, raw, metadata')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('channel', 'phone')
    .not('raw', 'is', null)
    .limit(limit)

  if (error) throw new Error(error.message)

  const todo = (rows ?? []).filter(
    (r) => redo || !(r.metadata as Record<string, unknown> | null)?.enriched,
  )
  console.log(`待富化 ${todo.length} 条（共 ${rows?.length ?? 0} 条通话记录）`)
  if (!process.env.OPENAI_API_KEY) {
    console.error('没有 OPENAI_API_KEY —— 富化需要它，规则部分导入时已经跑过了')
    process.exit(1)
  }

  let done = 0
  const found = { travel_window: 0, tour_interest: 0, competitor: 0, callback_at: 0 }

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (row) => {
        const raw = String(row.raw ?? '')
        const parsed = await parseNote(raw)
        const prev = (row.metadata ?? {}) as Record<string, unknown>

        if (parsed.travel_window) found.travel_window++
        if (parsed.tour_interest) found.tour_interest++
        if (parsed.competitor) found.competitor++
        if (parsed.callback_at) found.callback_at++

        await supabaseAdmin
          .from('contact_touchpoints')
          .update({
            // summary 换成 AI 写的人话；raw 原封不动留着能回查。
            summary: parsed.summary.slice(0, 200),
            metadata: {
              ...prev,
              enriched: true,
              travel_window: parsed.travel_window,
              tour_interest: parsed.tour_interest,
              competitor: parsed.competitor,
              callback_at: parsed.callback_at,
            },
          })
          .eq('id', row.id)
        done++
      }),
    )
    if (i % 40 === 0) console.log(`  …${done}/${todo.length}`)
  }

  console.log(`\n完成 ${done} 条`)
  console.log('抽到的字段:', JSON.stringify(found, null, 2))
}

main().catch((err) => { console.error(err); process.exit(1) })
