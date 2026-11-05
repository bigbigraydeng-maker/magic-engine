/**
 * 今日待办「社媒账号自检」：每周一自检（social-account-audit）写的回执里，哪个客户的账号有超线或量不出来的项。
 * 每个客户最多一条；只读最近 8 天内最新一行回执；只读，一行写库都没有。
 * 设计 docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md §4：A 档（排期纠偏）等 2.5b 上线后由机器自己做（上线前文案如实写「还没上线」）；B / C 档和「量不出来」才要人看。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export const ACCOUNT_AUDIT_TODO_KIND = 'social_account_audit' as const
export const ACCOUNT_AUDIT_JOB = 'social-account-audit'
const FRESH_DAYS = 8

interface MetricLine { key: string; label: string; status: string; value: string }
interface FindingLine { key: string; tier: string; what: string; how: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function lines<T>(raw: unknown, pick: (r: Record<string, unknown>) => T | null): T[] {
  const out: T[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const one = isRecord(r) ? pick(r) : null
    if (one) out.push(one)
  }
  return out
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

const HOW_FAILED = '这条不用你改内容：自检程序这周没跑成这个客户，是我们这边的欠账，已记在运行记录里。'

/** One client receipt → one to-do (or none when nothing is over and everything is measured). A failed audit is NOT silence: it raises its own item. Pure. */
export function buildAccountAuditItem(receipt: unknown, nameOf: (id: string) => string): ManualItem | null {
  if (!isRecord(receipt) || typeof receipt.client_id !== 'string') return null
  if (receipt.error) {
    return {
      kind: ACCOUNT_AUDIT_TODO_KIND, client_id: receipt.client_id, client_name: nameOf(receipt.client_id),
      what: `本周账号自检没跑成（${s(receipt.as_of)}）：${s(receipt.error)}。这个客户这周的账号情况没人量过，不要当成没问题。`,
      how: HOW_FAILED, href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(receipt.client_id)}/daily-plan?tab=reels`,
    }
  }
  const metrics = lines<MetricLine>(receipt.metrics, (r) => (s(r.key) ? { key: s(r.key), label: s(r.label), status: s(r.status), value: s(r.value) } : null))
  const findings = lines<FindingLine>(receipt.findings, (r) => (s(r.key) ? { key: s(r.key), tier: s(r.tier), what: s(r.what), how: s(r.how) } : null))
  const over = metrics.filter((m) => m.status === 'over')
  const blind = metrics.filter((m) => m.status === 'not_measured')
  if (over.length === 0 && blind.length === 0) return null
  const parts = [
    over.length > 0 ? `${over.length} 项超线（${over.map((m) => m.label).join('、')}）` : '',
    blind.length > 0 ? `${blind.length} 项量不出来（${blind.map((m) => m.label).join('、')}）` : '',
  ].filter(Boolean)
  const person = findings.filter((f) => f.tier === 'B' || f.tier === 'C')
  const needs = person.length > 0 ? `要你或开发动手的：${person.slice(0, 3).map((f) => f.what).join('；')}。` : ''
  return {
    kind: ACCOUNT_AUDIT_TODO_KIND,
    client_id: receipt.client_id,
    client_name: nameOf(receipt.client_id),
    what: `账号自检（${s(receipt.as_of)}）：${parts.join('，')}。每天排期时已自动避开连发同模板、一周内同一首曲子、同一条片的改版；但视觉风格、素材类型这些系统看不到的重复，还是要你批清单时自己留意；${needs}`.trim(),
    how: '打开客户社媒页看哪几类内容缺：工厂有模板的那类，请下一张单；工厂没有模板的（真人、客人故事、干货、轻松类）或要客户提供素材的，请定先做哪一类，转给开发或客户。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(receipt.client_id)}/daily-plan?tab=reels`,
  }
}

const INFRA_HREF = 'https://app.inngest.com'

function infraItem(what: string): ManualItem {
  return { kind: ACCOUNT_AUDIT_TODO_KIND, client_id: 'infra', client_name: 'Magic Engine 后台', what, how: '这条不用你动手，是我们这边的欠账。', href: INFRA_HREF }
}

/**
 * Newest receipt per client over the last 8 days. A run that failed for some or all clients (status partial / failed) still counts:
 * the failure becomes a to-do, never silence. A manual run for one client only replaces that client's receipt.
 */
export async function pushAccountAuditItems(supabase: SupabaseClient, items: ManualItem[], nameOf: (id: string) => string, now: Date): Promise<void> {
  try {
    const since = new Date(now.getTime() - FRESH_DAYS * 86_400_000).toISOString()
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('summary, started_at')
      .eq('job_name', ACCOUNT_AUDIT_JOB)
      .in('status', ['completed', 'partial', 'failed'])
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(20)
    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []).map((r) => (isRecord(r) ? r.summary : null)).filter(isRecord)
    // The weekly run decides this: a later manual run for one client must not hide that the weekly run never got its client list.
    if (rows.find((r) => r.trigger !== 'event')?.status === 'list_failed') items.push(infraItem('社媒账号自检这周没拿到客户名单，所有客户都没量过，不要当成没问题。'))
    const seen = new Set<string>()
    for (const summary of rows) {
      for (const c of Array.isArray(summary.clients) ? summary.clients : []) {
        const id = isRecord(c) && typeof c.client_id === 'string' ? c.client_id : null
        if (id === null || seen.has(id)) continue
        seen.add(id)
        const item = buildAccountAuditItem(c, nameOf)
        if (item) items.push(item)
      }
    }
  } catch {
    items.push(infraItem('社媒账号自检的结果今天没读出来，这一栏可能不全。'))
  }
}
