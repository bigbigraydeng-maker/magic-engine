import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { prescriptionHref } from '@/lib/project-console/links'
import { listConsoleClients } from '@/lib/project-console/load'
import { requireStaffScope } from '@/lib/project-console/staff'
import { loadStartChoices, type StartScan } from '@/lib/project-console/start'
import { Notice } from '../_components/Notice'

export const dynamic = 'force-dynamic'

const SCAN_MISSING = '还没有确认过的品牌扫描，开不了方。'

export default async function StartProjectPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const scope = await requireStaffScope()
  if (!scope.ok) return <Notice title="开始一个项目" body={scope.message} back />
  const clientId = first(searchParams.client)
  const goalId = first(searchParams.goal)
  if (!clientId) {
    const listed = await listConsoleClients(supabaseAdmin, scope.kind === 'one' ? scope.clientId : null)
    if (!listed.ok) return <Notice title="开始一个项目" body={listed.message} back />
    return <PickClient clients={listed.clients} />
  }
  if (scope.kind === 'one' && scope.clientId !== clientId) {
    return <Notice title="无权访问" body="这不是你负责的客户。" back />
  }
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return <Notice title="无权访问" body="打不开这个客户。" back />
  const choices = await loadStartChoices(supabaseAdmin, clientId)
  if (!choices.ok) return <Notice title="开始一个项目" body={choices.message} back />
  return <PickGoal choices={choices} clientId={clientId} goalId={goalId} />
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim() ?? ''
  return trimmed || null
}

function PickClient({ clients }: { clients: { id: string; name: string }[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Back />
      <h1 className="font-display text-2xl font-black text-me-charcoal">开始一个项目</h1>
      <p className="mt-1 text-sm leading-6 text-me-charcoal/70">先选客户。</p>
      {clients.length === 0 ? (
        <p className="mt-6 text-sm text-me-charcoal">还没有客户。</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/dashboard/impact/new?client=${encodeURIComponent(client.id)}`}
                className="block rounded-xl border border-me-charcoal/12 bg-white px-4 py-3 font-semibold text-me-charcoal hover:border-me-ochre focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre"
              >
                {client.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PickGoal({
  choices,
  clientId,
  goalId,
}: {
  choices: { clientName: string; goals: { id: string; title: string }[]; scan: StartScan }
  clientId: string
  goalId: string | null
}) {
  const goal = choices.goals.find((item) => item.id === goalId) ?? null
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Back />
      <h1 className="font-display text-2xl font-black text-me-charcoal">{choices.clientName}</h1>
      <p className="mt-1 text-sm leading-6 text-me-charcoal/70">再选这一轮的目标。开方仍交给华佗，这里不代写。</p>
      <ScanNote scan={choices.scan} clientId={clientId} />
      {choices.goals.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-me-charcoal">
          这个客户还没有在用的目标。
          <Link href={`/dashboard/clients/${encodeURIComponent(clientId)}/goal/new`} className="ml-2 font-bold text-me-ochre hover:underline">
            去建目标
          </Link>
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {choices.goals.map((item) => (
            <li key={item.id}>
              <Link
                href={`/dashboard/impact/new?client=${encodeURIComponent(clientId)}&goal=${encodeURIComponent(item.id)}`}
                className={`block rounded-xl border px-4 py-3 font-semibold ${
                  item.id === goal?.id ? 'border-me-ochre bg-white text-me-charcoal' : 'border-me-charcoal/12 bg-white text-me-charcoal'
                }`}
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {goal ? <OpenNote scan={choices.scan} clientId={clientId} goalId={goal.id} /> : null}
    </div>
  )
}

function ScanNote({ scan, clientId }: { scan: StartScan; clientId: string }) {
  if (scan === 'confirmed') return <p className="mt-4 text-sm text-me-charcoal">品牌扫描已经确认，可以开方。</p>
  const body = scan === 'unread' ? '品牌扫描这次没读到，先别开方。' : SCAN_MISSING
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold leading-6 text-amber-950">{body}</p>
      <Link
        href={`/dashboard/clients/${encodeURIComponent(clientId)}/zhangqian`}
        className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-me-charcoal px-4 text-sm font-semibold text-white"
      >
        去做品牌扫描
      </Link>
    </div>
  )
}

function OpenNote({ scan, clientId, goalId }: { scan: 'confirmed' | 'missing' | 'unread'; clientId: string; goalId: string }) {
  if (scan !== 'confirmed') return null
  return (
    <Link
      href={prescriptionHref(clientId, null, goalId)}
      className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-me-charcoal px-4 text-sm font-semibold text-white hover:bg-me-black"
    >
      去跟华佗开方
    </Link>
  )
}

function Back() {
  return (
    <Link href="/dashboard/impact" className="mb-4 inline-block text-sm font-bold text-me-ochre hover:underline">
      ← 全部项目
    </Link>
  )
}
