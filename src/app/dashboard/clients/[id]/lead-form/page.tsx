'use client'

/**
 * /dashboard/clients/[id]/lead-form — enquiry-form snippet copy screen.
 *
 * Fetches the client's embeddable form snippet from
 * /api/clients/[id]/lead-form/snippet and gives the FDE a copy button + the
 * per-platform install steps to hand to the client. The form posts to the
 * existing /api/clients/[id]/leads endpoint (Phase B · SOP PART 2).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { InstallSnippet, SnippetPlatform } from '@/lib/leads/form-snippet'

interface SnippetResponse {
  success: boolean
  html?: string
  installs?: InstallSnippet[]
  error?: string
}

const PLATFORM_LABEL: Record<SnippetPlatform, string> = {
  generic: '通用', wordpress: 'WordPress', webflow: 'Webflow',
}

export default function LeadFormSnippetPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [data, setData] = useState<SnippetResponse | null>(null)
  const [platform, setPlatform] = useState<SnippetPlatform>('generic')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/clients/${clientId}/lead-form/snippet`)
      .then(r => r.json())
      .then(j => { if (live) setData(j) })
      .catch(() => { if (live) setData({ success: false, error: '加载失败，请刷新重试。' }) })
    return () => { live = false }
  }, [clientId])

  async function copy() {
    if (!data?.html) return
    try {
      await navigator.clipboard.writeText(data.html)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — user can select manually */ }
  }

  const install = data?.installs?.find(i => i.platform === platform)

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">询盘表单 snippet</h1>
        <Link href={`/dashboard/clients/${clientId}/delivery`} className="text-sm text-slate-500 hover:text-slate-800">← 交付驾驶舱</Link>
      </div>
      <p className="text-sm text-slate-500">
        复制下面的代码，贴到客户网站想放表单的位置。提交会实时进客户的 leads 收件箱。
      </p>

      {!data && <p className="mt-6 text-sm text-slate-400">加载中…</p>}
      {data && !data.success && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{data.error ?? '加载失败'}</p>
      )}

      {data?.success && data.html && (
        <>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">嵌入代码</span>
              <button
                onClick={copy}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                {copied ? '已复制 ✓' : '复制代码'}
              </button>
            </div>
            <textarea
              readOnly
              value={data.html}
              onFocus={e => e.currentTarget.select()}
              className="h-56 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700"
            />
          </div>

          <div className="mt-6">
            <div className="mb-2 inline-flex rounded-lg border border-slate-200 p-1 text-sm">
              {(['generic', 'wordpress', 'webflow'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                    platform === p ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
            {install && (
              <ol className="mt-2 space-y-1.5 rounded-lg bg-white p-4 text-sm text-slate-600" style={{ listStyle: 'decimal', paddingLeft: '2.2rem' }}>
                {install.instructions.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            )}
          </div>
        </>
      )}
    </main>
  )
}
