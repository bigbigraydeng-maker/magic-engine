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
 * 来源归因（2026-07-30 补）：Meta 的 lead 导出带广告层级的列，之前只读了 ad_name、
 * 而且只塞进触点 metadata，contacts 上一个来源字段都没有 —— 于是「这个人成交了」
 * 看得到、「他是哪条广告带来的」看不到。现在 ad_id / adset_id / campaign_id / ad_name
 * 会同时写进 contacts（first-touch）和触点。
 *
 * 表头可能没有那几列（CTS 那份存量导出只有 ad_name），缺就是 null，不假装（见
 * src/lib/crm/attribution.ts 头部的「实测能拿到什么」）。
 *
 * 用法：
 *   npx tsx scripts/import-cts-fb-leads.ts <csv路径> [--dry] [--listing <listings.id>]
 *
 *   --listing  这批 lead 是某套房的广告带来的时候传（地产客户）。不传就不挂房子。
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
  const listingIdx = process.argv.indexOf('--listing')
  const listingId = listingIdx > -1 ? process.argv[listingIdx + 1] ?? null : null
  if (!csvPath) {
    console.error(
      '用法: npx tsx scripts/import-cts-fb-leads.ts <csv路径> [--dry] [--listing <listings.id>]',
    )
    process.exit(1)
  }

  const { resolveContact, buildIdentities } = await import('../src/lib/crm/identity')
  const { classifyNote } = await import('../src/lib/crm/note-parser')
  const { attributionFromMetaLeadRow, attributionColumns } = await import(
    '../src/lib/crm/attribution'
  )
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
  // 广告层级列。CTS 那份存量导出没有它们（col() 返回 -1），新导出才有 —— 缺就是 null。
  const iAdId = col('ad_id')
  const iAdsetId = col('adset_id')
  const iCampaignId = col('campaign_id')

  /** 表头里没有这一列 / 值为空 → null。绝不猜。 */
  const cell = (row: string[], idx: number): string | null =>
    idx > -1 ? row[idx]?.trim() || null : null

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

    // 「他是哪条广告带来的」。这一行来自 Meta lead 导出 → platform 一定是 'meta'
    // （事实，不是猜的）；ad/adset/campaign id 有就写、没有就 null。
    const attribution = attributionFromMetaLeadRow({
      ad_id: cell(r, iAdId),
      ad_name: cell(r, iAd),
      adset_id: cell(r, iAdsetId),
      campaign_id: cell(r, iCampaignId),
      // creative id：Meta 的 lead 导出不给，只能由 ME 出片管道回填 → 这里一律 null。
      creative_ref: null,
    })

    const { contactId, created } = await resolveContact({
      clientId: CTS_CLIENT_ID,
      identities,
      displayName: (r[iName] ?? '').trim() || null,
      source: 'meta_lead_form',
      seenAt: submittedAt,
      attribution,
      listingId,
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
        metadata: { tour_interest_raw: r[iTour] ?? null, ad_name: cell(r, iAd) },
        // 触点也存一份归因：同一个人可能被两条不同的广告分别捞到过，只存
        // contacts 上那份 first-touch 会让第二条广告的贡献永远看不见。
        ...attributionColumns(attribution),
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
