import { META_ADS_AI_MESSAGES } from '@/lib/meta/ai/error-messages'
import ReportCharts from './ReportCharts'

type ReportStatus = 'running' | 'completed' | 'no_data' | 'failed'

export type ReportAnalysis = {
  id: string
  status: ReportStatus
  ad_account_id: string
  window_since: string
  window_until: string
  report_markdown: string | null
  error_code: string | null
  created_at: string
  completed_at: string | null
  evidence?: unknown
}

type ReportSection = {
  content: string
  heading: string | null
}

const sectionHeading = /^(?:#{1,6}[ \t]+)?(?:[一二三四五六七八九十百]+[、.．]|[（(][一二三四五六七八九十百]+[）)]|第[一二三四五六七八九十百]+(?:部分|章|节)[：:、.．]?)[ \t]*[^\r\n]*$/gm

export function splitReportSections(report: string): ReportSection[] {
  const matches = [...report.matchAll(sectionHeading)]
  if (matches.length === 0) return [{ content: report, heading: null }]

  const starts = matches.map(match => match.index ?? 0)
  const sections: ReportSection[] = []
  if (starts[0] > 0) sections.push({ content: report.slice(0, starts[0]), heading: null })

  matches.forEach((match, index) => {
    sections.push({
      content: report.slice(starts[index], starts[index + 1] ?? report.length),
      heading: match[0],
    })
  })
  return sections
}

function formatGeneratedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function statusLabel(status: ReportStatus) {
  if (status === 'completed') return '报告已生成'
  if (status === 'running') return '正在生成'
  if (status === 'no_data') return '没有可分析数据'
  return '生成未完成'
}

function sectionStyle(heading: string | null) {
  if (heading?.includes('表现较好')) return 'border-emerald-200 bg-emerald-50/70'
  if (heading?.includes('需要关注')) return 'border-amber-200 bg-amber-50/70'
  return 'border-slate-200 bg-white'
}

function SectionContent({ section }: { section: ReportSection }) {
  if (section.heading === null) return <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-800">{section.content}</div>
  const body = section.content.slice(section.heading.length)
  return <>
    <h3 className="break-words text-base font-semibold text-slate-950">{section.heading.replace(/^#{1,6}[ \t]+/,'')}</h3>
    {body && <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-800">{body}</div>}
  </>
}

function ReportBody({ report }: { report: string }) {
  return <div className="space-y-3" data-testid="report-body">
    {splitReportSections(report).map((section,index)=><section
      key={`${index}-${section.heading ?? '正文'}`}
      className={`min-w-0 rounded-xl border p-4 shadow-sm ${sectionStyle(section.heading)}`}
    >
      <SectionContent section={section} />
    </section>)}
  </div>
}

function ReportState({ analysis }: { analysis: ReportAnalysis }) {
  if (analysis.status === 'completed') {
    return analysis.report_markdown === null
      ? <p role="status" className="rounded-xl bg-slate-50 p-4 text-slate-700">报告内容暂不可用，请稍后刷新页面。</p>
      : <div className="space-y-4">
          <ReportCharts evidence={analysis.evidence} />
          <ReportBody report={analysis.report_markdown} />
        </div>
  }
  if (analysis.status === 'no_data') return <p role="status" className="rounded-xl bg-slate-50 p-4 text-slate-700">这个期间没有可分析的广告数据，因此没有产生 AI 分析费用。</p>
  if (analysis.status === 'running') return <p role="status" className="rounded-xl bg-blue-50 p-4 text-blue-900">报告正在生成，请稍后刷新页面。</p>
  const message=(analysis.error_code && META_ADS_AI_MESSAGES[analysis.error_code])
    ?? '本次分析没有完成。请稍后重试；如持续失败，请联系 Magic Engine 支持。'
  return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{message}</p>
}

export default function ReportView({ analysis }: { analysis: ReportAnalysis }) {
  const generatedAt = analysis.completed_at ?? analysis.created_at
  return <article className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm sm:p-5">
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">广告账户</p>
        <p className="mt-1 break-all font-semibold text-slate-900">{analysis.ad_account_id}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">分析期间</p>
        <p className="mt-1 font-semibold text-slate-900">{analysis.window_since} 至 {analysis.window_until}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">生成时间</p>
        <p className="mt-1 font-semibold text-slate-900">{formatGeneratedAt(generatedAt)}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">报告状态</p>
        <p className="mt-1 font-semibold text-slate-900">{statusLabel(analysis.status)}</p>
      </div>
    </div>
    <ReportState analysis={analysis} />
  </article>
}
