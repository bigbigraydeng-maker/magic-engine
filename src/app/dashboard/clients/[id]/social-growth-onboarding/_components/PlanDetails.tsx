'use client'

import type { Plan } from './types'

const OBJECTIVES: Record<string, string> = { thruplay: '视频观看', engagement: '互动', messages: '消息咨询', leads: '线索表单', retargeting: '再营销' }

function StagePanel({ plan }: { plan: Plan }) {
  return <article className="rounded-xl bg-stone-50 p-4"><h3 className="font-bold">阶段安排</h3><div className="mt-3 space-y-3">{plan.recommendation.stages.map((stage, index) => <div key={`${stage.stage}-${index}`} className="rounded-lg border border-me-stone bg-white p-3"><div className="flex justify-between gap-2"><strong className="text-sm">{stage.stage}</strong><span className="text-xs text-me-charcoal/55">{stage.timing}</span></div><p className="mt-1 text-sm">{stage.objective}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{stage.actions.map((action) => <li key={action}>{action}</li>)}</ul></div>)}</div></article>
}

function OrganicPaidPanel({ plan }: { plan: Plan }) {
  const organic = plan.recommendation.organic_plan
  return <article className="rounded-xl bg-stone-50 p-4"><h3 className="font-bold">日常内容</h3><p className="mt-2 text-sm">每周 {organic.posts_per_week} 条 · 每月 {organic.reels_per_month} 条 Reels</p><p className="mt-2 text-xs text-me-charcoal/65">{organic.rationale}</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{organic.themes.map((theme) => <li key={theme}>{theme}</li>)}</ul><h3 className="mt-5 font-bold">广告组合</h3><div className="mt-2 space-y-2">{plan.recommendation.paid_mix.map((item, index) => <div key={`${item.objective}-${index}`} className="rounded-lg border border-me-stone bg-white p-3"><strong className="text-sm">{OBJECTIVES[item.objective] ?? item.objective}</strong><p className="mt-1 text-xs">{item.role}</p><p className="mt-1 text-xs text-me-charcoal/60">启动条件：{item.start_condition}</p><p className="mt-1 text-xs text-me-charcoal/60">看什么：{item.measurement}</p></div>)}</div></article>
}

function MeasurementPanel({ plan }: { plan: Plan }) {
  const statusLabel = { available: '有数据', connect_first: '需先连接', missing: '暂无数据' }
  return <article className="rounded-xl bg-stone-50 p-4"><h3 className="font-bold">衡量方式</h3><div className="mt-2 space-y-2">{plan.recommendation.measurement.map((item, index) => <div key={`${item.metric}-${index}`} className="rounded-lg border border-me-stone bg-white p-3"><div className="flex justify-between gap-2"><strong className="text-sm">{item.metric}</strong><span className="text-xs">{statusLabel[item.source_status]}</span></div><p className="mt-1 text-xs text-me-charcoal/60">{item.meaning}</p></div>)}</div></article>
}

function QuestionsPanel({ plan }: { plan: Plan }) {
  const items = [...plan.recommendation.open_questions, ...plan.recommendation.risks]
  return <article className="rounded-xl bg-stone-50 p-4"><h3 className="font-bold">待确认与风险</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></article>
}

function EvidencePanel({ plan }: { plan: Plan }) {
  const snapshot = plan.evidence_snapshot
  const hasEvidence = snapshot.masterBrief || snapshot.diagnosticSnapshots.length > 0 || snapshot.adSnapshots.length > 0
  return <details className="mt-4 rounded-lg border border-me-stone p-3"><summary className="cursor-pointer text-sm font-semibold">查看方案使用的数据与时间</summary><div className="mt-3 space-y-2 text-xs text-me-charcoal/70">
    {snapshot.masterBrief && <p>品牌简报 v{snapshot.masterBrief.version} · 更新于 {new Date(snapshot.masterBrief.updated_at).toLocaleString('zh-CN')}</p>}
    {snapshot.diagnosticSnapshots.map((item) => <p key={item.dimension}>{item.dimension === 'social' ? '社媒' : '广告'}诊断已完成 · {new Date(item.completedAt).toLocaleString('zh-CN')} · 发现 {item.findingCount} 项</p>)}
    {snapshot.socialFindings.map((item, index) => <p key={`${item.title}-${index}`}>社媒诊断：{item.title} · {new Date(item.created_at).toLocaleString('zh-CN')}</p>)}
    {snapshot.adSnapshots.map((item, index) => <p key={`${item.period_start}-${index}`}>Meta 广告汇总：{item.period_start} 至 {item.period_end} · 展示 {item.impressions ?? '未知'} · 点击 {item.clicks ?? '未知'} · 通用转化 {item.conversions ?? '未知'} · 读取于 {new Date(item.fetched_at).toLocaleString('zh-CN')}{snapshot.coverage.adSnapshotStale ? ' · 历史数据（超过 30 天）' : ''}</p>)}
    {!hasEvidence && <p>本次没有可用的历史来源数据；方案依据填写内容列出待补资料。</p>}
    <p>粉丝数、ThruPlay、消息与目标级线索结果没有通过本次数据读取获得。</p>
  </div></details>
}

export function PlanDetails({ plan, onReview, reviewing }: { plan: Plan; onReview: () => void; reviewing: boolean }) {
  return <div className="min-w-0 rounded-2xl border border-me-stone bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl font-bold">起号与获客建议</h2><p className="mt-1 text-sm text-me-charcoal/60">{plan.recommendation.executive_summary}</p></div>{plan.status === 'draft' && <button onClick={onReview} disabled={reviewing} className="rounded-lg border border-me-ochre px-4 py-2 text-sm font-bold text-me-charcoal disabled:opacity-50">{reviewing ? '保存中…' : '标记为已审核'}</button>}</div>
    <div className="mt-5 grid gap-4 xl:grid-cols-2"><StagePanel plan={plan} /><OrganicPaidPanel plan={plan} /><MeasurementPanel plan={plan} /><QuestionsPanel plan={plan} /></div>
    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">方案审核只表示人工检查完成，不代表广告获批或已执行。广告创建、投放预算和发布仍需走各自的授权流程。</p><EvidencePanel plan={plan} />
  </div>
}
