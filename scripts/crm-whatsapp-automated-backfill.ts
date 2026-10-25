/**
 * 把「最后一条出站是机器发的」的 WhatsApp 会话，对应那一行 CRM 触点补标 `metadata.automated = true`。
 * （2026-10-22：WhatsApp 的自动安抚 / AI 起草经人批准发出的回复，之前没有标机器，CRM 把它们算成「已跟进」，
 *  昨天今天的咨询因此掉出「今天要联系」。新发出去的已经由 `lib/whatsapp/send.ts` 标上了，这里只补历史。）
 *
 * 默认**只读**：列出会被改的触点和改完之后的名单变化。加 `--apply` 才写库（只更新那一行触点的 metadata，
 * 合并写入、不覆盖别的键；不碰消息、不外发）。
 *
 *   node --env-file=… tsx scripts/crm-whatsapp-automated-backfill.ts [--client <id>] [--apply]
 */

import { supabaseAdmin as sb } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { isAutomatedActor } from '@/lib/crm/actors'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const clientId = arg('client') ?? CTS
  const apply = process.argv.includes('--apply')
  const convs = await fetchAll<{ id: string; contact_id: string | null; conversation_id: string }>((f, t) =>
    sb.from('conversations').select('id, contact_id, conversation_id').eq('client_id', clientId).eq('channel', 'whatsapp').order('id').range(f, t),
  )
  const targets: Array<{ touchId: string; convId: string; metadata: Record<string, unknown>; lastOutAt: string }> = []
  for (const c of convs) {
    const { data: out } = await sb.from('conversation_messages').select('sender_name, sent_at').eq('conversation_id', c.id).eq('direction', 'outbound').order('sent_at', { ascending: false }).limit(1)
    const last = (out as Array<{ sender_name: string | null; sent_at: string }> | null)?.[0]
    if (!last || !isAutomatedActor(last.sender_name)) continue
    const { data: tp } = await sb.from('contact_touchpoints').select('id, metadata').eq('client_id', clientId).eq('source', 'whatsapp').eq('source_ref', `${c.id}:out`).maybeSingle()
    const row = tp as { id: string; metadata: Record<string, unknown> | null } | null
    if (!row || row.metadata?.automated === true) continue
    targets.push({ touchId: row.id, convId: c.id, metadata: row.metadata ?? {}, lastOutAt: last.sent_at })
  }
  console.log(`${apply ? '【写库】' : '【只读】'}会被补标 automated 的 WhatsApp 触点：${targets.length} 行`)
  for (const t of targets) console.log(`  触点 ${t.touchId.slice(0, 8)}…  会话 ${t.convId.slice(0, 8)}…  最后一条机器回复 ${t.lastOutAt}`)
  if (!apply) return
  for (const t of targets) {
    const { error } = await sb.from('contact_touchpoints').update({ metadata: { ...t.metadata, automated: true } }).eq('id', t.touchId)
    if (error) throw new Error(`更新触点 ${t.touchId} 失败: ${error.message}`)
  }
  console.log('已写入。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
