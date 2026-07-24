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
  const [count, setCount] = useState(0)      // 本次选中数(只用于「正在上传 N 个」)
  const [lastOk, setLastOk] = useState(0)    // 服务端确认收到数
  const [message, setMessage] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [totalSent, setTotalSent] = useState(0)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setPhase('uploading')
    setCount(files.length)
    setMessage('')
    setIssues([])

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
      // 只信服务端回的数。此前显示的是本地选中数,服务端截断/失败时会当着客户的面报假数。
      const got = Number(json.uploaded_count ?? 0)
      setLastOk(got)
      setTotalSent((n) => n + got)
      setPhase('done')
      setIssues(Array.isArray(json.errors) ? json.errors : [])
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
        {/* 客户收到的是一条陌生链接。整页没有任何标识时,打开像钓鱼网站,人不敢传。
            这里放我们自己的品牌(不是客户数据,不违反「这页不显示客户信息」的约束)。 */}
        <p className="mb-6 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Magic Engine</p>
        <h1 className="text-2xl font-black text-slate-900">上传素材</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          店里、产品、干活现场、客人反馈 —— 平时随手拍的都能传。
          <span className="font-medium text-slate-800">选好直接传,剩下的我们来弄。</span>
        </p>

        {phase === 'done' && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-center text-3xl">✅</p>
            <p className="mt-2 text-center font-bold text-emerald-800">收到了,谢谢!</p>
            <p className="mt-1 text-center text-sm text-emerald-700">
              这次收到 {lastOk} 个{totalSent > lastOk ? `(本次一共 ${totalSent} 个)` : ''}
            </p>
            {/* 没成功的必须逐条说清楚是哪个、为什么。只报个数字客户只能整批重传,
                结果是素材库里一堆重复。 */}
            {issues.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-left">
                <p className="text-xs font-bold text-amber-800">这几个没传成功,请单独再传一次:</p>
                <ul className="mt-1 space-y-0.5">
                  {issues.map((e, i) => (
                    <li key={i} className="text-xs text-amber-700">· {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-bold text-red-800">没传成功</p>
            <p className="mt-1 text-sm text-red-700">{message}</p>
            <p className="mt-2 text-xs text-red-600">
              可以连上 Wi-Fi 再点下面重新选一次。还是不行的话,直接把照片发微信给我们,一样可以。
            </p>
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
              <p className="mt-1 text-xs text-slate-400">
                视频比较大,可能要几分钟。别关页面,传完会有提示。
              </p>
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
          手机拍的照片和视频直接传就行,单个视频别超过 200MB(大约 2 分钟以内)。
          <br />
          <span className="text-slate-500">
            尽量传你自己拍的 —— 随手拍的就很好,不用摆拍也不用修图。
            网上下载的图我们不能用,广告里放别人的图会有版权麻烦。
          </span>
        </p>
        {/* 客户一定会问但此前页面一个字都没答的三件事。不做折叠 —— 他不会点。 */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold text-slate-700">常见问题</p>
          <dl className="mt-2 space-y-2 text-xs leading-5 text-slate-500">
            <div>
              <dt className="font-medium text-slate-700">要传多少?</dt>
              <dd>一次 10–20 个就很够用。想到什么传什么,随时可以再传。</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">传给谁看?</dt>
              <dd>只有我们团队看得到,不会公开,只用来做你自己的推广内容。</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">传错了怎么办?</dt>
              <dd>微信告诉我们是哪一个,我们直接删掉。</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            有任何疑问,直接微信问发你这条链接的人。
            <br />
            {/* 微信内置浏览器对多选/视频上传历来不稳,点了没反应是最常见的失败方式 */}
            如果点了没反应,请点右上角「⋯」→ 在浏览器中打开。
          </p>
        </div>
      </div>
    </div>
  )
}
