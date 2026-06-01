'use client'

import { useEffect, useState } from 'react'

type PipelineState = 'idle' | 'running' | 'success' | 'failed'

export interface ActivationResult {
  briefId: string | null
  briefStatus: PipelineState
  briefError: string | null
  directiveId: string | null
  directiveStatus: PipelineState
  directiveError: string | null
}

interface Props {
  clientId: string
  domain: string
  storagePaths: string[]
  websiteUrls: string[]
  onComplete: (result: ActivationResult) => void
  onBack: () => void
}

export default function Step5Activate({
  clientId,
  domain,
  storagePaths,
  websiteUrls,
  onComplete,
  onBack,
}: Props) {
  const [briefStatus, setBriefStatus] = useState<PipelineState>('idle')
  const [briefError, setBriefError] = useState<string | null>(null)
  const [briefId, setBriefId] = useState<string | null>(null)

  const [directiveStatus, setDirectiveStatus] = useState<PipelineState>('idle')
  const [directiveError, setDirectiveError] = useState<string | null>(null)
  const [directiveId, setDirectiveId] = useState<string | null>(null)

  const [started, setStarted] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!started) return

    const runBrief = async () => {
      setBriefStatus('running')
      try {
        const genRes = await fetch(`/api/clients/${clientId}/brief/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            website_urls: websiteUrls,
            file_urls: storagePaths,
            domain,
          }),
        })
        const genJson = await genRes.json()
        if (!genRes.ok || !genJson.success) {
          throw new Error(genJson.error ?? 'Brief generation failed')
        }
        const newBriefId = genJson.brief_id as string
        setBriefId(newBriefId)

        const actRes = await fetch(
          `/api/clients/${clientId}/brief/${newBriefId}/activate`,
          { method: 'POST' }
        )
        const actJson = await actRes.json()
        if (!actRes.ok) {
          throw new Error(actJson.error ?? 'Brief activation failed')
        }
        setBriefStatus('success')
      } catch (err) {
        setBriefError(err instanceof Error ? err.message : 'Brief failed')
        setBriefStatus('failed')
      }
    }

    const runDirective = async () => {
      setDirectiveStatus('running')
      try {
        const genRes = await fetch(`/api/clients/${clientId}/geo/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ use_tracker: false }),
        })
        const genJson = await genRes.json()
        if (!genRes.ok || !genJson.success) {
          throw new Error(genJson.error ?? 'Directive generation failed')
        }
        const newDirectiveId = (genJson.directive?.id ?? genJson.directiveId) as string
        if (!newDirectiveId) throw new Error('Directive returned no id')
        setDirectiveId(newDirectiveId)

        const actRes = await fetch(
          `/api/clients/${clientId}/geo/${newDirectiveId}/activate`,
          { method: 'POST' }
        )
        const actJson = await actRes.json()
        if (!actRes.ok || actJson.success === false) {
          throw new Error(actJson.error ?? 'Directive activation failed')
        }
        setDirectiveStatus('success')
      } catch (err) {
        setDirectiveError(err instanceof Error ? err.message : 'Directive failed')
        setDirectiveStatus('failed')
      }
    }

    Promise.all([runBrief(), runDirective()]).finally(() => {
      setDone(true)
    })
  }, [started, clientId, domain, storagePaths, websiteUrls])

  const handleFinish = () => {
    onComplete({
      briefId,
      briefStatus,
      briefError,
      directiveId,
      directiveStatus,
      directiveError,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-me-charcoal/90 mb-1">Activate Client</h2>
        <p className="text-me-charcoal/60 text-sm">
          We&apos;ll generate the Master Brief and an initial GEO Directive in parallel.
          This typically takes 1–2 minutes.
        </p>
      </div>

      {!started && (
        <div className="text-center py-8">
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="px-8 py-3 bg-me-ochre hover:bg-me-ochre text-white font-semibold rounded-lg"
          >
            ▶ Activate Now
          </button>
        </div>
      )}

      {started && (
        <div className="space-y-3">
          <PipelineRow
            label="Master Brief"
            description="Compile brand context from uploaded files + Site Audit data"
            state={briefStatus}
            error={briefError}
          />
          <PipelineRow
            label="GEO Directive"
            description="Generate hidden instructions for AI engines (initial draft)"
            state={directiveStatus}
            error={directiveError}
          />
        </div>
      )}

      {done && (briefStatus === 'failed' || directiveStatus === 'failed') && (
        <div className="p-3 bg-me-ochre/10 border border-me-ochre/30 rounded-lg text-xs text-me-ochre">
          ⚠️ One or more pipelines failed. You can retry from the client dashboard
          (Master Brief tab / GEO Composer) after onboarding completes.
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={started && !done}
          className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 disabled:opacity-30 font-medium"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleFinish}
          disabled={!started || !done}
          className="px-6 py-3 bg-[#5C8A4A] hover:bg-[#5C8A4A] disabled:bg-me-stone text-white font-semibold rounded-lg"
        >
          {done ? 'Go to client dashboard →' : 'Working…'}
        </button>
      </div>
    </div>
  )
}

function PipelineRow({
  label,
  description,
  state,
  error,
}: {
  label: string
  description: string
  state: PipelineState
  error: string | null
}) {
  const icon = {
    idle: '⏳',
    running: '⚙️',
    success: '✅',
    failed: '❌',
  }[state]

  const tone = {
    idle: 'border-black/10 bg-me-ivory',
    running: 'border-me-ochre/30 bg-me-ochre/10',
    success: 'border-[#5C8A4A]/30 bg-[#5C8A4A]/10',
    failed: 'border-[#C2453A]/30 bg-[#C2453A]/10',
  }[state]

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${tone}`}>
      <span className={`text-xl ${state === 'running' ? 'animate-pulse' : ''}`}>{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-me-charcoal/90">{label}</p>
        <p className="text-xs text-me-charcoal/60">{description}</p>
        {error && <p className="text-xs text-[#C2453A] mt-1">{error}</p>}
      </div>
    </div>
  )
}
