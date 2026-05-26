import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

interface Props {
  params: { clientId: string }
  searchParams: { tab?: string }
}

const STATUS_STYLES: Record<string, string> = {
  published: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  approved: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  scheduled: 'border-amber-200 bg-amber-50 text-amber-800',
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date pending'
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  })
}

function normalizePlatforms(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-lg border px-2.5 py-1 text-xs font-black capitalize ${STATUS_STYLES[status] ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {status}
    </span>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <p className="text-sm font-black text-slate-800">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{body}</p>
    </div>
  )
}

export default async function PortalContentPage({ params, searchParams }: Props) {
  const { clientId } = params
  const tab = searchParams.tab === 'social' ? 'social' : 'blog'

  const { data: blogs } = await supabaseAdmin
    .from('blog_posts')
    .select('id, title, primary_keyword, word_count, status, created_at')
    .eq('client_id', clientId)
    .in('status', ['published', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: socials } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, caption, script, platforms, route, status, scheduled_at, created_at')
    .eq('client_id', clientId)
    .in('status', ['approved', 'published', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(50)

  const blogCount = blogs?.length ?? 0
  const socialCount = socials?.length ?? 0

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white shadow-sm sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              Content library
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
              The work your customers can actually see.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              A client-facing record of published search assets and approved social content,
              organised for review rather than production work.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Articles</p>
              <p className="mt-5 text-4xl font-black tabular-nums text-white">{blogCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Social</p>
              <p className="mt-5 text-4xl font-black tabular-nums text-white">{socialCount}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { key: 'blog', label: `Blog (${blogCount})` },
            { key: 'social', label: `Social (${socialCount})` },
          ].map(item => (
            <Link
              key={item.key}
              href={`/portal/${clientId}/content?tab=${item.key}`}
              className={`flex h-10 items-center justify-center rounded-lg px-4 text-sm font-black transition ${
                tab === item.key
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <Link
          href={`/portal/${clientId}`}
          className="flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-900"
        >
          Back to overview
        </Link>
      </div>

      {tab === 'blog' && (
        <div className="space-y-3">
          {!blogCount ? (
            <EmptyState
              title="No published articles yet."
              body="Once approved search content is published, it will appear here as proof of execution."
            />
          ) : (
            blogs?.map(post => (
              <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="text-base font-black leading-6 text-slate-950">{post.title}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {post.primary_keyword && (
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                          Keyword: {post.primary_keyword}
                        </span>
                      )}
                      {post.word_count && (
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                          {post.word_count.toLocaleString()} words
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusPill status={post.status} />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {formatDate(post.created_at)}
                </p>
              </article>
            ))
          )}
        </div>
      )}

      {tab === 'social' && (
        <div className="space-y-3">
          {!socialCount ? (
            <EmptyState
              title="No approved social content yet."
              body="Approved, scheduled, and published social assets will collect here for client review."
            />
          ) : (
            socials?.map(post => {
              const platforms = normalizePlatforms(post.platforms)
              const dateLabel = post.scheduled_at
                ? `Scheduled ${formatDate(post.scheduled_at)}`
                : formatDate(post.created_at)

              return (
                <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {platforms.map(platform => (
                          <span key={platform} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">
                            {platform}
                          </span>
                        ))}
                        {post.route && (
                          <span className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs font-black uppercase text-white">
                            {post.route}
                          </span>
                        )}
                      </div>
                      <p className="text-base font-black leading-6 text-slate-950">
                        {post.title || 'Untitled social asset'}
                      </p>
                      {post.caption && (
                        <p className="mt-2 text-sm leading-6 text-slate-600">{post.caption}</p>
                      )}
                      {post.script && (
                        <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <summary className="cursor-pointer select-none text-sm font-black text-slate-950">
                            Video script
                          </summary>
                          <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                            {post.script}
                          </pre>
                        </details>
                      )}
                    </div>
                    <StatusPill status={post.status} />
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {dateLabel}
                  </p>
                </article>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
