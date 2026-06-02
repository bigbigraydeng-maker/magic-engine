'use client'

/**
 * PlanGenerator — Modal that triggers AI generation of a Marketing Plan.
 *
 * 用户输入：
 *   - title（必填）
 *   - start_date / end_date（必填）
 *   - campaign_id（可选 — 默认取最新活跃 Campaign）
 *   - intensity（light/standard/aggressive）
 *   - focus_note（可选 — 引导 AI）
 *
 * 提交后调用 POST /marketing-plan/generate，~30-60s 返回。
 */

import { useState, useEffect } from 'react'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

interface InitiativeLite {
  id: string
  title: string
  goal_title?: string
}

interface CampaignLite {
  id: string
  title: string
  valid_from: string | null
  valid_until: string | null
}

interface Props {
  clientId: string
  onGenerated: (plan: MarketingPlan) => void
  onCancel: () => void
  /** Phase 33: pre-fill when opened from an Initiative card */
  initiativeId?: string
  defaultTitle?: string
}

const INPUT = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors'

export function PlanGenerator({ clientId, onGenerated, onCancel, initiativeId, defaultTitle }: Props) {
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [campaignId, setCampaignId] = useState<string>('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [intensity, setIntensity] = useState<'light' | 'standard' | 'aggressive' | 'ai_factory'>('standard')
  const [focusNote, setFocusNote] = useState('')
  // Phase 33: initiative linkage (controlled by prop or internal select)
  const [selectedInitiativeId, setSelectedInitiativeId] = useState(initiativeId ?? '')
  const [initiatives, setInitiatives] = useState<InitiativeLite[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [generatingFocus, setGeneratingFocus] = useState(false)
  const [focusGenError, setFocusGenError] = useState('')

  // 载入活跃 Campaign 供选择
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
        if (!res.ok) return
        const json = await res.json() as { campaigns?: CampaignLite[] }
        if (!cancelled) {
          const list = json.campaigns ?? []
          setCampaigns(list)
          // 默认选第一个 + 继承日期；只有在未由 Initiative 预填 title 时才覆盖标题
          if (list[0]) {
            setCampaignId(list[0].id)
            if (!defaultTitle) setTitle(`${list[0].title} · 营销计划`)
            if (list[0].valid_from) setStartDate(list[0].valid_from)
            if (list[0].valid_until) setEndDate(list[0].valid_until)
          }
        }
      } catch {
        /* non-fatal */
      }
    })()
    return () => { cancelled = true }
  }, [clientId, defaultTitle])

  // Phase 33: 只在未从 Initiative 入口进来时，才加载 initiatives 供选择
  useEffect(() => {
    if (initiativeId) return  // prop 已确定，无需加载
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/initiatives`)
        if (!res.ok) return
        const json = await res.json() as { initiatives?: InitiativeLite[] }
        if (!cancelled) setInitiatives(json.initiatives ?? [])
      } catch {
        /* non-fatal */
      }
    })()
    return () => { cancelled = true }
  }, [clientId, initiativeId])

  // Campaign 切换时继承日期
  const handleCampaignChange = (id: string) => {
    setCampaignId(id)
    const campaign = campaigns.find(c => c.id === id)
    if (campaign?.valid_from) setStartDate(campaign.valid_from)
    if (campaign?.valid_until) setEndDate(campaign.valid_until)
  }

  // 当前选中 Campaign 是否有日期（决定日期字段是否只读）
  const selectedCampaign = campaigns.find(c => c.id === campaignId)
  const campaignHasDates = Boolean(selectedCampaign?.valid_from && selectedCampaign?.valid_until)

  const generateFocus = async () => {
    setGeneratingFocus(true)
    setFocusGenError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/generate-focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId || undefined }),
      })
      const json = await res.json() as { success: boolean; focus_note?: string; error?: string }
      if (!json.success || !json.focus_note) throw new Error(json.error ?? '生成失败')
      setFocusNote(json.focus_note)
    } catch (err) {
      setFocusGenError((err as Error).message)
    } finally {
      setGeneratingFocus(false)
    }
  }

  const submit = async () => {
    if (!title.trim()) { setError('请填写 Plan 标题'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:          title.trim(),
          campaign_id:    campaignId || undefined,
          start_date:     startDate,
          end_date:       endDate,
          intensity,
          focus_note:     focusNote.trim() || undefined,
          initiative_id:  selectedInitiativeId || undefined,
        }),
      })
      const json = await res.json() as { success: boolean; plan?: MarketingPlan; error?: string }
      if (!json.success || !json.plan) {
        throw new Error(json.error ?? 'Plan generation failed')
      }
      onGenerated(json.plan)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={loading ? undefined : onCancel} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[560px] max-w-[90vw] max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">✦ 生成 Marketing Plan</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Strategy Engine 根据 Master Brief + Campaign + SEO 机会生成结构化计划
            </p>
          </div>
          <button
            disabled={loading}
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Plan 标题 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plan 标题 *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder='例: "98年故事" — 6月营销计划'
              className={INPUT}
            />
          </div>

          {/* Campaign 选择 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">关联 Campaign（可选）</label>
            <select
              value={campaignId}
              onChange={e => handleCampaignChange(e.target.value)}
              className={INPUT}
            >
              <option value="">不关联（仅用品牌 DNA）</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            {campaigns.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                ⚠ 没有活跃 Campaign — 建议先在客户主页创建一个推广活动以提供清晰目标
              </p>
            )}
          </div>

          {/* Phase 33: Initiative 归属（从 Initiative 卡片进来时只读展示；否则可选） */}
          {initiativeId ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">所属 Initiative</label>
              <p className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
                {defaultTitle?.replace(' · 营销计划', '') ?? '已关联 Initiative'}
              </p>
            </div>
          ) : initiatives.length > 0 ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">所属 Initiative（可选）</label>
              <select
                value={selectedInitiativeId}
                onChange={e => setSelectedInitiativeId(e.target.value)}
                className={INPUT}
              >
                <option value="">不关联 Initiative</option>
                {initiatives.map(i => (
                  <option key={i.id} value={i.id}>{i.title}</option>
                ))}
              </select>
            </div>
          ) : null}

          {/* 时间范围 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                开始日期 *
                {campaignHasDates && (
                  <span className="text-[10px] text-indigo-500 font-normal">🔒 继承自 Campaign</span>
                )}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                readOnly={campaignHasDates}
                className={`${INPUT} ${campaignHasDates ? 'bg-indigo-50 text-indigo-700 cursor-default' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                结束日期 *
                {campaignHasDates && (
                  <span className="text-[10px] text-indigo-500 font-normal">🔒 继承自 Campaign</span>
                )}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                readOnly={campaignHasDates}
                className={`${INPUT} ${campaignHasDates ? 'bg-indigo-50 text-indigo-700 cursor-default' : ''}`}
              />
            </div>
          </div>

          {/* 强度 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">内容强度</label>
            <div className="grid grid-cols-4 gap-2">
              {([
                ['light',      '轻量',     '少而精'],
                ['standard',   '标准',     '常规节奏'],
                ['aggressive', '猛烈',     '高频投放'],
                ['ai_factory', 'AI 工厂',  '全速量产'],
              ] as const).map(([v, label, sub]) => (
                <button
                  key={v}
                  onClick={() => setIntensity(v)}
                  type="button"
                  className={`rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                    intensity === v
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:border-indigo-300'
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-900">{label}</p>
                  <p className="text-[10px] text-gray-500">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Focus note */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">
                FDE 关注点（可选）<span className="text-gray-400 font-normal ml-1">— 引导 AI 生成方向</span>
              </label>
              <button
                type="button"
                onClick={generateFocus}
                disabled={generatingFocus || loading}
                className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generatingFocus ? (
                  <>
                    <span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    生成中…
                  </>
                ) : (
                  <>✦ AI Generate</>
                )}
              </button>
            </div>
            <textarea
              value={focusNote}
              onChange={e => setFocusNote(e.target.value)}
              rows={3}
              placeholder='例: "本月重点突破 NZ 退休群体，社媒侧重 Reels 视频"&#10;或点击 ✦ AI Generate 自动起草'
              className={`${INPUT} resize-none`}
            />
            {focusGenError && (
              <p className="text-[11px] text-red-500 mt-1">⚠ {focusGenError}</p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600">⚠ {error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={loading || !title.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Strategy Engine 制定中…（约 30-60s）
              </>
            ) : (
              <>✦ 生成 Plan 草稿</>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
