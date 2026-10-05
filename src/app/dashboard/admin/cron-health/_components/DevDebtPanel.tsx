'use client'

import { useEffect, useState } from 'react'

/**
 * 开发欠账 —— 从 PM 今日待办挪过来的那些「这条不用你动手，回我一句我去修」。
 *
 * PM 的邮件里只剩一行小字 + 指到这里的链接；完整清单在这一栏。
 * 读挂了显示「没读出来」，绝不显示成「没有欠账」。
 */

interface DevDebtRow {
  kind: string
  client_name: string
  what: string
  how: string
  href: string
  count: number
  samples: string[]
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rows: DevDebtRow[] }

export function DevDebtPanel() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    fetch('/api/admin/dev-debt')
      .then(async (res) => {
        const data = (await res.json()) as { rows?: DevDebtRow[]; error?: string }
        if (!res.ok || !data.rows) throw new Error(data.error ?? `HTTP ${res.status}`)
        setState({ phase: 'ready', rows: data.rows })
      })
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      })
  }, [])

  return (
    <div id="dev-debt" className="mb-6 rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-me-charcoal/80">
        🛠 开发欠账（从 PM 今日待办挪过来的）
      </h2>
      <p className="mb-3 text-xs text-me-charcoal/50">
        代码 / 基础设施的问题，PM 动不了。每条都写了现象和该查什么；上面的任务失败表是另一份。
      </p>
      {state.phase === 'loading' && <p className="text-xs text-me-charcoal/40">读取中…</p>}
      {state.phase === 'error' && (
        <p className="text-xs font-semibold text-red-700">
          没读出来（{state.message}）—— 这不等于没有欠账，刷新再试一次
        </p>
      )}
      {state.phase === 'ready' && state.rows.length === 0 && (
        <p className="text-xs text-green-700">目前没有开发欠账 ✅</p>
      )}
      {state.phase === 'ready' &&
        state.rows.map((r, i) => (
          <div key={`${r.kind}-${i}`} className="border-b border-black/5 py-2 last:border-b-0">
            <p className="text-sm text-me-charcoal/90">
              <span className="font-mono text-[11px] text-me-charcoal/40">{r.kind}</span>{' '}
              <span className="font-semibold">{r.client_name}</span>：{r.what}
              {r.count > 1 ? <span className="ml-1 text-xs text-me-charcoal/50">（{r.count} 条合并）</span> : null}
            </p>
            {r.samples.length > 0 && (
              <p className="mt-0.5 text-xs text-me-charcoal/50">另外几条：{r.samples.join('；')}</p>
            )}
            <p className="mt-0.5 text-xs text-me-charcoal/60">
              → {r.how}
              {r.href ? (
                <>
                  {' · '}
                  <a href={r.href} target="_blank" rel="noopener noreferrer" className="text-cyan-700 underline">
                    去看看
                  </a>
                </>
              ) : null}
            </p>
          </div>
        ))}
    </div>
  )
}
