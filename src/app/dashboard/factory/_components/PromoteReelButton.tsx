'use client'

import { useState } from 'react'

interface PromotePreview {
  preview_token: string
  page_id: string
  video_id: string
  caption: string
  first_comment: string
  mode: string
}

interface PromoteResult {
  first_comment_status?: string
}

interface PromoteReelButtonProps {
  orderId: string
  onDone?: () => void
}

export function PromoteReelButton({ orderId, onDone }: PromoteReelButtonProps) {
  const [preview, setPreview] = useState<PromotePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const reset = () => {
    setPreview(null)
    setBusy(false)
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${orderId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const json = (await res.json()) as Partial<PromotePreview> & { error?: string }
      if (!res.ok || !json.preview_token) {
        setError(json.error ?? '操作失败')
        reset()
        return
      }
      setPreview({
        preview_token: json.preview_token,
        page_id: json.page_id ?? '',
        video_id: json.video_id ?? '',
        caption: json.caption ?? '',
        first_comment: json.first_comment ?? '',
        mode: json.mode ?? '',
      })
      setBusy(false)
    } catch {
      setError('网络出错,请重试')
      reset()
    }
  }

  const confirm = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${orderId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, preview_token: preview.preview_token }),
      })
      const json = (await res.json()) as PromoteResult & { error?: string }
      if (!res.ok) {
        setError(json.error ?? '操作失败')
        reset()
        return
      }
      const warning = json.first_comment_status === 'failed' ? '首评没发成功,请联系开发处理' : null
      setDone(warning ? `已转为公开。${warning}` : '已转为公开')
      reset()
      onDone?.()
    } catch {
      setError('网络出错,请重试')
      reset()
    }
  }

  const cancel = () => {
    reset()
  }

  return (
    <div className="space-y-3">
      {done && (
        <p className="text-sm text-green-700">{done}</p>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!preview && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="h-10 rounded-lg px-5 bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
        >{busy ? '处理中…' : '转为公开发布(单条)'}</button>
      )}

      {preview && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
          <p className="text-sm font-medium text-amber-900">请确认这条 Reel 的公开内容</p>
          <dl className="text-xs text-slate-700 space-y-1">
            <div>
              <dt className="inline text-slate-500">主页 ID:</dt>
              <dd className="inline break-all">{preview.page_id}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">视频 ID:</dt>
              <dd className="inline break-all">{preview.video_id}</dd>
            </div>
            <div>
              <dt className="text-slate-500">文案:</dt>
              <dd className="whitespace-pre-wrap break-words">{preview.caption}</dd>
            </div>
            <div>
              <dt className="text-slate-500">首评:</dt>
              <dd className="whitespace-pre-wrap break-words">{preview.first_comment}</dd>
            </div>
          </dl>

          <p className="text-xs text-amber-800">确认后这条 Reel 会立刻对外公开,不能改回草稿(只能删帖)</p>
          {preview.mode === 'sync_only' && (
            <p className="text-xs text-amber-800">这条在 Facebook 上已经是公开的,只会同步记录,不会再发布一次</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="h-10 rounded-lg px-5 bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >{busy ? '处理中…' : '确认公开'}</button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >取消</button>
          </div>
        </div>
      )}
    </div>
  )
}
