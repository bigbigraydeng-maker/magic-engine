/**
 * 楼盘页 —— Magic Engine 海外地产版独有（2026-08-03）。
 *
 * 服务端只做鉴权 + 行业闸 + 外壳，取数与交互都在 ProjectsClient 里。
 */

import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { supabaseAdmin } from '@/lib/supabase'
import { ProjectsClient } from './_components/ProjectsClient'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage({ params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return <Notice title="无权访问" body={access.error} />
  }

  // 行业闸：非地产客户没有「楼盘」这个概念。导航已藏入口，这里挡直接敲网址。
  if (!(await clientHasIndustryFeature(params.id, 'projects'))) {
    const notice = INDUSTRY_FEATURE_NOTICE.projects
    return <Notice title={notice.title} body={notice.body} backTo={params.id} />
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', params.id)
    .maybeSingle()

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black text-me-charcoal">楼盘</h1>
      </div>
      <ProjectsClient clientId={params.id} clientName={(client?.name as string) ?? '这个中介'} />
    </div>
  )
}

function Notice({ title, body, backTo }: { title: string; body: string; backTo?: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <div className="rounded-xl border border-me-charcoal/12 bg-me-charcoal/[0.03] p-4">
        <p className="text-sm font-black text-me-charcoal">{title}</p>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{body}</p>
        {backTo && (
          <Link
            href={`/dashboard/clients/${backTo}`}
            className="mt-3 inline-block text-xs font-bold text-me-ochre hover:underline"
          >
            ← 返回工作台
          </Link>
        )}
      </div>
    </div>
  )
}
