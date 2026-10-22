/**
 * 给「名字栏里只有邮箱」的联系人补上真名（PM 2026-10-22：不能清理，是要补充他们的信息）。
 * 证据来自他自己的往来：会话里的参与者名字、网站表单通知邮件的标题、邮件显示名（见 lib/crm/name-evidence）。
 *
 * 默认**只读**：列出每个人「现在名字栏 → 建议的真名 + 把握 + 证据」，以及找不到名字的人。
 *
 *   node --env-file=… tsx scripts/crm-fill-names-from-evidence.ts [--client <id>]
 *   node --env-file=… tsx scripts/crm-fill-names-from-evidence.ts --apply --backup f.json [--min high|medium|low]   写库
 *   node --env-file=… tsx scripts/crm-fill-names-from-evidence.ts --restore f.json                                  还原
 *
 * 写库做两件事（都只动名字栏是邮箱的行，按 id + client_id + 原名 收口）：
 *   1. 有建议名字且把握 ≥ --min（默认 medium）→ display_name 改成真名；
 *   2. 不管有没有名字，这个邮箱若不在他名下，补进邮箱栏 + 身份表（不丢联系方式）。邮箱被别的联系人占用 → 不动并列出。
 * 找不到真名的：**名字栏原样保留**（不清理），页面显示层已经把邮箱显示成「未留姓名」。
 * 先备份（id + 原名 + 原 updated_at）；备份文件已存在拒绝覆盖。还原只还原「名字现在仍等于我们写入的那个名字」的行。
 */

import fs from 'node:fs'
import { supabaseAdmin as sb } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { cleanDisplayName } from '@/lib/crm/clean-display-name'
import { proposeNameFromEvidence, type NameConfidence } from '@/lib/crm/name-evidence'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (n: string): boolean => process.argv.includes(`--${n}`)
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const RANK: Record<NameConfidence, number> = { high: 3, medium: 2, low: 1 }

interface Row { id: string; display_name: string | null; primary_email: string | null; primary_phone: string | null; updated_at: string }
interface BackupRow { id: string; old_name: string; new_name: string; updated_at: string }

async function main(): Promise<void> {
  const clientId = arg('client') ?? CTS

  const restoreFile = arg('restore')
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf-8')) as BackupRow[]
    let n = 0
    for (const b of backup) {
      const { data, error } = await sb.from('contacts').update({ display_name: b.old_name, updated_at: b.updated_at }).eq('id', b.id).eq('client_id', clientId).eq('display_name', b.new_name).select('id')
      if (error) throw new Error(`还原 ${b.id} 失败: ${error.message}`)
      if ((data ?? []).length > 0) n++
    }
    console.log(`还原完成：备份 ${backup.length} 行，实际还原 ${n} 行（其余是之后被人改过名字，没动）。邮箱栏里补进去的邮箱不撤销（留着无害）。`)
    return
  }

  const rows = await fetchAll<Row>((f, t) =>
    sb.from('contacts').select('id, display_name, primary_email, primary_phone, updated_at').eq('client_id', clientId).not('display_name', 'is', null).order('id').range(f, t),
  )
  const targets = rows.filter((r) => EMAIL_RE.test((r.display_name ?? '').trim()) && cleanDisplayName(r.display_name) === null)
  const identities = await fetchAll<{ contact_id: string; kind: string; value: string }>((f, t) =>
    sb.from('contact_identities').select('contact_id, kind, value').eq('client_id', clientId).eq('kind', 'email').order('id').range(f, t),
  )
  const emailOwner = new Map(identities.map((i) => [i.value, i.contact_id]))

  const plans: Array<{ row: Row; email: string; name: string | null; confidence: NameConfidence | null; evidence: string; needsEmail: boolean; emailConflict: boolean }> = []
  for (const r of targets) {
    const email = (r.display_name as string).trim().toLowerCase()
    const { data: convs } = await sb.from('conversations').select('id, participant_name, subject').eq('contact_id', r.id).eq('client_id', clientId)
    const cl = (convs as Array<{ id: string; participant_name: string | null; subject: string | null }> | null) ?? []
    const { data: msgs } = cl.length ? await sb.from('conversation_messages').select('sender_name').in('conversation_id', cl.map((c) => c.id)) : { data: [] }
    const proposal = proposeNameFromEvidence({
      participantNames: cl.map((c) => c.participant_name ?? '').filter(Boolean),
      subjects: cl.map((c) => c.subject ?? '').filter(Boolean),
      senderNames: ((msgs as Array<{ sender_name: string | null }> | null) ?? []).map((m) => m.sender_name ?? '').filter(Boolean),
      email,
    })
    const owner = emailOwner.get(email)
    const own = r.primary_email?.toLowerCase() === email || owner === r.id
    plans.push({ row: r, email, name: proposal?.name ?? null, confidence: proposal?.confidence ?? null, evidence: proposal?.evidence ?? '', needsEmail: !own && owner === undefined, emailConflict: !own && owner !== undefined })
  }

  const minRank = RANK[(arg('min') as NameConfidence | undefined) ?? 'medium']
  const willFill = plans.filter((p) => p.name && p.confidence && RANK[p.confidence] >= minRank)
  console.log(`${flag('apply') ? '【写库】' : '【只读】'}名字栏是邮箱的联系人 ${plans.length} 个：找到真名 ${plans.filter((p) => p.name).length} 个（把握够、会填 ${willFill.length} 个），没找到 ${plans.filter((p) => !p.name).length} 个（名字栏原样保留，不清理）`)
  for (const p of plans.filter((x) => x.name)) console.log(`  ${p.row.id.slice(0, 8)}…  ${p.email}  →  ${p.name}   [${p.confidence}]  ${p.evidence}`)
  console.log('— 没找到真名的 —')
  for (const p of plans.filter((x) => !x.name)) console.log(`  ${p.row.id.slice(0, 8)}…  ${p.email}`)
  console.log(`需要把邮箱补进邮箱栏 + 身份表的：${plans.filter((p) => p.needsEmail).length} 个；邮箱被别的联系人占用（不动）：${plans.filter((p) => p.emailConflict).length} 个`)

  if (!flag('apply')) return
  const backupFile = arg('backup')
  if (!backupFile) throw new Error('写库必须带 --backup <文件>：先备份再改')
  if (fs.existsSync(backupFile)) throw new Error(`备份文件 ${backupFile} 已存在，拒绝覆盖`)
  const backup: BackupRow[] = willFill.filter((p) => !p.emailConflict).map((p) => ({ id: p.row.id, old_name: p.row.display_name as string, new_name: p.name as string, updated_at: p.row.updated_at }))
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1))
  console.log(`备份已写入 ${backupFile}（${backup.length} 行）`)

  let filled = 0
  let emailed = 0
  for (const p of plans) {
    if (p.emailConflict) continue
    if (p.needsEmail) {
      const { error: iErr } = await sb.from('contact_identities').upsert({ contact_id: p.row.id, client_id: clientId, kind: 'email', value: p.email, first_source: 'name_evidence' }, { onConflict: 'client_id,kind,value', ignoreDuplicates: true })
      if (iErr) throw new Error(`为 ${p.row.id} 补邮箱身份失败: ${iErr.message}`)
      const { data: owner } = await sb.from('contact_identities').select('contact_id').eq('client_id', clientId).eq('kind', 'email').eq('value', p.email).maybeSingle()
      if ((owner as { contact_id: string } | null)?.contact_id !== p.row.id) { console.log(`  ⚠️ 跳过 ${p.row.id.slice(0, 8)}…  ${p.email}：邮箱刚被别的联系人占用`); continue }
      await sb.from('contacts').update({ primary_email: p.email }).eq('id', p.row.id).eq('client_id', clientId).is('primary_email', null)
      emailed++
    }
    if (willFill.includes(p) && p.name) {
      const { error } = await sb.from('contacts').update({ display_name: p.name }).eq('id', p.row.id).eq('client_id', clientId).eq('display_name', p.row.display_name as string)
      if (error) throw new Error(`为 ${p.row.id} 填名字失败: ${error.message}`)
      filled++
    }
  }
  console.log(`已填真名 ${filled} 个；补进邮箱栏 ${emailed} 个。`)
}

main().catch((e) => { console.error(e); process.exit(1) })
