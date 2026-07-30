/**
 * 一次性回填：CTS 的 Facebook 即时表单 Sheet → ME 的 contacts / 触点。
 *
 * 这是历史存量的搬运，不是长期管道 —— 以后 Meta lead 应该直接进 ME。
 * 写成脚本而不是接口，是因为它只该跑一次（重跑安全，靠唯一约束幂等）。
 *
 * 每一行产生：
 *   1 个 contact（按电话+邮箱合并，同一个人交两次表单只算一个）
 *   1 条 inbound 触点  = 他填了表单
 *   1 条 outbound 触点 = 销售打电话的结果（只有写了跟进记录的才有）
 *
 * 用法：
 *   npx tsx scripts/import-cts-fb-leads.ts <csv路径> [--dry]
 */

import { readFileSync } from 'node:fs'

// 仓里没有 dotenv，其它脚本靠 `node --env-file` 或外部导出环境变量。
// 这里自己读 .env.local，少一个依赖。
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

/** CSV 里有带引号的逗号和换行（跟进记录里有），不能按行 split。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

async function main() {
  const csvPath = process.argv[2]
  const dry = process.argv.includes('--dry')
  if (!csvPath) {
    console.error('用法: npx tsx scripts/import-cts-fb-leads.ts <csv路径> [--dry]')
    process.exit(1)
  }

  const { resolveContact, buildIdentities } = await import('../src/lib/crm/identity')
  const { classifyNote } = await import('../src/lib/crm/note-parser')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  const hdr = rows[0]
  const col = (name: string) => hdr.indexOf(name)
  const iId = col('id')
  const iTime = col('created_time')
  const iName = col('full_name')
  const iEmail = col('email')
  const iPhone = col('phone_number')
  const iTour = col('which_tour_interests_you_most?')
  const iAd = col('ad_name')
  const iNote = col('员工跟进记录')

  const data = rows.slice(1).filter((r) => r.length > 5 && (r[iEmail] || r[iPhone]))
  console.log(`读到 ${data.length} 行`)

  const stats = {
    contactsCreated: 0, contactsMatched: 0, skippedNoIdentity: 0,
    formTouchpoints: 0, callTouchpoints: 0, doNotContact: 0,
    outcomes: {} as Record<string, number>,
  }

  for (const r of data) {
    const identities = buildIdentities({ phone: r[iPhone], email: r[iEmail], defaultCountry: 'NZ' })
    if (identities.length === 0) { stats.skippedNoIdentity++; continue }

    const submittedAt = new Date(r[iTime]).toISOString()
    const note = (r[iNote] ?? '').trim()
    const parsed = classifyNote(note)

    if (dry) {
      stats.outcomes[parsed.outcome] = (stats.outcomes[parsed.outcome] ?? 0) + 1
      if (parsed.do_not_contact) stats.doNotContact++
      continue
    }

    const { contactId, created } = await resolveContact({
      clientId: CTS_CLIENT_ID,
      identities,
      displayName: (r[iName] ?? '').trim() || null,
      source: 'meta_lead_form',
      seenAt: submittedAt,
    })
    created ? stats.contactsCreated++ : stats.contactsMatched++

    // 表单提交本身 —— 客户主动来的
    await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: CTS_CLIENT_ID,
        contact_id: contactId,
        channel: 'meta_lead_form',
        direction: 'inbound',
        occurred_at: submittedAt,
        summary: `填了 Facebook 表单${r[iTour] ? ` · ${r[iTour]}` : ''}`,
        raw: null,
        metadata: { tour_interest_raw: r[iTour] ?? null, ad_name: r[iAd] ?? null },
        source: 'meta_lead_form',
        source_ref: r[iId] || `${r[iEmail]}|${submittedAt}`,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    stats.formTouchpoints++

    // 销售打电话的结果
    if (note) {
      await supabaseAdmin.from('contact_touchpoints').upsert(
        {
          client_id: CTS_CLIENT_ID,
          contact_id: contactId,
          channel: 'phone',
          direction: 'outbound',
          // Sheet 没记通话时间，只能用表单时间做锚点。如实标出来，别假装精确。
          occurred_at: submittedAt,
          summary: note.slice(0, 200),
          raw: note,
          metadata: { outcome: parsed.outcome, imported_from: 'sheet_员工跟进记录', time_is_approximate: true },
          source: 'sheet_followup',
          source_ref: r[iId] || `${r[iEmail]}|note`,
        },
        { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
      )
      stats.callTouchpoints++
      stats.outcomes[parsed.outcome] = (stats.outcomes[parsed.outcome] ?? 0) + 1
    }

    // 客户明确说过别再联系 —— 立刻落到人身上，任何渠道都读得到
    if (parsed.do_not_contact) {
      await supabaseAdmin
        .from('contacts')
        .update({ do_not_contact: true, do_not_contact_reason: note.slice(0, 300) })
        .eq('id', contactId)
      stats.doNotContact++
    }
  }

  console.log(dry ? '\n=== 演练结果（未写库）===' : '\n=== 导入完成 ===')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((err) => { console.error(err); process.exit(1) })
