'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface AggregateEntry {
  action_type: string
  confirmed: number
  inconclusive: number
  reversed: number
  total: number
  confirmed_rate: number
}

interface AggregateResponse {
  top: AggregateEntry[]
  total_actions: number
  total_outcomes: number
}

function verdictBar(entry: AggregateEntry) {
  const pct = (n: number) => entry.total === 0 ? 0 : Math.round((n / entry.total) * 100)
  const confirmed = pct(entry.confirmed)
  const inconclusive = pct(entry.inconclusive)
  const reversed = pct(entry.reversed)
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-me-ivory">
      <div className="bg-[#5C8A4A]" style={{ width: `${confirmed}%` }} title={`成功 ${confirmed}%`} />
      <div className="bg-me-gold" style={{ width: `${inconclusive}%` }} title={`待定 ${inconclusive}%`} />
      <div className="bg-[#C2453A]/70" style={{ width: `${reversed}%` }} title={`无效 ${reversed}%`} />
    </div>
  )
}

function ConfidenceBadge({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 70 ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]' : pct >= 40 ? 'bg-me-ochre/10 text-me-ochre' : 'bg-[#C2453A]/10 text-[#C2453A]'
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${color}`}>{pct}%</span>
}

export default function FlywheelAggregateAdminPage() {
  const [data, setData] = useState<AggregateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/flywheel/aggregate?top=5&min=1')
      .then(r => r.json())
      .then((d: AggregateResponse) => { setData(d); setLoading(false) })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen bg-me-ivory p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-me-charcoal/90">飞轮成效</h1>
            <p className="text-sm text-me-charcoal/55 mt-0.5">跨客户 outcome 聚合 · action_type × verdict</p>
          </div>
          <Link href="/dashboard/admin" className="text-sm text-me-charcoal/55 hover:text-me-charcoal/75">← Admin</Link>
        </div>

        {loading && (
          <div className="rounded-lg border border-black/10 bg-white p-8 text-center text-sm text-me-charcoal/45">
            加载中…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/10 p-4 text-sm text-[#C2453A]">
            加载失败：{error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-4 flex gap-4">
              <div className="flex-1 rounded-lg border border-black/10 bg-white p-4">
                <p className="text-xs text-me-charcoal/55">已追踪行动类型</p>
                <p className="text-2xl font-bold text-me-charcoal/90">{data.total_actions}</p>
              </div>
              <div className="flex-1 rounded-lg border border-black/10 bg-white p-4">
                <p className="text-xs text-me-charcoal/55">历史 Outcome 记录</p>
                <p className="text-2xl font-bold text-me-charcoal/90">{data.total_outcomes}</p>
              </div>
            </div>

            <div className="rounded-lg border border-black/10 bg-white">
              <div className="border-b border-black/[.06] px-4 py-3">
                <h2 className="text-sm font-semibold text-me-charcoal/75">Top 5 高效行动类型（按成功率）</h2>
              </div>
              {data.top.length === 0 ? (
                <div className="p-8 text-center text-sm text-me-charcoal/45">
                  暂无足够数据（outcome 记录需 ≥ 1 条）
                </div>
              ) : (
                <ul className="divide-y divide-black/10">
                  {data.top.map((entry, i) => (
                    <li key={entry.action_type} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-me-charcoal/45">#{i + 1}</span>
                          <span className="font-mono text-sm text-me-charcoal/75">{entry.action_type}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-me-charcoal/45">{entry.total} 个案例</span>
                          <ConfidenceBadge rate={entry.confirmed_rate} />
                        </div>
                      </div>
                      {verdictBar(entry)}
                      <div className="mt-1 flex gap-3 text-xs text-me-charcoal/45">
                        <span>✅ 成功 {entry.confirmed}</span>
                        <span>⏳ 待定 {entry.inconclusive}</span>
                        <span>❌ 无效 {entry.reversed}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex gap-4 text-xs text-me-charcoal/45">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-[#5C8A4A]" /> 成功 (confirmed)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-me-gold" /> 待定 (inconclusive)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-[#C2453A]/70" /> 无效 (reversed)</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
