'use client'

import type { ReactNode } from 'react'

export const inputCls = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white'

/** 表单里「标签 + 输入框 + 一句提示」的统一外壳。 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}
