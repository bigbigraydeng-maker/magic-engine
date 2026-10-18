'use client'

import { useState, type ReactNode } from 'react'

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

/** 输入框：自己记着正在输入的文字（能打小数点、逗号，能清空），解析出的值才交给上层。 */
export function LocalInput<T>({ value, format, parse, onValue }: {
  value: T; format: (v: T) => string; parse: (text: string) => T; onValue: (v: T) => void
}) {
  const [text, setText] = useState(() => format(value))
  return (
    <input
      className={inputCls} value={text}
      onChange={e => { setText(e.target.value); onValue(parse(e.target.value)) }}
    />
  )
}
