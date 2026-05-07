'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StepIndicator from './_components/StepIndicator'
import Step1BasicInfo, { type Step1Data } from './_components/Step1BasicInfo'
import Step2BriefUpload, { type Step2Data } from './_components/Step2BriefUpload'
import Step3DnzCrawl, { type Step3Data } from './_components/Step3DnzCrawl'
import Step4ReviewPages from './_components/Step4ReviewPages'
import Step5Activate, { type ActivationResult } from './_components/Step5Activate'

const STEP_LABELS = ['Basic Info', 'Brief Files', 'Site Audit', 'Review', 'Activate']

/**
 * /dashboard/clients/new
 *
 * 5-step onboarding wizard with DNZ integration.
 * Reference: ROADMAP.md P8.3.1, CLAUDE.md §十五 B
 */
export default function NewClientWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [clientId, setClientId] = useState<string | null>(null)
  const [step1, setStep1] = useState<Step1Data>({ name: '', domain: '', targetMarket: 'au' })
  const [step2, setStep2] = useState<Step2Data>({
    storagePaths: [],
    websiteUrls: [],
    uploadedFiles: [],
  })
  const [step3, setStep3] = useState<Step3Data>({
    jobId: null,
    totalPages: 0,
    status: 'pending',
  })

  const handleStep1 = async (data: Step1Data) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          domain: data.domain,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create client')
      const newId = json.client?.id as string
      if (!newId) throw new Error('Client created but no id returned')

      // POST /api/clients hardcodes semrush_db='au'; sync from market via PATCH
      const semrushDb = data.targetMarket === 'nz' ? 'nz' : 'au'
      if (semrushDb !== 'au') {
        await fetch(`/api/clients/${newId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ semrush_db: semrushDb }),
        }).catch(() => {
          // Non-fatal — client is created and can be edited later
        })
      }

      setClientId(newId)
      setStep1(data)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleStep2 = (data: Step2Data) => {
    setStep2(data)
    setError(null)
    setStep(3)
  }

  const handleStep2Skip = () => {
    setError(null)
    setStep(3)
  }

  const handleStep3 = (data: Step3Data) => {
    setStep3(data)
    setError(null)
    setStep(4)
  }

  const handleStep3Skip = () => {
    setStep3({ jobId: null, totalPages: 0, status: 'skipped' })
    setError(null)
    setStep(4)
  }

  const handleStep4 = () => {
    setError(null)
    setStep(5)
  }

  const handleStep5 = (_result: ActivationResult) => {
    if (clientId) {
      router.push(`/dashboard/clients/${clientId}`)
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
      setError(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Add a New Client</h1>
          <p className="text-slate-600 text-sm">5 steps · ~10 minutes</p>
        </div>

        <StepIndicator currentStep={step} totalSteps={5} labels={STEP_LABELS} />

        <div className="bg-white rounded-2xl shadow-lg p-8 mt-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <Step1BasicInfo initial={step1} onSubmit={handleStep1} loading={loading} />
          )}

          {step === 2 && clientId && (
            <Step2BriefUpload
              clientId={clientId}
              initial={step2}
              onSubmit={handleStep2}
              onSkip={handleStep2Skip}
              onBack={handleBack}
              loading={loading}
            />
          )}

          {step === 3 && clientId && (
            <Step3DnzCrawl
              clientId={clientId}
              domain={step1.domain}
              initial={step3}
              onComplete={handleStep3}
              onSkip={handleStep3Skip}
              onBack={handleBack}
            />
          )}

          {step === 4 && clientId && (
            <Step4ReviewPages clientId={clientId} onContinue={handleStep4} onBack={handleBack} />
          )}

          {step === 5 && clientId && (
            <Step5Activate
              clientId={clientId}
              domain={step1.domain}
              storagePaths={step2.storagePaths}
              websiteUrls={step2.websiteUrls}
              onComplete={handleStep5}
              onBack={handleBack}
            />
          )}
        </div>
      </div>
    </div>
  )
}
