interface Suggestion {
  title: string
  reason: string
}

interface StoredVerdict {
  verdict?: unknown
  confidence?: unknown
  reason?: unknown
  detail?: { without?: Suggestion[]; with?: Suggestion[] }
}

function isList(v: unknown): v is Suggestion[] {
  return Array.isArray(v) && v.every((s) => typeof s?.title === 'string' && typeof s?.reason === 'string')
}

/** 展示 evidence.ai_verdict：结论在上，并排结果折叠。没有结论返回 null。 */
export default function AiVerdictBanner({ verdict }: { verdict: unknown }) {
  const v = verdict as StoredVerdict | null | undefined
  if (!v || (v.verdict !== 'adopt' && v.verdict !== 'reject') || typeof v.reason !== 'string') return null
  const adopt = v.verdict === 'adopt'
  const conf = typeof v.confidence === 'number' ? Math.round(v.confidence * 100) : null
  const without = isList(v.detail?.without) ? v.detail.without : null
  const withLesson = isList(v.detail?.with) ? v.detail.with : null
  return (
    <div className={`mt-2 rounded px-3 py-2 text-xs ${adopt ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
      <p>
        <strong>AI 结论：{adopt ? '建议采用' : '不建议'}</strong>
        {conf !== null && <span className="text-slate-500">（把握 {conf}%）</span>} — {v.reason}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">用虚构样例初筛，不是效果证明；经验仍未启用，是否启用由你决定。</p>
      {without && withLesson && (
        <details className="mt-1">
          <summary className="cursor-pointer text-slate-600">看并排对比</summary>
          <div className="mt-1 grid gap-3 sm:grid-cols-2">
            <Col title="没有这条经验" items={without} />
            <Col title="有这条经验" items={withLesson} />
          </div>
        </details>
      )}
    </div>
  )
}

function Col({ title, items }: { title: string; items: Suggestion[] }) {
  return (
    <div className="rounded bg-white/70 p-2">
      <p className="font-medium text-slate-800">{title}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        {items.map((s, i) => (
          <li key={i}>
            <span className="font-medium">{s.title}</span>
            <span className="block text-slate-500">{s.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
