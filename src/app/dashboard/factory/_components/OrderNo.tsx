'use client'

import { useEffect, useRef, useState } from 'react'

type CopyStatus = 'idle' | 'copied' | 'failed'

interface OrderNoProps {
  id: string
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    let result = false
    try {
      result = document.execCommand('copy')
    } catch {
      result = false
    }
    document.body.removeChild(textarea)
    return result
  } catch {
    return false
  }
}

export function OrderNo({ id }: OrderNoProps) {
  const shortNo = id.slice(0, 8)
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleClick = async () => {
    const ok = await copyText(shortNo)
    setStatus(ok ? 'copied' : 'failed')
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setStatus('idle')
      timerRef.current = null
    }, 1500)
  }

  const label =
    status === 'copied'
      ? '已复制 ✓'
      : status === 'failed'
        ? '复制失败,请手动选中'
        : `工单 ${shortNo}`

  return (
    <button
      type="button"
      title="点击复制工单号"
      onClick={handleClick}
      className="text-xs font-mono text-slate-500 border border-slate-200 rounded px-1.5 py-0.5 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}
