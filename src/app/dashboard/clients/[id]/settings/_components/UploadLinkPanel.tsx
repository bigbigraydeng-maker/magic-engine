'use client'

/**
 * UploadLinkPanel — 把客户素材上传链接拿出来发给客户。
 *
 * 链接是长期有效的固定链接(发一次,客户存着随时用),所以这里只做「显示 + 复制」,
 * 不做生成/重置按钮 —— 目前没有单条吊销机制(要作废得换服务端密钥,会让所有客户的
 * 链接一起失效)。这是刻意的取舍,别在 UI 上暗示能单独吊销。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; url: string }

export function UploadLinkPanel({ clientId }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/upload-link`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState({ phase: 'ready', url: json.url })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 浏览器不给剪贴板权限时,输入框本身可以手动全选复制
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在取上传链接…
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-bold">拿不到链接</p>
        <p className="mt-1">{state.message}</p>
        <button onClick={load} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs text-slate-500">
        把这条链接发给客户(微信/短信都行)。客户打开后<span className="font-medium text-slate-700">点一下、选文件、传完</span> ——
        不用登录、不用填表。传上来的东西会自动进这个客户的素材库并做画面分析。
      </p>

      <div className="mt-3 flex gap-2">
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
        />
        <button
          onClick={() => void copy(state.url)}
          className="shrink-0 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800"
        >{copied ? '✓ 已复制' : '复制'}</button>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        这条链接<span className="font-medium text-slate-600">只能往这个客户的素材库传文件</span>,
        看不到也改不了任何已有内容。链接长期有效,发一次就行。
      </p>
    </div>
  )
}
