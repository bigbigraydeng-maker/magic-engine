'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 一条经验的开关。
 *
 * 这个按钮本身就是「可撤回」那个承诺的兑现 —— 在它存在之前，关掉一条错经验
 * 的唯一办法是直接敲 SQL。
 */
export default function LessonToggle({
  lessonKey,
  isActive,
}: {
  lessonKey: string
  isActive: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ad-engine/lessons/${encodeURIComponent(lessonKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
          isActive
            ? 'bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-red-200'
            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200'
        }`}
      >
        {busy ? '…' : isActive ? '停用' : '恢复'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
