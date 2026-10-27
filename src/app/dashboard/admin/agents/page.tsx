import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { buildCatalog } from '@/lib/agent-docs/load'
import { isGlobalAdmin } from '@/lib/agent-docs/guard'
import { AGENTS_BASE } from '@/lib/agent-docs/links'
import type { AgentCatalog, AgentRow, AgentStatus, DocRef } from '@/lib/agent-docs/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Agent 与手册 · Magic Engine' }

const STATUS_LABEL: Record<AgentStatus, string> = { active: '在用', retired: '已撤', outside: '名单外，待 PM 定' }
const STATUS_CLASS: Record<AgentStatus, string> = {
  active: 'bg-green-100 text-green-800', retired: 'bg-gray-200 text-gray-700', outside: 'bg-amber-100 text-amber-800',
}
const TD = 'border-b border-black/10 px-3 py-2'

export const docHref = (ref: DocRef): string => `${AGENTS_BASE}/${ref.kind}/${encodeURIComponent(ref.file)}`

function DocLink({ doc, catalog }: { doc: DocRef; catalog: AgentCatalog }) {
  return catalog.allowed.has(`${doc.kind}/${doc.file}`)
    ? <Link href={docHref(doc)} className="text-blue-700 underline">{doc.file}</Link>
    : <span>{doc.file}</span>
}

function AgentTableRow({ row, catalog }: { row: AgentRow; catalog: AgentCatalog }) {
  return (
    <tr className="align-top">
      <td className={`${TD} font-medium`}>{row.nameZh}</td>
      <td className={`${TD} text-sm`}>{row.code || '待补'}</td>
      <td className={`${TD} text-sm`}>{row.group}</td>
      <td className={TD}><span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
      <td className={`${TD} text-sm`}>{row.profile ? <DocLink doc={row.profile} catalog={catalog} /> : '待补'}</td>
      <td className={`${TD} text-sm`}>
        {row.playbooks.length === 0 ? <span className="text-black/50">暂无手册</span> : (
          <ul className="space-y-1">
            {row.playbooks.map((p) => <li key={`${p.kind}/${p.file}`}><DocLink doc={p} catalog={catalog} /></li>)}
          </ul>
        )}
        {row.warnings.map((w) => <div key={w} className="mt-1 text-xs text-amber-700">⚠ {w}</div>)}
      </td>
    </tr>
  )
}

export default async function AgentsPage() {
  const h = await headers()
  if (!isGlobalAdmin(h)) redirect('/unauthorized')
  let built: AgentCatalog | null = null
  try { built = buildCatalog() } catch { built = null }
  const catalog = built
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">Agent 与手册</h1>
        <p className="mt-1 text-sm text-black/60">谁管什么、每个人管哪些手册、手册现在什么状态。这一页只能看，不能改；改文档请走 GitHub。</p>
      </header>
      {catalog === null || catalog.rows.length === 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">现在读不到 agent 档案（docs/agents 目录），请稍后再试，或在 GitHub 上查看。</p>
      ) : (
        <>
          {catalog.notes.map((n) => <p key={n} className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">⚠ {n}</p>)}
          <div className="overflow-x-auto rounded border border-black/10">
            <table className="min-w-full text-left">
              <thead className="bg-black/5 text-sm">
                <tr>
                  {['中文名', '代号', '分组', '状态', '档案', '管哪些手册'].map((c) => (
                    <th key={c} className="px-3 py-2 font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.rows.map((r) => (
                  <AgentTableRow key={`${r.key}-${r.profile?.file ?? ''}`} row={r} catalog={catalog as AgentCatalog} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
