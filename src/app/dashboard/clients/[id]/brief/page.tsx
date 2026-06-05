'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

const BRAND_VOICE_OPTIONS = ['Professional', 'Friendly', 'Bold', 'Witty'] as const
const INDUSTRY_OPTIONS = [
  'Tourism & Hospitality',
  'Real Estate',
  'Healthcare',
  'Legal & Professional Services',
  'Retail & E-commerce',
  'Food & Beverage',
  'Construction & Trades',
  'Finance & Accounting',
  'Education & Training',
  'Technology & SaaS',
  'Beauty & Wellness',
  'Other',
] as const

interface BriefFields {
  company_name: string
  industry: string
  target_audience: string
  core_differentiator: string
  brand_voice: string
}

export default function BriefPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [fields, setFields] = useState<BriefFields>({
    company_name: '',
    industry: '',
    target_audience: '',
    core_differentiator: '',
    brand_voice: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const cameFromProspect = searchParams.get('from') === 'prospect'
  const hasWelcome = searchParams.get('welcome') === '1'
  const requestedNext = searchParams.get('next')
  const nextPath = requestedNext && requestedNext.startsWith('/dashboard/') && !requestedNext.startsWith('//')
    ? requestedNext
    : `/dashboard/clients/${id}`

  useEffect(() => {
    fetch(`/api/clients/${id}/light-brief`)
      .then(r => r.json())
      .then(data => {
        if (data.brief_fields) setFields(data.brief_fields)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${id}/light-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Save failed')
        return
      }
      setSaved(true)
      setTimeout(() => router.push(nextPath), 1200)
    } catch {
      setError('Unable to save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  function set(key: keyof BriefFields, value: string) {
    setFields(prev => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Brand Brief</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Tell us about your business</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            These 5 fields unlock content generation, the execution kanban, and Launch Hub. Takes 2 minutes.
          </p>
        </div>
        {/* P0-J: brief was a forced gate with no escape. Users who want to
            explore their workspace first now have an out. The brief stays
            required to unlock paid features (FeatureLockGate enforces that
            elsewhere), but landing the moment after signup should never feel
            like a dead-end. */}
        <button
          type="button"
          onClick={() => router.push(`/dashboard/clients/${id}`)}
          className="shrink-0 text-xs font-semibold text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
        >
          Skip for now →
        </button>
      </div>

      {(hasWelcome || cameFromProspect) && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-bold">
            {hasWelcome ? 'Your workspace is active and your welcome MTC is ready.' : 'Your discovery report is now attached to this workspace.'}
          </p>
          <p className="mt-1 leading-6 text-emerald-900/80">
            Finish these 5 fields and we will take you into your working dashboard.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Company name" required>
          <input
            type="text"
            required
            value={fields.company_name}
            onChange={e => set('company_name', e.target.value)}
            placeholder="Acme Co"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
          />
        </Field>

        <Field label="Industry" required>
          <select
            required
            value={fields.industry}
            onChange={e => set('industry', e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
          >
            <option value="">Select an industry…</option>
            {INDUSTRY_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>

        <Field label="Target audience" required hint="e.g. Small business owners in Auckland aged 30–55">
          <textarea
            required
            value={fields.target_audience}
            onChange={e => set('target_audience', e.target.value)}
            placeholder="Describe your ideal customer in one sentence"
            rows={2}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 resize-none"
          />
        </Field>

        <Field label="Core differentiator" required hint="What makes you different from competitors?">
          <textarea
            required
            value={fields.core_differentiator}
            onChange={e => set('core_differentiator', e.target.value)}
            placeholder="e.g. We're the only certified timber specialist in Brisbane with 20+ years experience"
            rows={2}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 resize-none"
          />
        </Field>

        <Field label="Brand voice" required>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BRAND_VOICE_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => set('brand_voice', opt)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  fields.brand_voice === opt
                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </Field>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || saved}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {saved ? '✓ Saved — opening workspace…' : saving ? 'Saving…' : 'Save brief & unlock platform'}
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}
