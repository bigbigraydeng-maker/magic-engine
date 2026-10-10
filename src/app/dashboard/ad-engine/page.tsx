/**
 * 广告引擎 —— ME 的广告大脑，设计者视角。
 *
 * 这一页**不是花钱看板**。PM 在 2026-08-04 的盘问里第 1 问选的是「给系统自己学」，
 * 并补了一句「同时让我作为系统的设计者也了解」。所以这页回答两个问题：
 *
 *   1. **系统现在相信什么** —— 它会拿这些去指导每个客户的 AI，所以必须能看见、
 *      能当场关掉。在这个按钮存在之前，关掉一条错经验只能直接敲 SQL。
 *   2. **在跑的广告里，哪些汇总数字在骗人** —— 当天真实事故：看广告组汇总得出
 *      「三语便宜 2.6 倍」，拆到每条广告才发现是组里塞了一条中文广告。
 *
 * 刻意不做的事：不显示每个客户花了多少、赚了多少。那是另一个页面的活，而且
 * 混进来会让这页变成「看数字」而不是「看系统在想什么」。
 */

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import {
  AD_INSIGHT_SELECT,
  adInsightRowFromDb,
  breakdownByParent,
  type AdInsightRow,
} from '@/lib/ads-strategy/ad-level-breakdown'
import { summariseIndustryCoverage, type ClientIndustryRow } from '@/lib/memory/industry-coverage'
import { INDUSTRY_OPTIONS } from '@/lib/clients/industries'
import LessonToggle from './_components/LessonToggle'

export const dynamic = 'force-dynamic'

/** 汇总只看最近这些天 —— 拿半年前的花费跟这周比，结论必然是歪的。 */
const WINDOW_DAYS = 90
/** 一次最多取多少行。Supabase 默认就是 1000，写出来是为了「撞到了能被发现」。 */
const ROW_LIMIT = 5000

interface LessonRow {
  lesson_key: string
  scope: string
  industry: string | null
  flywheel: string | null
  lesson: string
  rationale: string | null
  confidence: number
  confirmed_count: number | null
  contradicted_count: number | null
  is_active: boolean
  evidence: Record<string, unknown> | null
  updated_at: string | null
}

const SCOPE_LABEL: Record<string, string> = {
  global: '全局 · 所有客户都读得到',
  channel: '渠道 · 所有客户都读得到',
  industry: '行业 · 只给同行业客户',
}

const SCOPE_STYLE: Record<string, string> = {
  global: 'bg-purple-50 text-purple-700 ring-purple-200',
  channel: 'bg-blue-50 text-blue-700 ring-blue-200',
  industry: 'bg-amber-50 text-amber-700 ring-amber-200',
}

async function loadLessons(): Promise<LessonRow[]> {
  const { data } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson_key, scope, industry, flywheel, lesson, rationale, confidence, confirmed_count, contradicted_count, is_active, evidence, updated_at')
    .order('is_active', { ascending: false })
    .order('scope')
    .order('lesson_key')
  return (data ?? []) as LessonRow[]
}

interface ClientBreakdown {
  clientName: string
  clientId: string
  parents: ReturnType<typeof breakdownByParent>
}

async function loadBreakdowns(): Promise<ClientBreakdown[]> {
  // 时间窗 + 上限（2026-08-05 魏征 B6）。
  //
  // 原来是「取全表、没有 limit」。Supabase 默认返回上限 1000 行，超过就**静默截断** ——
  // 不报错、不提示，只是少几天的数据，于是「哪条广告更便宜」算出来是错的。
  // 按当前每天新增的行数推，约 10 月就会撞上，而撞上的表现是数字慢慢变得不对，
  // 没人会怀疑是查询的问题。
  //
  // 顺带：汇总数字本来就该有时间窗。拿半年前的花费跟这周的比，结论必然是歪的。
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)

  const { data: rows, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select(AD_INSIGHT_SELECT)
    .eq('level', 'ad')
    .gte('insight_date', since)
    .order('insight_date', { ascending: false })
    .limit(ROW_LIMIT)

  // 查询出错必须抛出来 —— 之前查了不存在的 `date` 列，报错被吞，页面一直显示「没数据」。
  if (error) throw new Error(`[ad-engine] 读取广告级数据失败：${error.message}`)
  if (!rows || rows.length === 0) return []
  // 真撞到上限就说出来 —— 不说的话，这页读起来像「全都算过了」。
  if (rows.length >= ROW_LIMIT) {
    console.warn(
      `[ad-engine] 广告级数据取满 ${ROW_LIMIT} 行上限，${WINDOW_DAYS} 天窗口内可能还有更多，` +
        '页面上的汇总只覆盖取回来的这部分',
    )
  }

  const { data: clients } = await supabaseAdmin.from('clients').select('id, name')
  const nameOf = new Map((clients ?? []).map(c => [c.id as string, c.name as string]))

  const byClient = new Map<string, AdInsightRow[]>()
  for (const r of rows) {
    const cid = r.client_id as string
    const list = byClient.get(cid) ?? []
    list.push(adInsightRowFromDb(r))
    byClient.set(cid, list)
  }

  return Array.from(byClient.entries())
    .map(([clientId, adRows]) => ({
      clientId,
      clientName: nameOf.get(clientId) ?? clientId,
      parents: breakdownByParent(adRows),
    }))
    .sort((a, b) => {
      const sa = a.parents.reduce((s, p) => s + p.aggregate.spend, 0)
      const sb = b.parents.reduce((s, p) => s + p.aggregate.spend, 0)
      return sb - sa
    })
}

/**
 * 行业经验覆盖体检 —— 「哪些客户其实读不到同行的经验」。
 *
 * 行业层按 clients.industry 精确匹配取数，匹配不上时**静默返回空**：
 * 没有报错、没有日志。所以只能靠这一块把缺口摆到台面上。
 */
async function loadIndustryCoverage() {
  const [{ data: clients }, { data: lessons }] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name, industry'),
    supabaseAdmin.from('global_learned_lessons')
      .select('industry').eq('scope', 'industry').eq('is_active', true),
  ])

  const counts: Record<string, number> = {}
  for (const l of lessons ?? []) {
    const ind = (l.industry as string | null)?.trim()
    if (ind) counts[ind] = (counts[ind] ?? 0) + 1
  }

  const rows: ClientIndustryRow[] = (clients ?? []).map(c => ({
    clientId: c.id as string,
    clientName: (c.name as string) ?? (c.id as string),
    industry: (c.industry as string | null) ?? null,
  }))

  return summariseIndustryCoverage(rows, INDUSTRY_OPTIONS.map(o => o.value), counts)
}

export default async function AdEnginePage() {
  const [lessons, breakdowns, coverage] = await Promise.all([
    loadLessons(), loadBreakdowns(), loadIndustryCoverage(),
  ])

  const active = lessons.filter(l => l.is_active)
  const retired = lessons.filter(l => !l.is_active)
  const divergentCount = breakdowns.reduce(
    (n, c) => n + c.parents.filter(p => p.verdict === 'divergent').length, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">广告引擎</h1>
        <p className="mt-1 text-sm text-slate-600">
          系统现在相信什么、在跑的广告里哪些汇总数字在骗人。
          <span className="text-slate-400">（这页不看花了多少钱 —— 那是另一件事）</span>
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <span><strong className="text-slate-900">{active.length}</strong> <span className="text-slate-500">条经验生效中</span></span>
          <span><strong className="text-slate-900">{retired.length}</strong> <span className="text-slate-500">条已停用</span></span>
          <span className={divergentCount > 0 ? 'text-red-700' : 'text-slate-500'}>
            <strong>{divergentCount}</strong> 个广告系列的汇总在掩盖差异
          </span>
        </div>
      </header>

      {/* ── 一、系统现在相信什么 ─────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900">系统现在相信什么</h2>
        <p className="mt-1 text-sm text-slate-600">
          这些会被拼进每个客户的 AI 提示词。发现哪条不对，当场按「停用」——
          不用找人改数据库。
        </p>

        <div className="mt-4 space-y-3">
          {active.length === 0 && (
            <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              暂无生效经验。
            </p>
          )}
          {active.map(l => (
            <LessonCard key={l.lesson_key} lesson={l} />
          ))}
        </div>

        {retired.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
              已停用的 {retired.length} 条
            </summary>
            <div className="mt-3 space-y-3 opacity-60">
              {retired.map(l => <LessonCard key={l.lesson_key} lesson={l} />)}
            </div>
          </details>
        )}
      </section>

      {/* ── 一点五、谁其实读不到 ─────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900">谁其实读不到这些经验</h2>
        <p className="mt-1 text-sm text-slate-600">
          行业层的经验按客户的「行业」字段精确匹配。对不上时系统
          <strong className="text-slate-800">静默返回空</strong> —— 不报错、不记日志。
          所以只能在这儿看。
        </p>

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="rounded bg-emerald-50 px-3 py-1 text-emerald-800 ring-1 ring-emerald-200">
            正常 <strong>{coverage.canonical}</strong>
          </span>
          <span className="rounded bg-red-50 px-3 py-1 text-red-800 ring-1 ring-red-200">
            行业填了但不在词表里 <strong>{coverage.freeText}</strong>
          </span>
          <span className="rounded bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">
            行业没填 <strong>{coverage.missing}</strong>
          </span>
          <span className="text-slate-500">共 {coverage.total} 个客户</span>
        </div>

        {coverage.orphanIndustries.length > 0 && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            ⚠️ 这些行业攒了经验，但**没有任何客户挂在上面**，等于攒了没人读：
            <strong className="ml-1">{coverage.orphanIndustries.join('、')}</strong>
          </p>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
            逐个客户看（问题最大的排最前）
          </summary>
          <table className="mt-3 w-full text-xs">
            <tbody>
              {coverage.clients.map(c => (
                <tr key={c.clientId} className="border-t border-slate-100">
                  <td className="w-2 py-1">
                    {c.status === 'free_text' ? '🔴' : c.status === 'missing' ? '⚠️' : '✅'}
                  </td>
                  <td className="py-1 pr-3">
                    <Link href={`/dashboard/clients/${c.clientId}/settings`} className="text-slate-800 hover:underline">
                      {c.clientName}
                    </Link>
                  </td>
                  <td className="py-1 pr-3 font-mono text-[11px] text-slate-500">{c.industry ?? '—'}</td>
                  <td className="py-1 text-slate-600">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* ── 二、汇总有没有在骗人 ─────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900">汇总数字有没有在骗人</h2>
        <p className="mt-1 text-sm text-slate-600">
          同一个广告系列里，各条广告的单价差距。差得多，就说明看汇总会把功劳记错广告。
        </p>

        <div className="mt-4 space-y-6">
          {breakdowns.length === 0 && (
            <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              还没有每条广告级别的投放数据。
            </p>
          )}
          {breakdowns.map(c => (
            <div key={c.clientId}>
              <h3 className="text-sm font-medium text-slate-800">
                <Link href={`/dashboard/clients/${c.clientId}/ads-health`} className="hover:underline">
                  {c.clientName}
                </Link>
              </h3>
              <div className="mt-2 space-y-3">
                {c.parents.map(p => (
                  <div
                    key={p.parentId ?? 'none'}
                    className={`rounded-lg border p-4 ${
                      p.verdict === 'divergent' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-mono text-xs text-slate-500">{p.parentId ?? '（无所属广告系列）'}</span>
                      <span className="text-slate-700">
                        汇总 ${p.aggregate.spend} / {p.aggregate.results} 结果
                        {p.aggregate.costPerResult !== null && (
                          <> = <strong>${p.aggregate.costPerResult}</strong>/结果</>
                        )}
                        <span className="ml-2 text-slate-400">{p.aggregate.adCount} 条广告</span>
                      </span>
                    </div>

                    {p.warning && (
                      <p className={`mt-2 text-xs ${p.verdict === 'divergent' ? 'text-red-700' : 'text-slate-500'}`}>
                        {p.warning}
                      </p>
                    )}

                    <table className="mt-3 w-full text-xs">
                      <tbody>
                        {p.children.slice(0, 10).map(ch => (
                          <tr key={ch.entityId} className="border-t border-slate-100">
                            <td className="py-1 pr-2 text-slate-400">
                              {ch.underpowered && <span title="结果数太少，不参与比较">样本不足</span>}
                            </td>
                            <td className="py-1 pr-3 text-right font-medium text-slate-800 tabular-nums">
                              {ch.costPerResult === null ? '—' : `$${ch.costPerResult}`}
                            </td>
                            <td className="py-1 pr-3 text-right text-slate-500 tabular-nums">${ch.spend}</td>
                            <td className="py-1 pr-3 text-right text-slate-500 tabular-nums">{ch.results} 结果</td>
                            <td className="py-1 pr-3 text-right text-slate-400 tabular-nums">
                              {Math.round(ch.spendShare * 100)}%
                            </td>
                            <td className="py-1 text-slate-700">{ch.entityName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function LessonCard({ lesson: l }: { lesson: LessonRow }) {
  const redacted = Boolean(l.evidence && 'original_rationale' in l.evidence)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ring-1 ${SCOPE_STYLE[l.scope] ?? 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
              {SCOPE_LABEL[l.scope] ?? l.scope}
              {l.industry ? ` · ${l.industry}` : ''}
            </span>
            {l.flywheel && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{l.flywheel}</span>
            )}
            <span className="text-[11px] text-slate-400">
              置信 {Number(l.confidence).toFixed(2)}
              {l.confirmed_count !== null && ` · 印证 ${l.confirmed_count}`}
              {l.contradicted_count ? ` · 反证 ${l.contradicted_count}` : ''}
            </span>
            {redacted && (
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200"
                    title="含金额/客户名/人名的原文已移入 evidence，不进提示词">
                已脱敏
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-slate-900">{l.lesson}</p>
          {l.rationale && <p className="mt-1 text-xs leading-relaxed text-slate-600">{l.rationale}</p>}
          <p className="mt-1 font-mono text-[10px] text-slate-300">{l.lesson_key}</p>
        </div>
        <LessonToggle lessonKey={l.lesson_key} isActive={l.is_active} />
      </div>
    </div>
  )
}
