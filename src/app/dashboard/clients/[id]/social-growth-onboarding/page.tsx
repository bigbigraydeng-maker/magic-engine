'use client'

import { useParams } from 'next/navigation'
import { OnboardingForm } from './_components/OnboardingForm'
import { PlanDetails } from './_components/PlanDetails'
import { PlanHistory } from './_components/PlanHistory'
import { SourceCoveragePanel } from './_components/SourceCoveragePanel'
import { useOnboardingWorkflow } from './_components/useOnboardingWorkflow'

export default function SocialGrowthOnboardingPage() {
  const { id: clientId } = useParams<{ id: string }>()
  const workflow = useOnboardingWorkflow(clientId)
  const setFormPatch = (patch: Partial<typeof workflow.form>) => workflow.setForm((current) => ({ ...current, ...patch }))
  const runReview = () => { void workflow.review(workflow.selected) }
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header><a className="text-sm text-me-ochre hover:underline" href={`/dashboard/clients/${clientId}`}>← 返回客户主页</a><h1 className="mt-3 font-display text-2xl font-bold text-me-charcoal">Facebook 社媒与广告起号</h1><p className="mt-1 text-sm text-me-charcoal/65">{workflow.data?.client.name ?? '读取客户资料中…'} · 生成可审核的起号与获客方案</p></header>
      {workflow.error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{workflow.error}</div>}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <OnboardingForm value={workflow.form} onChange={setFormPatch} onGenerate={() => { void workflow.generate(workflow.form) }} loading={workflow.loading} ready={Boolean(workflow.data)} />
        <SourceCoveragePanel coverage={workflow.data?.evidence.coverage} />
      </section>
      <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <PlanHistory plans={workflow.data?.plans ?? []} selectedId={workflow.selected?.id ?? null} onSelect={workflow.setSelected} />
        {workflow.selected ? <PlanDetails plan={workflow.selected} onReview={runReview} reviewing={workflow.reviewing} /> : <div className="rounded-2xl border border-me-stone bg-white py-16 text-center text-sm text-me-charcoal/55">填写目标与边界后，生成第一份可审核方案。</div>}
      </section>
    </main>
  )
}
