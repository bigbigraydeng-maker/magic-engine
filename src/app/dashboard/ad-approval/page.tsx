/**
 * 等你点头的广告。
 *
 * 这一页就是 ME 「查看 + 授权」产品形态在广告线上的落地（PM 2026-07-28 拍板）：
 * ME 把活干到只剩点头，但那一下必须是人点的 —— 花钱 / 对外可见 / 难撤回，三条全占。
 *
 * ── 页面上必须有的三样，缺一样这页就没意义 ────────────────────────────────
 *   1. **买家会看到的每一句原话** —— 而且放在最前面。2026-08-04 得罪 5 个买家，
 *      不是因为没人审，是因为审的时候看的是投放设置，没人看见那句中文问候语。
 *   2. **花多少钱** —— 印在按钮上，不是印在角落里。
 *   3. **闸门查过了没有** —— 出现在这页的都已经过闸门；被拦下的不进这页
 *      （那是 ME 自己的活没干完，不该拿来问人）。
 */

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { ADS_CREATE_ACTION, type DraftRecord } from '@/lib/ads-strategy/draft-and-gate'
import { describeDraft } from '@/lib/ads-strategy/ad-draft'
import ApproveButtons from './_components/ApproveButtons'

export const dynamic = 'force-dynamic'

/** 一次最多列多少条 —— 页面不做分页，超出的用「还有 N 条」如实说出来。 */
const PAGE_LIMIT = 50

interface ActionRow {
  id: string
  client_id: string
  payload: DraftRecord | null
  created_at: string
}

async function load(): Promise<{ rows: ActionRow[]; clients: Map<string, string>; more: number }> {
  const { data } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, payload, created_at')
    .eq('action_type', ADS_CREATE_ACTION)
    .order('created_at', { ascending: false })
    .limit(PAGE_LIMIT + 1)

  const all = (data ?? []) as ActionRow[]
  const rows = all.slice(0, PAGE_LIMIT)
  const more = Math.max(0, all.length - PAGE_LIMIT)

  const ids = Array.from(new Set(rows.map((r) => r.client_id)))
  const { data: cs } = ids.length
    ? await supabaseAdmin.from('clients').select('id, name').in('id', ids)
    : { data: [] }
  const clients = new Map(
    ((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  )
  return { rows, clients, more }
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: '等你点头',
  blocked: '系统自己拦下了',
  failed: '没建出来',
  active: '在投',
  rejected: '你说先不投',
}

const STATUS_STYLE: Record<string, string> = {
  awaiting_approval: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  blocked: 'bg-red-50 text-red-700 ring-red-200',
  failed: 'bg-slate-100 text-slate-600 ring-slate-300',
  active: 'bg-blue-50 text-blue-700 ring-blue-200',
  rejected: 'bg-slate-100 text-slate-500 ring-slate-300',
}

function costLine(p: DraftRecord): string {
  const d = p.draft
  if (!d) return '花费未知'
  return `每天 $${d.dailyBudget}、最多 $${d.dailyBudget * d.durationDays}`
}

export default async function AdApprovalPage() {
  const { rows, clients, more } = await load()

  const waiting = rows.filter((r) => r.payload?.status === 'awaiting_approval')
  const blocked = rows.filter(
    (r) => r.payload?.status === 'blocked' || r.payload?.status === 'failed',
  )
  const done = rows.filter(
    (r) => r.payload?.status === 'active' || r.payload?.status === 'rejected',
  )

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900">等你点头的广告</h1>
      <p className="mt-2 text-sm text-slate-600">
        下面每条都已经在 Meta 上建好了，<strong>但都是暂停的，一分钱没花</strong>。
        你点「开始投放」它才开始花钱。
      </p>

      {/* ── 等点头 ─────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">
          等你点头（{waiting.length}）
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
            现在没有等你点的广告。
          </p>
        ) : (
          <div className="mt-3 space-y-5">
            {waiting.map((r) => {
              const p = r.payload!
              return (
                <article
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-900">
                      {clients.get(r.client_id) ?? r.client_id}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${STATUS_STYLE.awaiting_approval}`}
                    >
                      {STATUS_LABEL.awaiting_approval}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-700">
                    {p.summary || (p.draft ? describeDraft(p.draft) : '')}
                  </p>

                  {/* 买家会看到的原话 —— 放最前面，字最大。 */}
                  <div className="mt-4 rounded-lg bg-slate-50 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      买家会看到这些字
                    </h3>
                    {p.buyerWillSee && p.buyerWillSee.length > 0 ? (
                      <ul className="mt-2 space-y-3">
                        {p.buyerWillSee.map((b) => (
                          <li key={b.adName}>
                            <div className="text-xs text-slate-500">{b.adName}</div>
                            {b.lines.map((l, i) => (
                              <p key={i} className="text-[15px] leading-relaxed text-slate-900">
                                {l}
                              </p>
                            ))}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      // 一句都没摘到不能悄悄留白 —— 那看起来像「没有文案」而不是「没查到」。
                      <p className="mt-2 text-sm text-amber-700">
                        ⚠️ 没摘到买家会看到的文案。开之前建议先去 Meta 后台自己看一眼。
                      </p>
                    )}
                  </div>

                  {p.findings && p.findings.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm text-amber-800">
                      {p.findings.map((f, i) => (
                        <li key={i}>⚠️ {f.message}</li>
                      ))}
                    </ul>
                  )}

                  <ApproveButtons actionId={r.id} costLine={costLine(p)} />
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* ── 系统自己拦下的 ─────────────────────────────────────── */}
      {blocked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">
            系统自己拦下的（{blocked.length}）
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            这些不用你处理 —— 是 ME 自己的活没干完。列在这里只是让你知道它拦了什么。
          </p>
          <div className="mt-3 space-y-3">
            {blocked.map((r) => {
              const p = r.payload!
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {clients.get(r.client_id) ?? r.client_id}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                        STATUS_STYLE[p.status] ?? STATUS_STYLE.failed
                      }`}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">{p.summary}</p>
                  {p.error && <p className="mt-1 text-red-700">{p.error}</p>}
                  {p.findings
                    ?.filter((f) => f.severity === 'blocker')
                    .map((f, i) => (
                      <p key={i} className="mt-1 text-red-700">
                        🔴 {f.message}
                      </p>
                    ))}
                  {p.orphans && p.orphans.length > 0 && (
                    <p className="mt-1 text-red-700">
                      🙋 有 {p.orphans.length} 个半成品没删掉，要去 Meta 后台手动删：
                      {p.orphans.join('、')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 已经处理过的 ───────────────────────────────────────── */}
      {done.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">已经处理过的（{done.length}）</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {done.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-slate-600">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                    STATUS_STYLE[r.payload!.status]
                  }`}
                >
                  {STATUS_LABEL[r.payload!.status]}
                </span>
                <span className="font-medium text-slate-800">
                  {clients.get(r.client_id) ?? r.client_id}
                </span>
                <span>{r.payload!.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {more > 0 && (
        <p className="mt-8 text-sm text-slate-500">
          还有更早的记录没显示（这页只列最近 {PAGE_LIMIT} 条）。
        </p>
      )}

      <p className="mt-10 text-sm text-slate-500">
        想看系统学到了什么，去{' '}
        <Link href="/dashboard/ad-engine" className="text-blue-600 underline">
          广告引擎
        </Link>
        。
      </p>
    </div>
  )
}
