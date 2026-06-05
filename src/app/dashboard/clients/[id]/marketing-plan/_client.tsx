'use client'

/**
 * Marketing Plan 页面 — FDE 主工作台
 *
 * 三种视图：
 *   - 列表态（默认）：显示该客户所有 Plan，可选择查看
 *   - 详情态：查看/编辑 Plan，批准后派发任务
 *   - 生成态：触发 AI 生成新 Plan 草稿
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { PlanGenerator } from './_components/PlanGenerator'
import { PlanEditor } from './_components/PlanEditor'
import { BriefGateBanner } from '../_components/BriefGateBanner'

const STATUS_META: Record<MarketingPlan['status'], { label: string; cls: string }> = {
  draft:     { label: '草稿',   cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  approved:  { label: '执行中', cls: 'bg-green-100  text-green-700  border-green-200'  },
  completed: { label: '已完成', cls: 'bg-gray-100   text-gray-600   border-gray-200'   },
  archived:  { label: '已归档', cls: 'bg-gray-100   text-gray-400   border-gray-200'   },
}

export function MarketingPlanClient() {
  const params   = useParams()
  const clientId = params.id as string

  const [plans, setPlans]               = useState<MarketingPlan[]>([])
  const [loading, setLoading]           = useState(true)
  const [showGenerator, setShowGenerator] = useState(false)
  const [selectedId, setSelectedId]     = useState<string | null>(null)

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan`)
      const json = await res.json() as { success: boolean; plans?: MarketingPlan[] }
      if (json.success) setPlans(json.plans ?? [])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchPlans() }, [fetchPlans])

  const handleGenerated = (plan: MarketingPlan) => {
    setPlans(prev => [plan, ...prev])
    setShowGenerator(false)
    setSelectedId(plan.id)
  }

  const handleUpdated = (plan: MarketingPlan) => {
    setPlans(prev => prev.map(p => p.id === plan.id ? plan : p))
  }

  const handleArchived = (planId: string) => {
    setPlans(prev => prev.filter(p => p.id !== planId))
    setSelectedId(null)
  }

  const selected = plans.find(p => p.id === selectedId) ?? null

  return (
    <BriefGateBanner featureLabel="Marketing Plan & content generation">
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Page header */}
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/clients/${clientId}`} className="text-gray-400 hover:text-gray-600 text-sm">
            ← 客户主页
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-2xl font-bold text-gray-900">📋 Marketing Plan</h1>
          <span className="text-xs text-gray-400">Master Brief × Campaign → 营销计划 → 鲁班任务</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowGenerator(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ✦ AI 生成新 Plan
            </button>
          </div>
        </div>

        {/* 概念说明 */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-5 py-3.5 flex items-start gap-3">
          <span className="text-xl shrink-0">💡</span>
          <div className="text-xs text-indigo-900 leading-relaxed">
            <strong>Marketing Plan</strong> 是 FDE 工作的策略起点。和"处方"（诊断驱动）不同，
            Plan 是<strong>主动进攻</strong>：定义这段时间发多少社媒/写多少博客，覆盖哪些主题，
            目标是什么。批准后自动派发任务到执行看板（鲁班）。
          </div>
        </div>

        {/* 主体内容：列表 + 详情 */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

          {/* 左侧：Plan 列表 */}
          <div className="space-y-2 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto pr-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              历史 Plans ({plans.length})
            </p>
            {loading ? (
              <div className="text-xs text-gray-400 animate-pulse py-4">加载中…</div>
            ) : plans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
                <p className="text-2xl mb-1">📋</p>
                <p className="text-sm text-gray-600">还没有 Marketing Plan</p>
                <p className="text-xs text-gray-400 mt-1">点击右上角生成第一个</p>
              </div>
            ) : (
              plans.map(p => {
                const meta = STATUS_META[p.status]
                const isActive = selectedId === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      isActive
                        ? 'bg-white border-indigo-400 ring-2 ring-indigo-100'
                        : 'bg-white border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-1">
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2 flex-1">{p.title}</p>
                      <span className={`shrink-0 text-[10px] font-medium border rounded-full px-1.5 py-0.5 ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    {p.start_date && p.end_date && (
                      <p className="text-[10px] text-gray-500">
                        📅 {p.start_date} → {p.end_date}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                      <span>{(p.plan_data?.tasks ?? []).length} 任务</span>
                      <span>{(p.plan_data?.blog?.topics ?? []).length} 博客</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* 右侧：详情或空态 */}
          <div className="lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto pr-1">
            {selected ? (
              <PlanEditor
                clientId={clientId}
                plan={selected}
                onUpdated={handleUpdated}
                onArchived={handleArchived}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-white py-20 text-center">
                <p className="text-4xl mb-3">👈</p>
                <p className="text-sm text-gray-500">从左侧选择一个 Plan 查看详情，或点右上角生成新的</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Generator modal */}
      {showGenerator && (
        <PlanGenerator
          clientId={clientId}
          onGenerated={handleGenerated}
          onCancel={() => setShowGenerator(false)}
        />
      )}
    </div>
    </BriefGateBanner>
  )
}
