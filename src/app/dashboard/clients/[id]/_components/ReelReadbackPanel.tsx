'use client'

// 「发出去的 Reel 满 72 小时的成绩」：点赞、评论、分享，加一句多做 / 少做建议。只读。
// 读不到的数显示「读不到」，不显示 0；自然内容带来的私信和询价现在归不到某一条片，页面上直说。

import { useEffect, useState } from 'react'

type Reading = { kind: 'value'; value: number } | { kind: 'not_readable'; reason: string }
interface Item {
  action_id: string
  work_order_id: string
  title: string
  published_at: string | null
  permalink: string | null
  status: 'measured' | 'pending' | 'not_readable'
  note: string | null
  likes: Reading
  comments: Reading
  shares: Reading
}
interface Data { items: Item[]; lines: string[]; enough: boolean; unmatched: number }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readData(json: unknown): Data | null {
  if (!isRecord(json) || json.success !== true || !Array.isArray(json.items)) return null
  const sug = isRecord(json.suggestion) ? json.suggestion : {}
  const lines = Array.isArray(sug.lines) ? sug.lines.filter((l): l is string => typeof l === 'string') : []
  return { items: json.items as Item[], lines, enough: sug.status === 'ok', unmatched: typeof json.unmatched === 'number' ? json.unmatched : 0 }
}

const num = (r: Reading): string => (r.kind === 'value' ? String(r.value) : '读不到')

export function ReelReadbackPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await fetch(`/api/clients/${clientId}/reel-readback`).catch(() => null)
      if (!alive || res?.status === 403) return
      const json: unknown = res ? await res.json().catch(() => null) : null
      const parsed = res?.ok ? readData(json) : null
      if (parsed) setData(parsed)
      else setError('Reel 成绩没读出来，不要当成没有数据。')
    })()
    return () => { alive = false }
  }, [clientId])

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!data || (data.items.length === 0 && data.unmatched === 0)) return null

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2">
      <h3 className="text-sm font-medium text-slate-900">发出去的 Reel：满 72 小时的成绩</h3>
      {data.lines.map((l, i) => <p key={i} className="text-xs text-slate-700">{l}</p>)}
      {data.unmatched > 0 && <p role="alert" className="text-xs text-red-700">另有 {data.unmatched} 条发出去的 Reel 对不上工单，没有算进来，告诉开发。</p>}
      <ul className="space-y-1">
        {data.items.map((it) => (
          <li key={it.action_id} className="text-xs text-slate-700">
            {it.permalink ? <a className="underline" href={it.permalink} target="_blank" rel="noreferrer">{it.title}</a> : it.title}
            {it.status === 'measured' ? `：赞 ${num(it.likes)} · 评论 ${num(it.comments)} · 分享 ${num(it.shares)}` : `：${it.note ?? '没读到'}`}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">比的是点赞加评论，不是询价；分享数 Facebook 常常不返回，读不到就显示读不到。自然内容带来的私信和表单暂时归不到某一条片，所以查不到，不是 0。</p>
    </section>
  )
}
