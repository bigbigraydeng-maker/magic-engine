import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

interface Props {
  params: { clientId: string }
}

const DIMENSION_LABELS: Record<string, string> = {
  seo: 'Search',
  ai_visibility: 'AI visibility',
  ads: 'Advertising',
  social: 'Social media',
  reputation: 'Reputation',
  competitor: 'Competitive position',
}

const ALL_DIMENSIONS = ['seo', 'ai_visibility', 'social', 'reputation', 'ads', 'competitor']

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  pending:     { label: 'Pending',     cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In progress', cls: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-100 text-emerald-700' },
  skipped:     { label: 'Skipped',     cls: 'bg-yellow-100 text-yellow-700' },
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland',
  })
}

export default async function PortalPlanPage({ params }: Props) {
  const { clientId } = params

  const { data: items } = await supabaseAdmin
    .from('execution_items')
    .select('id, title, description, dimension, status, phase, due_date, completed_at')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .limit(100)

  const allItems = items ?? []
  const completedCount = allItems.filter(i => i.status === 'completed').length
  const activeCount = allItems.filter(i => i.status === 'in_progress').length
  const totalNonSkipped = allItems.filter(i => i.status !== 'skipped').length

  const byDimension: Partial<Record<string, typeof allItems>> = {}
  for (const item of allItems) {
    if (!item.dimension || item.status === 'skipped') continue
    const dim = item.dimension as string
    ;(byDimension[dim] ??= []).push(item)
  }

  if (allItems.length === 0) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Execution plan</p>
          <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
            Your execution plan is being assembled.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            Once the action plan is approved, your Magic Engine team will populate the execution
            items here. Check back after your onboarding call.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Execution plan</p>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
              What&apos;s being done for you.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              The full list of execution tasks across all six growth areas, grouped by priority
              and shown in real time.
            </p>
          </div>

          <div className="flex gap-4 lg:flex-col">
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4 text-center min-w-[100px]">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.12em]">Done</p>
              <p className="mt-2 text-4xl font-black tabular-nums text-emerald-300">{completedCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4 text-center min-w-[100px]">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.12em]">Active</p>
              <p className="mt-2 text-4xl font-black tabular-nums text-cyan-200">{activeCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4 text-center min-w-[100px]">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.12em]">Total</p>
              <p className="mt-2 text-4xl font-black tabular-nums text-white">{totalNonSkipped}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {ALL_DIMENSIONS.map(dim => {
          const dimItems = byDimension[dim]
          if (!dimItems?.length) return null
          const doneCount = dimItems.filter(i => i.status === 'completed').length

          return (
            <section key={dim} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <h2 className="text-base font-black text-slate-950">
                  {DIMENSION_LABELS[dim] ?? dim}
                </h2>
                <span className="text-xs font-bold text-slate-400">
                  {doneCount} / {dimItems.length} done
                </span>
              </div>
              <div className="space-y-2">
                {dimItems.map(item => {
                  const sm = STATUS_STYLES[item.status] ?? STATUS_STYLES.pending
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                    >
                      <span className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${sm.cls}`}>
                        {sm.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 leading-snug">{item.title}</p>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-slate-500 leading-snug line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1 flex gap-3">
                          {item.due_date && (
                            <p className="text-[11px] text-slate-400">Due {item.due_date}</p>
                          )}
                          {item.completed_at && (
                            <p className="text-[11px] text-emerald-600">
                              Completed {formatDate(item.completed_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <div className="flex gap-3">
        <Link
          href={`/portal/${clientId}/prescription`}
          className="flex h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-950"
        >
          View action plan
        </Link>
        <Link
          href={`/portal/${clientId}`}
          className="flex h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-950"
        >
          Back to overview
        </Link>
      </div>
    </div>
  )
}
