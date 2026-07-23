'use client'

/**
 * /upload/[token] — 客户免登录素材上传页(公开页,不在 middleware 保护范围内)。
 *
 * 设计约束来自 PM:「一定要简单」。客户端只有三个动作:点链接 → 选文件 → 传。
 * **不填表、不分类、不写说明** —— 分类和打标签是我们后台的事,不该丢给客户。
 * 手机优先:老板在工地、店员在仓库,基本都是手机打开。
 *
 * 这一页刻意不显示任何客户数据(不显示客户名/素材列表):链接可能被转发,
 * 它应该只是个「投递口」,不是一扇能看见里面的窗。
 */

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'

type Phase = 'idle' | 'uploading' | 'done' | 'error'

export default function ClientUploadPage() {
  const { token } = useParams<{ token: string }>()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(0)
  const [message, setMessage] = useState('')
  const [totalSent, setTotalSent] = useState(0)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setPhase('uploading')
    setCount(files.length)
    setMessage('')

    const form = new FormData()
    for (const f of Array.from(files)) form.append('files', f)

    try {
      const res = await fetch(`/api/upload/${token}`, { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPhase('error')
        setMessage(json.error ?? '上传失败,请重试')
        return
      }
      setTotalSent((n) => n + (json.uploaded_count ?? 0))
      setPhase('done')
      setMessage(
        (json.errors ?? []).length > 0
          ? `${json.uploaded_count} 个已收到,${json.errors.length} 个没传成功`
          : '',
      )
    } catch {
      setPhase('error')
      setMessage('网络中断了,请重试')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-black text-slate-900">上传素材</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          把门店、产品、施工过程的照片和视频传上来就行。
          <span className="font-medium text-slate-800">不用分类,不用写说明。</span>
        </p>

        {phase === 'done' && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 font-bold text-emerald-800">收到了,谢谢!</p>
            <p className="mt-1 text-sm text-emerald-700">
              这次传了 {count} 个{totalSent > count ? `(累计 ${totalSent} 个)` : ''}
            </p>
            {message && <p className="mt-2 text-xs text-amber-700">{message}</p>}
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {message}
          </div>
        )}

        <label
          className={[
            'mt-6 block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition',
            phase === 'uploading'
              ? 'border-slate-200 bg-white opacity-60'
              : 'border-cyan-300 bg-white hover:border-cyan-500 hover:bg-cyan-50',
          ].join(' ')}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            disabled={phase === 'uploading'}
            onChange={(e) => void handleFiles(e.target.files)}
            className="sr-only"
          />
          {phase === 'uploading' ? (
            <>
              <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600" />
              <p className="mt-3 text-sm font-medium text-slate-600">正在上传 {count} 个文件…</p>
              <p className="mt-1 text-xs text-slate-400">别关页面,传完会提示</p>
            </>
          ) : (
            <>
              <p className="text-4xl">📷</p>
              <p className="mt-3 text-base font-bold text-slate-800">
                {phase === 'done' ? '再传一些' : '点这里选照片 / 视频'}
              </p>
              <p className="mt-1 text-xs text-slate-500">可以一次选多个</p>
            </>
          )}
        </label>

        <p className="mt-6 text-xs leading-5 text-slate-400">
          支持 JPG / PNG / HEIC 照片,MP4 / MOV 视频,单个最大 200MB。
          <br />
          传得越真实越好 —— 真实拍摄的画面才能用在带价格的广告里。
        </p>
      </div>
    </div>
  )
}
