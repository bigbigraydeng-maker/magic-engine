'use client'

/**
 * 手机外勤页：今天要联系的人，一行一个，只读（第 1 刀没有任何会改数据的按钮）。
 * 数据：GET /api/clients/[id]/crm/today。读失败显示原因和重试，绝不显示成「今天没人要联系」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildFieldView, type FieldView } from '@/lib/crm/field/view'

type State = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ok'; view: FieldView; at: Date }

export function FieldTodayList({ clientId }: { clientId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // 连点刷新时只认最后一次的结果，慢回来的旧结果不覆盖新的。
  const latest = useRef(0)

  const load = useCallback(async () => {
    const mine = ++latest.current
    const show = (s: State) => {
      if (latest.current === mine) setState(s)
    }
    show({ kind: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/today`, { cache: 'no-store' })
      if (!res.ok) {
        show({ kind: 'error', text: res.status === 401 || res.status === 403 ? '你的账号没有查看权限，请重新登录。' : '名单读取失败，请重试。' })
        return
      }
      // 登录过期时请求会被带到登录页（返回的是网页不是数据）。
      if (res.redirected || !(res.headers.get('content-type') ?? '').includes('json')) {
        show({ kind: 'error', text: '登录可能已过期，请重新登录后再试。' })
        return
      }
      const view = buildFieldView(await res.json())
      if (!view.valid) {
        show({ kind: 'error', text: '名单格式不对，没法显示。请重试，一直这样请告诉 Magic Engine。' })
        return
      }
      show({ kind: 'ok', view, at: new Date() })
    } catch {
      show({ kind: 'error', text: '网络不好，名单没读到。请重试。' })
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  if (state.kind === 'loading') return <p className="py-8 text-center text-base text-me-charcoal/70">正在读取今天的名单…</p>
  if (state.kind === 'error') {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-base text-red-900" role="alert">
        <p>{state.text}</p>
        <button type="button" onClick={() => void load()} className="mt-3 min-h-[44px] rounded-md bg-me-charcoal px-5 text-base font-semibold text-white">
          重试
        </button>
      </div>
    )
  }

  const { view, at } = state
  const empty = view.sections.every((s) => s.rows.length === 0)
  return (
    <div>
      {empty && <p className="rounded-md bg-me-stone/40 p-4 text-base text-me-charcoal">今天要人做的事已经都做完了。</p>}
      {view.sections.map((s) =>
        s.rows.length === 0 ? null : (
          <section key={s.layer} className="mb-6" aria-label={s.title}>
            <h2 className="text-lg font-bold text-me-charcoal">
              {s.title} <span className="font-normal text-me-charcoal/60">· {s.total} 人</span>
            </h2>
            <p className="mb-2 text-sm text-me-charcoal/70">{s.hint}</p>
            <ul className="space-y-2">
              {s.rows.map((r) => (
                <li key={r.contactId} className={`rounded-md border border-me-charcoal/15 p-3 ${r.done ? 'bg-me-stone/30 text-me-charcoal/60' : 'bg-white'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold">{r.name}</span>
                    {r.done && <span className="whitespace-nowrap text-xs font-semibold text-green-800">今天已联系</span>}
                  </div>
                  {r.reason && <p className="mt-1 text-sm">{r.reason}</p>}
                  <p className="mt-1 text-xs text-me-charcoal/60">
                    {[r.stageLabel, r.lastBy ? `上次：${r.lastBy}` : null, callBlockText(r.callBlock)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {view.queuedCount > 0 && <p className="mb-4 text-sm text-me-charcoal/70">另有 {view.queuedCount} 人先放着，系统在盯，不用今天处理。</p>}
      <div className="flex items-center justify-between border-t border-me-charcoal/10 pt-3">
        <span className="text-xs text-me-charcoal/60">更新于 {at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <button type="button" onClick={() => void load()} className="min-h-[44px] rounded-md border border-me-charcoal/30 px-5 text-base font-semibold text-me-charcoal">
          刷新
        </button>
      </div>
    </div>
  )
}

function callBlockText(b: 'none' | 'no_phone' | 'bad_phone' | 'do_not_call'): string | null {
  if (b === 'no_phone') return '没留电话'
  if (b === 'bad_phone') return '号码打不通'
  if (b === 'do_not_call') return '客人不要电话'
  return null
}
