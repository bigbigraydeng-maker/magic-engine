'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormState, PageData, Plan } from './types'

export const INITIAL_FORM: FormState = {
  industryProfile: 'general', primaryGoal: 'mixed', audience: '', currentFollowers: null,
  organicPostsPerWeek: null, monthlyAdBudgetCap: null, leadResponseMinutes: null, constraints: '',
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? fallback)
  return result
}

function useClientData(clientId: string) {
  const [data, setData] = useState<PageData | null>(null)
  const [selected, setSelected] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/clients/${clientId}/social-growth-onboarding`, { cache: 'no-store' })
    const result = await parseResponse<PageData>(response, '读取客户资料失败')
    setData(result)
    setSelected((current) => result.plans.find((plan) => plan.id === current?.id) ?? result.plans[0] ?? null)
    return result
  }, [clientId])
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取客户资料失败')) }, [refresh])
  return { data, selected, setSelected, error, setError, refresh }
}

function useGenerate(clientId: string, refresh: () => Promise<PageData>, setSelected: (plan: Plan) => void, setError: (error: string) => void) {
  const [loading, setLoading] = useState(false)
  const generate = useCallback(async (input: FormState) => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/clients/${clientId}/social-growth-onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) })
      const result = await parseResponse<{ plan?: Plan }>(response, '方案生成失败')
      if (!result.plan) throw new Error('方案生成失败')
      await refresh(); setSelected(result.plan)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '方案生成失败') } finally { setLoading(false) }
  }, [clientId, refresh, setError, setSelected])
  return { loading, generate }
}

function useReview(clientId: string, refresh: () => Promise<PageData>, setError: (error: string) => void) {
  const [reviewing, setReviewing] = useState(false)
  const review = useCallback(async (plan: Plan | null) => {
    if (!plan) return
    setReviewing(true); setError('')
    try {
      const response = await fetch(`/api/clients/${clientId}/social-growth-onboarding`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan.id, status: 'reviewed' }) })
      await parseResponse(response, '审核状态保存失败'); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审核状态保存失败') } finally { setReviewing(false) }
  }, [clientId, refresh, setError])
  return { reviewing, review }
}

export function useOnboardingWorkflow(clientId: string) {
  const workflow = useClientData(clientId)
  const generation = useGenerate(clientId, workflow.refresh, workflow.setSelected, workflow.setError)
  const review = useReview(clientId, workflow.refresh, workflow.setError)
  const [form, setForm] = useState(INITIAL_FORM)
  useEffect(() => {
    const suggested = workflow.data?.suggestedIndustryProfile
    if (form.industryProfile === 'general' && suggested && suggested !== 'general') setForm((current) => ({ ...current, industryProfile: suggested }))
  }, [form.industryProfile, workflow.data?.suggestedIndustryProfile])
  return { ...workflow, ...generation, ...review, form, setForm }
}
