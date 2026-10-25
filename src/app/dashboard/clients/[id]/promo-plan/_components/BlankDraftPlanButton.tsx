'use client'

import { useState } from 'react'
import { formatGoalChoice } from '@/lib/marketing-plan/promo/goal-choice'

interface GoalChoice {
  id: string
  title: string
  status: string
  period_start: string
  period_end: string
}

interface Props {
  clientId: string
  onCreated: (planId: string) => void
}

export function BlankDraftPlanButton({ clientId, onCreated }: Props) {
  const draft = useBlankDraft(clientId, onCreated)
  return (
    <div className="basis-full">
      {!draft.open && (
        <button type="button" onClick={draft.openPanel}
          className="text-sm font-semibold border border-gray-300 bg-white rounded-lg px-4 py-2 hover:bg-gray-50">
          新建空白草稿计划
        </button>
      )}
      {draft.open && (
        <BlankDraftPanel
          goals={draft.goals}
          goalId={draft.goalId}
          selected={draft.selected}
          loading={draft.loading}
          busy={draft.busy}
          error={draft.error}
          onGoalId={draft.setGoalId}
          onConfirm={draft.confirm}
          onCancel={draft.closePanel}
        />
      )}
    </div>
  )
}

function useBlankDraft(clientId: string, onCreated: (planId: string) => void) {
  const [open, setOpen] = useState(false)
  const [goals, setGoals] = useState<GoalChoice[]>([])
  const [goalId, setGoalId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closePanel = () => { setOpen(false); setGoalId(''); setError(null) }
  const openPanel = () => {
    setOpen(true)
    setGoalId('')
    setError(null)
    void loadGoals(clientId, setGoals, setLoading, setError)
  }
  const confirm = () => { void submitBlankDraft(clientId, goalId, busy, setBusy, setError, closePanel, onCreated) }
  const selected = goals.find(goal => goal.id === goalId) ?? null
  return { open, goals, goalId, selected, loading, busy, error, setGoalId, openPanel, closePanel, confirm }
}

function BlankDraftPanel({ goals, goalId, selected, loading, busy, error, onGoalId, onConfirm, onCancel }: {
  goals: GoalChoice[]
  goalId: string
  selected: GoalChoice | null
  loading: boolean
  busy: boolean
  error: string | null
  onGoalId: (id: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">新建空白草稿计划</p>
      <p className="text-xs text-gray-600">只会新建一份空白草稿。不会批准，不会生成待办，也不会改动已经在执行的计划。</p>
      <label className="block text-xs text-gray-600">
        选择目标
        <select aria-label="选择目标" value={goalId} onChange={e => onGoalId(e.target.value)}
          className="mt-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white w-full">
          <option value="">请选择目标</option>
          {goals.map(goal => (
            <option key={goal.id} value={goal.id}>{formatGoalChoice(goal)}</option>
          ))}
        </select>
      </label>
      {loading && <p className="text-xs text-gray-400">正在读取目标…</p>}
      {!loading && goals.length === 0 && <p className="text-xs text-gray-600">没有读到草稿或进行中的目标。</p>}
      {selected && <SelectedGoal goal={selected} />}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} disabled={!selected || busy}
          className="text-sm font-semibold bg-gray-900 text-white rounded-lg px-4 py-2 disabled:opacity-40">
          {busy ? '新建中…' : '确认新建'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm border border-gray-300 rounded-lg px-4 py-2">取消</button>
      </div>
    </div>
  )
}

function SelectedGoal({ goal }: { goal: GoalChoice }) {
  return (
    <p className="text-xs text-gray-800">将挂到：{formatGoalChoice(goal)}</p>
  )
}

async function loadGoals(
  clientId: string,
  setGoals: (goals: GoalChoice[]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
) {
  setLoading(true)
  try {
    const res = await fetch(`/api/clients/${clientId}/goals?status=draft,active`)
    const json = await res.json() as { goals?: GoalChoice[]; error?: string }
    if (!res.ok) throw new Error(json.error ?? '读取目标失败')
    setGoals((json.goals ?? []).filter(goal => goal.status === 'draft' || goal.status === 'active'))
  } catch (err) {
    setGoals([])
    setError(err instanceof Error ? err.message : '读取目标失败')
  } finally {
    setLoading(false)
  }
}

async function submitBlankDraft(
  clientId: string,
  goalId: string,
  busy: boolean,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  closePanel: () => void,
  onCreated: (planId: string) => void,
) {
  if (!goalId || busy) return
  setBusy(true)
  setError(null)
  try {
    const planId = await postBlankDraft(clientId, goalId)
    closePanel()
    onCreated(planId)
  } catch (err) {
    setError(err instanceof Error ? err.message : '新建失败')
  } finally {
    setBusy(false)
  }
}

async function postBlankDraft(clientId: string, goalId: string): Promise<string> {
  const res = await fetch(`/api/clients/${clientId}/marketing-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal_id: goalId }),
  })
  const json = await res.json() as { success?: boolean; plan?: { id?: string }; error?: string }
  if (!res.ok || !json.success || !json.plan?.id) throw new Error(json.error ?? '新建失败')
  return json.plan.id
}
