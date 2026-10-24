/**
 * Smart auto-ack DRY RUN — read-only (SELECT + real model calls, sends NOTHING, writes NOTHING to the DB).
 * Design: docs/specs/2026-10-22-smart-ack-design-v0.md §9.9
 *
 * Takes each recent conversation's FIRST inbound message, runs the same composer F1 uses (flag forced on),
 * and writes "customer text -> chosen ack -> source/reason" to a LOCAL file (customer text is private:
 * the console only prints counts; delete the file after review).
 *
 *   node --env-file=/path/.env.local node_modules/tsx/dist/cli.mjs scripts/smart-ack-dryrun.ts \
 *     --client <clientId> [--limit 30] [--days 30] --out /path/report.md
 */
import fs from 'node:fs'
import { supabaseAdmin as sb } from '@/lib/supabase'
import { composeAck } from '@/lib/messenger/smart-ack/compose'
import { callSmartAckModel } from '@/lib/messenger/smart-ack/model'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function mask(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s\-()]{6,}\d/g, '[phone]')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
}

async function main(): Promise<void> {
  const clientId = arg('client')
  const out = arg('out')
  if (!clientId || !out) throw new Error('usage: --client <id> --out <file> [--limit N] [--days N]')
  const limit = Number(arg('limit') ?? 30)
  const since = new Date(Date.now() - Number(arg('days') ?? 30) * 86_400_000).toISOString()

  const { data: convos, error } = await sb
    .from('conversations')
    .select('id, channel, created_at')
    .eq('client_id', clientId)
    .in('channel', ['whatsapp', 'messenger'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit * 3)
  if (error) throw new Error(error.message)

  const lines: string[] = ['# smart-ack dry run (local only — delete after review)\n']
  const tally = new Map<string, number>()
  let done = 0
  for (const c of convos ?? []) {
    if (done >= limit) break
    const { data: first } = await sb
      .from('conversation_messages')
      .select('body')
      .eq('conversation_id', c.id)
      .eq('direction', 'inbound')
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const text = (first?.body ?? '').trim()
    if (!text) continue
    done++
    let rawModel: string | null = null
    const plan = await composeAck({
      readEnabled: async () => ({ enabled: true, dailyCap: 1_000_000 }),
      loadContext: async () => ({ recentInbound: [text], currentText: text, repliedEarlierInbound: [], lastOutbound: null }),
      smartSentToday: async () => 0,
      callModel: async (i) => {
        rawModel = await callSmartAckModel(i)
        return rawModel
      },
    })
    const key = plan.kind === 'skip' ? `skip:${plan.reason}` : `${plan.source}:${plan.reason}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
    const lost =
      rawModel !== null && plan.kind === 'send' && plan.source === 'fixed'
        ? `\n- 模型本来想说(被拦下): ${mask(String(rawModel))}`
        : ''
    lines.push(
      `## ${done}. ${c.channel}\n- 客人原话: ${mask(text)}\n- 结果: ${key}\n- 回复: ${plan.kind === 'skip' ? '(不发)' : plan.text}${lost}\n`,
    )
  }
  const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`)
  lines.unshift(`样本 ${done} 条；分布：${summary.join('，')}\n`)
  fs.writeFileSync(out, lines.join('\n'))
  console.log(`done=${done}`)
  for (const s of summary) console.log(s)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
