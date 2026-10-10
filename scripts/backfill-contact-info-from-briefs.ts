/**
 * 把「客人在对话里自己留过、但没写进档案」的电话/邮箱补进 contacts。
 *
 * 默认只读（dry-run）：只打印打码后的清单。加 --apply 才写库。
 * 规则：只补档案里本来是空的那一栏；号码/邮箱已属于别的人 → 跳过并计数（绝不合并两个人）；
 * 认不出格式 → 跳过（normalisePhone/normaliseEmail 返回 null）。
 *
 *   npx tsx --env-file=/path/.env.local scripts/backfill-contact-info-from-briefs.ts <clientId> [--apply]
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { normaliseEmail, normalisePhone } from '@/lib/crm/identity'

interface Conv { id: string; contact_id: string | null }
interface Brief { conversation_id: string; contact: { phone?: string | null; email?: string | null } | null; generated_at: string | null }
interface ContactRow { id: string; primary_phone: string | null; primary_email: string | null }

// 假邮箱和我们自己的邮箱不是客人的联系方式
const NOT_A_CUSTOMER = /@(example\.(com|org|net)|nalexpress\.com)$/i

const maskPhone = (p: string) => `${p.slice(0, 3)}***${p.slice(-2)}`
const maskEmail = (e: string) => `${e.slice(0, 1)}***@${e.split('@')[1] ?? ''}`

async function main() {
  const clientId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!clientId) throw new Error('clientId required')

  const convs = await fetchAll<Conv>((from, to) =>
    supabaseAdmin.from('conversations').select('id, contact_id').eq('client_id', clientId).range(from, to))
  const briefs = await fetchAll<Brief>((from, to) =>
    supabaseAdmin.from('conversation_briefs').select('conversation_id, contact, generated_at').eq('client_id', clientId).range(from, to))
  const contacts = await fetchAll<ContactRow>((from, to) =>
    supabaseAdmin.from('contacts').select('id, primary_phone, primary_email').eq('client_id', clientId).range(from, to))
  const idents = await fetchAll<{ kind: string; value: string }>((from, to) =>
    supabaseAdmin.from('contact_identities').select('kind, value').eq('client_id', clientId).range(from, to))

  const contactOf = new Map(convs.map((c) => [c.id, c.contact_id]))
  const byId = new Map(contacts.map((c) => [c.id, c]))
  const taken = new Set(idents.map((i) => `${i.kind}:${i.value}`))
  const newest = new Map<string, Brief>()
  for (const b of briefs) {
    const cid = contactOf.get(b.conversation_id)
    if (!cid) continue
    const prev = newest.get(cid)
    if (!prev || (b.generated_at ?? '') > (prev.generated_at ?? '')) newest.set(cid, b)
  }

  const stats = { people: 0, phone: 0, email: 0, skippedTaken: 0, skippedBadFormat: 0, alreadyHad: 0 }
  const plans: Array<{ id: string; phone: string | null; email: string | null }> = []
  for (const [cid, b] of newest) {
    const row = byId.get(cid)
    if (!row) continue
    const rawPhone = b.contact?.phone ?? null
    const rawEmail = b.contact?.email ?? null
    let phone: string | null = null
    let email: string | null = null
    if (rawPhone && !row.primary_phone) {
      const n = normalisePhone(rawPhone)
      if (!n) stats.skippedBadFormat++
      else if (taken.has(`phone:${n}`)) stats.skippedTaken++
      else phone = n
    } else if (rawPhone) stats.alreadyHad++
    if (rawEmail && !row.primary_email) {
      const n = normaliseEmail(rawEmail)
      if (!n || NOT_A_CUSTOMER.test(n)) stats.skippedBadFormat++
      else if (taken.has(`email:${n}`)) stats.skippedTaken++
      else email = n
    } else if (rawEmail) stats.alreadyHad++
    if (phone || email) {
      plans.push({ id: cid, phone, email })
      if (phone) { stats.phone++; taken.add(`phone:${phone}`) }
      if (email) { stats.email++; taken.add(`email:${email}`) }
    }
  }
  stats.people = plans.length
  console.log(JSON.stringify(stats))
  plans.slice(0, 50).forEach((p, i) =>
    console.log(`#${i + 1} phone=${p.phone ? maskPhone(p.phone) : '-'} email=${p.email ? maskEmail(p.email) : '-'}`))
  if (!apply) { console.log('dry-run: nothing written'); return }

  let written = 0
  for (const p of plans) {
    const patch: Record<string, string> = {}
    if (p.phone) patch.primary_phone = p.phone
    if (p.email) patch.primary_email = p.email
    const { error } = await supabaseAdmin.from('contacts').update(patch).eq('id', p.id).eq('client_id', clientId)
    if (error) { console.error('update failed', error.message); continue }
    const rows = [
      ...(p.phone ? [{ contact_id: p.id, client_id: clientId, kind: 'phone', value: p.phone, first_source: 'brief_backfill' }] : []),
      ...(p.email ? [{ contact_id: p.id, client_id: clientId, kind: 'email', value: p.email, first_source: 'brief_backfill' }] : []),
    ]
    const { error: e2 } = await supabaseAdmin.from('contact_identities').insert(rows)
    if (e2) console.error('identity insert failed', e2.message)
    else written++
  }
  console.log(`applied: ${written}/${plans.length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
