/**
 * 一次性回填：把已存的 WhatsApp 点击广告 referral（conversations.entry_referral）
 * 补写成联系人 / 入站触点的来源归因（attr_*）。
 *
 * 只补空：contacts.attr_platform 已有值的不动（first-touch）；触点同理。
 * 默认预演，零写入；`--live` 才写，且必须带 `--receipt=<路径>`（逐条 JSONL 回执）。
 * 不自动运行，由 Ray 本人执行。不走 Inngest：操作者手动跑的一次性回填，
 * 脚本幂等（只补空），中断后原样重跑即可；替代回执 = JSONL 文件。
 *
 * 用法：
 *   npx tsx scripts/backfills/backfill-whatsapp-referral-attribution.ts --client-id=<uuid>
 *   npx tsx scripts/backfills/backfill-whatsapp-referral-attribution.ts --client-id=<uuid> --live --receipt=./wa-attr.jsonl
 */

import { appendFileSync, readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

async function main(): Promise<void> {
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { attributionColumns, attributionFromWhatsAppReferral, isAttributed } = await import(
    '../../src/lib/crm/attribution'
  )

  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const clientId = arg('client-id')
  const live = process.argv.includes('--live')
  const receipt = arg('receipt')
  if (!clientId) throw new Error('必须带 --client-id=<uuid>')
  if (live && !receipt) throw new Error('--live 必须带 --receipt=<路径>')

  if (live && receipt) {
    const { writeStartReceipt } = await import('../../src/lib/crm/backfill-receipt')
    writeStartReceipt(receipt, { client_id: clientId, live })
  }

  const { data: convos, error } = await supabaseAdmin
    .from('conversations')
    .select('id, conversation_id, contact_id, entry_referral')
    .eq('client_id', clientId)
    .eq('channel', 'whatsapp')
    .not('entry_referral', 'is', null)
    .not('contact_id', 'is', null)
  if (error) throw new Error(error.message)

  let planned = 0
  for (const c of convos ?? []) {
    const attribution = attributionFromWhatsAppReferral(c.entry_referral)
    if (!isAttributed(attribution)) continue
    planned++
    const cols = attributionColumns(attribution)
    const log = (what: string, extra: Record<string, unknown> = {}) => {
      const row = { at: new Date().toISOString(), client_id: clientId, source_ref: c.id, contact_id: c.contact_id, what, live, ...extra }
      console.log(JSON.stringify(row))
      if (live && receipt) appendFileSync(receipt, `${JSON.stringify(row)}\n`)
    }
    if (!live) {
      log('would_backfill', { attr: cols })
      continue
    }
    // 只补空：条件在 SQL 里。
    const { error: cErr } = await supabaseAdmin
      .from('contacts')
      .update({ ...cols, first_attributed_at: new Date().toISOString() })
      .eq('id', c.contact_id)
      .eq('client_id', clientId)
      .is('attr_platform', null)
    const { error: tErr } = await supabaseAdmin
      .from('contact_touchpoints')
      .update(cols)
      .eq('client_id', clientId)
      .eq('source', 'whatsapp')
      .eq('source_ref', `${c.id}:in`)
      .is('attr_platform', null)
    log('backfilled', { contact_error: cErr?.message ?? null, touchpoint_error: tErr?.message ?? null })
  }
  console.log(`${live ? '已写入' : '预演'}：${planned} 个带广告来源的会话`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
