'use client'

/**
 * 「今天看这里」最上方：目标进度（只读，数据来自 ads_growth_states.goal_pace + goals，不重算）。
 */

import React from 'react'
import Link from 'next/link'
import {
  isGoalProgressPending,
  perDayNeededToHitTarget,
} from '@/lib/ads-strategy/goal-progress-display'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'
import type { GrowthStateView, GoalPaceView } from './growth-panel'

type GoalView = {
  title: string
  label: string
  target: number
  dayIndex: number
  totalDays: number
  primaryMetricKey?: string
  progressPending?: boolean
}

export type TodayGoalGrowth =
  | GrowthStateView
  | ClientGrowthView
  | null
  | undefined

function isClientView(state: TodayGoalGrowth): state is ClientGrowthView {
  return state != null && 'viewer' in state && state.viewer === 'client'
}

function pickGoal(state: TodayGoalGrowth): GoalView | null {
  if (state == null) return null
  if (isClientView(state)) {
    if (!state.goal) return null
    return { ...state.goal }
  }
  const g = state.payload?.goal
  if (!g) return null
  return {
    title: g.title,
    label: g.label,
    target: g.target,
    dayIndex: g.dayIndex,
    totalDays: g.totalDays,
    primaryMetricKey: typeof (g as { primaryMetricKey?: unknown }).primaryMetricKey === 'string'
      ? (g as { primaryMetricKey: string }).primaryMetricKey
      : undefined,
  }
}

function pickPace(state: TodayGoalGrowth): GoalPaceView | null {
  if (state == null) return null
  return state.goal_pace
}

function goalsSettingsHref(clientId: string) {
  return `/dashboard/clients/${clientId}/goals/history`
}

export function TodayGoalProgress({
  state,
  clientId,
  todayCrmLeads,
  liveNote,
}: {
  state: TodayGoalGrowth
  clientId: string
  /** 今天 CRM 表单进线（单独一行，不算进巡察「已完成」）；null = 读不到 */
  todayCrmLeads?: number | null
  liveNote?: string
}) {
  if (state === undefined) {
    return (
      <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        目标进度读不到。
      </div>
    )
  }
  if (state === null) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        今天的广告检查还没跑完，目标进度要跑完后才显示。
      </div>
    )
  }

  const clientView = isClientView(state)
  const goal = pickGoal(state)
  const pace = pickPace(state)
  const metricKey = goal?.primaryMetricKey
  const pending = goal?.progressPending === true || isGoalProgressPending(metricKey)

  if (goal && pending) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p>{goal.title} · 还没设目标</p>
        {!clientView && (
          <p className="mt-2">
            <Link href={goalsSettingsHref(clientId)} className="text-sky-700 underline">
              去目标页设置
            </Link>
          </p>
        )}
      </div>
    )
  }

  if (!goal || !pace) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        {clientView
          ? '这段时间还没有设定广告目标，设好后这里会显示进度。'
          : '这个客户还没有生效中的目标 —— 设了目标之后，这里会显示「还差多少、来不来得及」。'}
      </div>
    )
  }

  if (pace.verdict === 'unknown' || pace.actualToDate === null) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-medium text-gray-800">判不了</p>
        <p className="mt-1 text-gray-600">{pace.reason}</p>
        {liveNote && <p className="mt-2 text-xs text-gray-500">{liveNote}</p>}
      </div>
    )
  }

  const done = pace.actualToDate
  const expected = pace.expectedToDate
  const pct = Math.max(0, Math.min(100, Math.round((done / goal.target) * 100)))
  const perDay = perDayNeededToHitTarget(goal.target, done, goal.dayIndex, goal.totalDays)

  const tone =
    pace.verdict === 'on_track'
      ? { dot: 'bg-emerald-500', tint: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-800' }
      : pace.verdict === 'behind'
        ? { dot: 'bg-amber-500', tint: 'border-amber-200 bg-amber-50', text: 'text-amber-800' }
        : pace.verdict === 'unreachable_within_caps'
          ? { dot: 'bg-red-500', tint: 'border-red-200 bg-red-50', text: 'text-red-800' }
          : { dot: 'bg-gray-400', tint: 'border-gray-200 bg-gray-50', text: 'text-gray-700' }

  return (
    <div className={`mb-4 rounded-xl border p-5 ${tone.tint}`}>
      <p className={`text-base font-semibold ${tone.text}`}>{goal.title} · 目标进度</p>
      <div className="mt-3 h-2 w-full rounded-full bg-white/70 overflow-hidden">
        <div className={`h-full ${tone.dot}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-sm text-gray-800 leading-relaxed">
        目标 <b>{goal.target}</b> {goal.label}
        {' · '}
        已完成 <b>{done}</b>
        {expected !== null && (
          <>
            {' · '}
            到今天应完成 <b>{expected}</b>
          </>
        )}
        {' · '}
        第 <b>{goal.dayIndex}</b> 天，共 <b>{goal.totalDays}</b> 天
      </p>
      {pace.projectedEnd !== null && (
        <p className="mt-1 text-sm text-gray-700">
          按现在的速度到期大约 <b>{pace.projectedEnd}</b> {goal.label}
          <span className="text-gray-500">（只按目前速度推算）</span>
        </p>
      )}
      {perDay !== null && (
        <p className="mt-1 text-sm text-gray-700">
          剩余每天约需 <b>{perDay}</b> {goal.label} 才能达标
        </p>
      )}
      {todayCrmLeads !== undefined && (
        <p className="mt-2 text-sm text-gray-600">
          {todayCrmLeads === null
            ? '今天 CRM 进线数读不到'
            : <>今天 CRM 已到 <b>{todayCrmLeads}</b> 条（不算进上面「已完成」）</>}
        </p>
      )}
      {!clientView && pace.dataThrough && (
        <p className="mt-2 text-xs text-gray-500">已完成截至 {pace.dataThrough}（巡察口径，不含今天）</p>
      )}
      {liveNote && <p className="mt-1 text-xs text-gray-500">{liveNote}</p>}
    </div>
  )
}
