'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Step1BasicInfo, { type Step1Data } from './_components/Step1BasicInfo'

/**
 * /dashboard/clients/new
 *
 * 2-step onboarding: Step 1 (basic info) → Step 2 (张骞 discovery at /clients/[id]/zhangqian)
 * Reference: ROADMAP.md P8.10.S0.12
 */
export default function NewClientPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (data: Step1Data) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, domain: data.domain }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create client')
      const newId = json.client?.id as string
      if (!newId) throw new Error('Client created but no id returned')

      if (data.targetMarket === 'nz') {
        await fetch(`/api/clients/${newId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ semrush_db: 'nz' }),
        }).catch(() => {})
      }

      router.push(`/dashboard/clients/${newId}/zhangqian`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-me-ivory to-me-stone py-12 px-4">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-4xl mb-3">🗺️</div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90 mb-2">接入新客户</h1>
          <p className="text-me-charcoal/55 text-sm">输入域名，张骞自动生成完整品牌画像（约 3–5 分钟）</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-me-ochre text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-sm font-medium text-me-ochre">基本信息</span>
          </div>
          <div className="w-8 h-px bg-me-stone" />
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-me-stone text-me-charcoal/45 text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-sm text-me-charcoal/45">发现与确认</span>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-lg p-8">
          {error && (
            <div className="mb-6 p-4 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg text-[#C2453A] text-sm">
              {error}
            </div>
          )}
          <Step1BasicInfo
            initial={{ name: '', domain: '', targetMarket: 'au' }}
            onSubmit={handleSubmit}
            loading={loading}
          />
        </div>

      </div>
    </div>
  )
}
