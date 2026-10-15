'use client'

import { useState } from 'react'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { buildPromoTemplate } from '@/lib/marketing-plan/promo/template'

interface Props {
  clientId: string
  plan: MarketingPlan
  onSaved: () => void
}

interface ApiError { error?: string; issues?: { path: string; message: string }[]; problems?: string[] }

/** FDE 用：填写推广计划的阶段与步骤（第一版是直接编辑结构，没有表单）。只有草稿能改。 */
export function PromoSpecEditor({ clientId, plan, onSaved }: Props) {
  const existing = (plan.plan_data as unknown as { promo?: unknown }).promo
  const [text, setText] = useState(() => JSON.stringify(existing ?? buildPromoTemplate(plan), null, 2))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const save = async () => {
    setSaving(true); setErrors([])
    try {
      let promo: unknown
      try { promo = JSON.parse(text) } catch { setErrors(['内容不是合法的 JSON，请检查逗号和引号']); return }
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/${plan.id}/promo`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promo, expected_updated_at: plan.updated_at }),
      })
      const json = await res.json() as ApiError & { success: boolean }
      if (!json.success) {
        const list = [json.error ?? '保存失败', ...(json.issues ?? []).map(i => `${i.path}：${i.message}`), ...(json.problems ?? [])]
        setErrors(list); return
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900">编辑推广计划（FDE）</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          写清楚分几个阶段、每个阶段做什么。目标编号填这个客户当前目标页地址里的编号；广告账户必须是这个客户自己的。
          保存时系统会核对目标、账户和预算上限。计划批准后内容就不能直接改了。
        </p>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        className="w-full h-72 font-mono text-xs border border-gray-300 rounded-lg p-3"
        aria-label="推广计划内容"
      />
      {errors.length > 0 && (
        <ul className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      <button onClick={save} disabled={saving} className="text-sm bg-gray-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
        {saving ? '保存中…' : '保存推广计划'}
      </button>
    </section>
  )
}
