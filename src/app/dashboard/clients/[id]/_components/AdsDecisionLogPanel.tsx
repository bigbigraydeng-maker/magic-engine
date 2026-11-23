'use client'

import { useCallback, useEffect, useState } from 'react'

interface DecisionListItem {
  action_id: string
  decided_at: string
  subject_label: string
  what_done_zh: string
  status: string
  review_due_on: string
  review_verdict: string | null
  review_reason_zh: string | null
}

type LoadState = 'loading' | 'forbidden' | 'error' | 'ready'

const VERDICT_ZH: Record<string, string> = {
  met: '达到预期',
  not_met: '未达预期',
  cant_tell: '看不出',
}

export function AdsDecisionLogPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [items, setItems] = useState<DecisionListItem[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoad('loading')
    try {
      const res = await fetch(`/api/clients/${clientId}/ads-decisions`)
      if (res.status === 403) return setLoad('forbidden')
      const json = (await res.json()) as { success?: boolean; items?: DecisionListItem[] }
      if (!res.ok || !json.success || !json.items) return setLoad('error')
      setItems(json.items)
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [clientId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function submitManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const fd = new FormData(e.currentTarget)
    const body = {
      subject_label: String(fd.get('subject_label') ?? ''),
      subject_ref: String(fd.get('subject_ref') ?? ''),
      what_done_zh: String(fd.get('what_done_zh') ?? ''),
      reasoning_zh: String(fd.get('reasoning_zh') ?? ''),
      stop_or_rollback_zh: String(fd.get('stop_or_rollback_zh') ?? ''),
      review_horizon_days: Number(fd.get('review_horizon_days') ?? 3),
      no_action: fd.get('no_action') === 'on',
      entity_refs: String(fd.get('entity_refs') ?? '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    }
    try {
      const res = await fetch(`/api/clients/${clientId}/ads-decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setFormError(json.error ?? '没能记下')
        return
      }
      setFormOpen(false)
      await reload()
    } catch {
      setFormError('网络错误，请重试。')
    } finally {
      setSaving(false)
    }
  }

  if (load === 'loading') {
    return (
      <section id="ads-decision-log" className="rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm text-me-charcoal/70">正在读取决策记录…</p>
      </section>
    )
  }

  if (load === 'forbidden') {
    return (
      <section id="ads-decision-log" className="rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm text-[#C2453A]">决策记录只有内部人员能看。</p>
      </section>
    )
  }

  if (load === 'error') {
    return (
      <section id="ads-decision-log" className="rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm text-[#C2453A]">决策记录读取失败，请刷新。</p>
      </section>
    )
  }

  return (
    <section id="ads-decision-log" className="rounded-2xl border border-black/10 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-me-charcoal">广告决策记录</h2>
          <p className="mt-1 text-xs text-me-charcoal/65 leading-relaxed">
            每一次判断（含「今天不动」）都留痕，到期后自动回头看并把结论写在这里。
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-me-ochre px-3 py-1.5 text-xs font-semibold text-white"
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? '收起表单' : '记一条决策'}
        </button>
      </div>

      {formOpen ? (
        <form className="mt-4 space-y-3 rounded-xl border border-black/10 bg-[#faf9f6] p-3" onSubmit={submitManual}>
          <label className="block text-xs font-medium text-me-charcoal">
            对象简称
            <input name="subject_label" className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" required />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            内部编号（不展示给客人）
            <input name="subject_ref" className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="fixture-adset-group-a" />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            做了什么（人话）
            <textarea name="what_done_zh" rows={2} className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" required />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            为什么这样选
            <textarea name="reasoning_zh" rows={2} className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" required />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            停损 / 回滚条件
            <textarea name="stop_or_rollback_zh" rows={2} className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            新素材编号（逗号分隔，可选）
            <input name="entity_refs" className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs font-medium text-me-charcoal">
            几天后回头看
            <input name="review_horizon_days" type="number" min={1} max={28} defaultValue={3} className="mt-1 w-24 rounded-lg border border-black/15 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs text-me-charcoal">
            <input name="no_action" type="checkbox" className="rounded" />
            本日决定不调整广告
          </label>
          {formError ? <p className="text-xs text-[#C2453A]">{formError}</p> : null}
          <button type="submit" disabled={saving} className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? '保存中…' : '保存决策'}
          </button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-me-charcoal/70">还没有手工登记的决策（确认卡执行成功会自动记一条）。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.action_id} className="rounded-xl border border-black/10 px-3 py-2">
              <p className="text-sm font-medium text-me-charcoal">{item.what_done_zh}</p>
              <p className="mt-1 text-xs text-me-charcoal/65">{item.subject_label} · 回头看 {item.review_due_on}</p>
              {item.review_verdict ? (
                <p className="mt-1 text-xs text-me-charcoal/80">
                  结论：{VERDICT_ZH[item.review_verdict] ?? item.review_verdict}
                  {item.review_reason_zh ? ` — ${item.review_reason_zh}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-me-ochre">尚未写回头看结论</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
