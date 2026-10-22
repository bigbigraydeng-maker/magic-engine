/**
 * 把「名字就是邮箱 / 电话 / 占位词」的联系人，名字清成 NULL（显示成「未留姓名」）。
 * 设计稿：docs/specs/2026-10-22-crm-contact-profile-design-v0.md §8（PR-1 上线之后才能跑，
 * 否则邮件同步会把邮箱名字再写回去）。
 *
 * 三种用法（默认只读）：
 *   node --env-file=… tsx scripts/crm-clean-email-names.ts --client <id>                      只读：列出会被清的人
 *   node --env-file=… tsx scripts/crm-clean-email-names.ts --client <id> --apply --backup f.json   写库：先把「id + 原名 + 原 updated_at」存进 f.json，再清
 *   node --env-file=… tsx scripts/crm-clean-email-names.ts --client <id> --restore f.json     还原：只还原「现在仍是 NULL」的行（别人之后改过名字的不动），并恢复 updated_at
 *
 * 安全：按 id + client_id 收口。名字是邮箱、但这个人名下**没有任何联系方式**的（CTS 有 10 个，2026-09-26 导入时把邮箱填进了名字栏），
 * 不是直接清掉——那样就彻底认不出他是谁——而是先把这个邮箱**挪进邮箱栏和身份表**（`救回`），再清名字；
 * 若这个邮箱已经是别的联系人的身份（说明是重复联系人），则不动、单独列出交给人判断（合并另有设计）。
 * 名字是电话 / 占位词、又没有任何联系方式的，也不动。
 */

import fs from 'node:fs'
import { supabaseAdmin as sb } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { cleanDisplayName } from '@/lib/crm/clean-display-name'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

interface Row {
  id: string
  display_name: string | null
  primary_email: string | null
  primary_phone: string | null
  updated_at: string
}
interface BackupRow {
  id: string
  display_name: string
  updated_at: string
}

async function main(): Promise<void> {
  const clientId = arg('client') ?? CTS

  const restoreFile = arg('restore')
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf-8')) as BackupRow[]
    let restored = 0
    for (const b of backup) {
      const { data, error } = await sb
        .from('contacts')
        .update({ display_name: b.display_name, updated_at: b.updated_at })
        .eq('id', b.id)
        .eq('client_id', clientId)
        .is('display_name', null)
        .select('id')
      if (error) throw new Error(`还原 ${b.id} 失败: ${error.message}`)
      if ((data ?? []).length > 0) restored++
    }
    console.log(`还原完成：备份 ${backup.length} 行，实际还原 ${restored} 行（其余是之后被人改过名字，没动）。`)
    return
  }

  const rows = await fetchAll<Row>((f, t) =>
    sb.from('contacts').select('id, display_name, primary_email, primary_phone, updated_at').eq('client_id', clientId).not('display_name', 'is', null).order('id').range(f, t),
  )
  const dirty = rows.filter((r) => (r.display_name ?? '').trim() !== '' && cleanDisplayName(r.display_name) === null)
  const identities = await fetchAll<{ contact_id: string }>((f, t) =>
    sb.from('contact_identities').select('contact_id').eq('client_id', clientId).order('id').range(f, t),
  )
  const hasIdentity = new Set(identities.map((i) => i.contact_id))
  const safe = dirty.filter((r) => r.primary_email || r.primary_phone || hasIdentity.has(r.id))
  const noContact = dirty.filter((r) => !safe.includes(r))
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
  const emailIdentities = await fetchAll<{ value: string }>((f, t) =>
    sb.from('contact_identities').select('value').eq('client_id', clientId).eq('kind', 'email').order('id').range(f, t),
  )
  const takenEmails = new Set(emailIdentities.map((i) => i.value))
  // 救回：名字整串是邮箱、没有任何联系方式、且这个邮箱没被别人占用 → 挪进邮箱栏
  const rescue = noContact.filter((r) => EMAIL_RE.test((r.display_name ?? '').trim()) && !takenEmails.has((r.display_name ?? '').trim().toLowerCase()))
  const unsafe = noContact.filter((r) => !rescue.includes(r))

  console.log(`${flag('apply') ? '【写库】' : '【只读】'}名字需要清掉的联系人：${dirty.length} 个（其中有可联系方式、可以直接清的 ${safe.length} 个；邮箱只写在名字栏、先挪进邮箱栏再清的 ${rescue.length} 个；不动的 ${unsafe.length} 个）`)
  for (const r of safe.slice(0, 60)) console.log(`  ${r.id.slice(0, 8)}…  ${r.display_name}  →  (清空)`)
  for (const r of rescue) console.log(`  救回 ${r.id.slice(0, 8)}…  ${r.display_name}  →  邮箱栏 + 清空名字`)
  for (const r of unsafe) console.log(`  ⚠️ 不动：${r.id.slice(0, 8)}…  ${r.display_name}（没有联系方式，且邮箱已被别的联系人占用或不是邮箱——请人判断）`)

  if (!flag('apply')) return
  const backupFile = arg('backup')
  if (!backupFile) throw new Error('写库必须带 --backup <文件>：先备份再改')
  const toClean = [...safe, ...rescue]
  const backup: BackupRow[] = toClean.map((r) => ({ id: r.id, display_name: r.display_name as string, updated_at: r.updated_at }))
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1))
  console.log(`备份已写入 ${backupFile}（${backup.length} 行）`)
  let done = 0
  for (const r of rescue) {
    const email = (r.display_name as string).trim().toLowerCase()
    const { error: iErr } = await sb.from('contact_identities').upsert({ contact_id: r.id, client_id: clientId, kind: 'email', value: email, first_source: 'name_rescue' }, { onConflict: 'client_id,kind,value', ignoreDuplicates: true })
    if (iErr) throw new Error(`为 ${r.id} 补邮箱身份失败: ${iErr.message}`)
    const { error: pErr } = await sb.from('contacts').update({ primary_email: email }).eq('id', r.id).eq('client_id', clientId).is('primary_email', null)
    if (pErr) throw new Error(`为 ${r.id} 写主邮箱失败: ${pErr.message}`)
  }
  for (const r of toClean) {
    const { error } = await sb.from('contacts').update({ display_name: null }).eq('id', r.id).eq('client_id', clientId).eq('display_name', r.display_name as string)
    if (error) throw new Error(`清 ${r.id} 失败: ${error.message}`)
    done++
  }
  console.log(`已清空 ${done} 行。`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
