import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { buildCatalog, readAllowedDoc } from '@/lib/agent-docs/load'
import { isGlobalAdmin } from '@/lib/agent-docs/guard'
import { AGENTS_BASE } from '@/lib/agent-docs/links'
import { HEADER_FIELDS, parseDocHeader } from '@/lib/agent-docs/header'
import type { DocKind } from '@/lib/agent-docs/types'
import { DocMarkdown } from '../../_components/DocMarkdown'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Agent 与手册 · Magic Engine',
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export default async function AgentDocPage({ params }: { params: Promise<{ kind: string; file: string }> }) {
  const h = await headers()
  if (!isGlobalAdmin(h)) redirect('/unauthorized')

  const p = await params
  const kind = safeDecode(p.kind)
  const file = safeDecode(p.file)
  const catalog = buildCatalog()
  const doc = readAllowedDoc(catalog, kind, file)
  if (!doc.ok && doc.reason === 'not_allowed') notFound()

  const owners = catalog.rows.filter((r) =>
    [r.profile, ...r.playbooks].some((d) => d?.kind === kind && d.file === file),
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <Link href={AGENTS_BASE} className="text-sm text-blue-700 underline">
        ← 回到 Agent 与手册
      </Link>
      <p className="text-xs text-black/50">只读页面，改文档请走 GitHub（docs/{kind}/{file}）。</p>
      {owners.length > 0 && (
        <p className="text-sm">归属：{owners.map((o) => o.nameZh).join('、')}</p>
      )}
      {doc.ok ? (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded border border-black/10 bg-black/[0.02] p-3 text-sm sm:grid-cols-2">
            {HEADER_FIELDS.map((f) => {
              const value = parseDocHeader(doc.text)[f]
              return (
                <div key={f} className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold">{f}</dt>
                  <dd className={value === '待补' ? 'text-amber-700' : ''}>{value}</dd>
                </div>
              )
            })}
          </dl>
          <DocMarkdown text={doc.text} from={kind as DocKind} allowed={catalog.allowed} />
        </>
      ) : (
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          这份文档现在读不到（可能还没合并进仓库），请稍后再试，或直接去 GitHub 查看。
        </p>
      )}
    </div>
  )
}
