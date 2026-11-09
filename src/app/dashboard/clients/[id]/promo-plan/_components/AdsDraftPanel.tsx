'use client'

import { useState } from 'react'
import type { AdsDraft, Basis, Suggestion } from '@/lib/marketing-plan/promo/draft-ads'
import { centsToYuan } from '@/lib/marketing-plan/promo/form'

interface Props {
  clientId: string
  planId: string
  /** 当前广告步骤的设定（只读用） */
  adAccountId: string
  /** 同一阶段里其它广告步骤（含各账户）已占用的日预算，起草时要先扣掉 */
  otherSteps: { ad_account_id: string; daily_budget_cents: number }[]
  /** 采纳：只传「有建议」的字段 */
  onAdopt: (patch: { daily_budget_cents?: number; audience_ref?: string; creative_refs?: string[] }) => void
}

/** 起草接口返回体（成功 / 失败两种形态） */
type DraftResponse =
  | { success: true; draft: AdsDraft }
  | { success: false; reason?: string; error?: string }

/** 依据一行的展示文案 */
function basisLine(b: Basis): string {
  const asOf = b.as_of ? `，取数 ${b.as_of.slice(0, 16).replace('T', ' ')}` : ''
  return `${b.label}：${b.value}（来源：${b.source}${asOf}）`
}

/** 依据列表 */
function BasisList({ basis }: { basis: [Basis, ...Basis[]] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {basis.map((b, i) => (
        <li key={i} className="text-xs text-gray-500">
          {basisLine(b)}
        </li>
      ))}
    </ul>
  )
}

/** 单项建议块：ok 显示结果 + 依据；不 ok 显示灰底说明，绝不显示成 0 或空白 */
function SuggestionBlock<T>({
  title,
  suggestion,
  render,
}: {
  title: string
  suggestion: Suggestion<T>
  render: (value: T) => string
}) {
  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="text-sm font-medium text-gray-800">{title}</div>
      {suggestion.ok ? (
        <>
          <div className="mt-1 text-sm font-semibold text-gray-900">{render(suggestion.value)}</div>
          <BasisList basis={suggestion.basis} />
        </>
      ) : (
        <div className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
          这一项系统没能给出建议：{suggestion.why_empty}
        </div>
      )}
    </div>
  )
}

export function AdsDraftPanel({ clientId, planId, adAccountId, otherSteps, onAdopt }: Props) {
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<AdsDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adopted, setAdopted] = useState(false)
  // 起草时的条件（账户 + 同阶段其它广告步骤的预算）；条件变了，旧建议就不能再采纳
  const [draftKey, setDraftKey] = useState<string | null>(null)

  const hasAccount = adAccountId !== ''
  const currentKey = JSON.stringify({ adAccountId, otherSteps })
  const stale = draft !== null && draftKey !== currentKey

  const runDraft = async () => {
    setLoading(true)
    setError(null)
    setDraft(null)
    setAdopted(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/${planId}/promo/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: adAccountId, other_steps: otherSteps }),
      })
      let data: DraftResponse
      try {
        data = (await res.json()) as DraftResponse
      } catch {
        setError('读取失败，稍后重试')
        return
      }
      if (data.success === false) {
        if (data.reason === 'approver_only') {
          setError('起草需要 Magic Lab 内部账号')
        } else {
          setError(data.error ?? '读取失败，稍后重试')
        }
        return
      }
      setDraft(data.draft)
      setDraftKey(currentKey)
    } catch {
      setError('读取失败，稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const adopt = () => {
    if (draft === null || stale) return
    const patch: { daily_budget_cents?: number; audience_ref?: string; creative_refs?: string[] } = {}
    if (draft.daily_budget_cents.ok) patch.daily_budget_cents = draft.daily_budget_cents.value
    if (draft.audience_ref.ok) patch.audience_ref = draft.audience_ref.value
    if (draft.creative_refs.ok) patch.creative_refs = draft.creative_refs.value
    onAdopt(patch)
    setAdopted(true)
  }

  const hasAnyOk =
    draft !== null &&
    (draft.daily_budget_cents.ok || draft.audience_ref.ok || draft.creative_refs.ok)

  return (
    <div className="rounded border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-800">系统起草建议</div>
        {hasAccount && (
          <button
            type="button"
            className="rounded bg-gray-800 px-3 py-1 text-xs text-white disabled:opacity-50"
            disabled={loading}
            onClick={runDraft}
          >
            {loading ? '起草中…' : '让系统起草建议'}
          </button>
        )}
      </div>

      {!hasAccount && (
        <div className="text-xs text-gray-500">先在上面选好广告账户，才能让系统起草</div>
      )}

      {error !== null && <div className="text-xs text-red-600">{error}</div>}

      {stale && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">
          广告账户或同阶段其它广告步骤的预算变了，下面的建议已经过期，请重新起草。
        </div>
      )}

      {draft !== null && (
        <div className="space-y-3">
          <SuggestionBlock
            title="预算"
            suggestion={draft.daily_budget_cents}
            render={v => `每天 ${centsToYuan(v)}（该广告账户的币种）`}
          />
          <SuggestionBlock title="受众" suggestion={draft.audience_ref} render={v => v} />
          <SuggestionBlock
            title="素材"
            suggestion={draft.creative_refs}
            render={v => v.join('、')}
          />

          {draft.warnings.length > 0 && (
            <div className="rounded border border-yellow-300 bg-yellow-50 p-2">
              <ul className="space-y-0.5">
                {draft.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-800">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasAnyOk && !stale && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-gray-800 px-3 py-1 text-xs text-white"
                onClick={adopt}
              >
                采纳可用的建议
              </button>
              {adopted && <span className="text-xs text-gray-600">已填进表单，记得保存</span>}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-gray-500">
        这只是系统的起草建议，不会自动生效。采纳后还要保存，批准计划和真正开投都要你本人点头；系统不会替你动广告账户。
      </div>
    </div>
  )
}
