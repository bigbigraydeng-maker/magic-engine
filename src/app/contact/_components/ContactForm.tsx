'use client'

import Link from 'next/link'
import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

type ContactFormProps = {
  source?: string
  defaultMessage?: string
}

export default function ContactForm({ source, defaultMessage }: ContactFormProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const isTrainingLead = source === 'training'
  const isAdsLead = source === 'ads'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    const form = e.currentTarget
    const data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      company: (form.elements.namedItem('company') as HTMLInputElement).value,
      message: (form.elements.namedItem('message') as HTMLTextAreaElement).value,
      source: (form.elements.namedItem('source') as HTMLInputElement).value,
    }

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
      } else {
        setStatus('success')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    if (isTrainingLead) {
      return (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-100">
              <svg className="h-6 w-6 text-cyan-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-cyan-950">Training enquiry received</h3>
              <p className="mt-2 text-sm leading-6 text-cyan-900">
                Thanks. We&rsquo;ll reply within one business day with a suggested workshop format,
                the right language setup, and the next step that fits your team.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 rounded-lg border border-cyan-200 bg-white p-4 text-sm text-cyan-950 sm:grid-cols-2">
            <p className="font-semibold">What happens next</p>
            <ul className="grid gap-2 text-cyan-900">
              <li>We review your team size, language mix, and timing.</li>
              <li>We suggest a workshop shape that stays practical and local.</li>
              <li>If needed, we keep it to a consult before anything bigger.</li>
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/training"
              className="inline-flex h-11 items-center rounded-lg bg-cyan-950 px-4 text-sm font-bold text-white"
            >
              Back to training
            </Link>
            <a
              href="mailto:raydeng@magicengine.com.au"
              className="inline-flex h-11 items-center rounded-lg border border-cyan-300 px-4 text-sm font-bold text-cyan-950"
            >
              Email us directly
            </a>
          </div>
        </div>
      )
    }

    if (isAdsLead) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-6 w-6 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-amber-950">Ads enquiry received</h3>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Thanks. We&rsquo;ll reply within one business day with a suggested AU/NZ campaign
                shape, the right market focus, and the next step that fits your launch window.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 rounded-lg border border-amber-200 bg-white p-4 text-sm text-amber-950 sm:grid-cols-2">
            <p className="font-semibold">What happens next</p>
            <ul className="grid gap-2 text-amber-900">
              <li>We review target market, offer, budget, and timing.</li>
              <li>We suggest a light launch path that stays practical and local.</li>
              <li>If needed, we keep it as a consult before any heavier build.</li>
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-lg bg-amber-950 px-4 text-sm font-bold text-white"
            >
              Back to home
            </Link>
            <a
              href="mailto:raydeng@magicengine.com.au"
              className="inline-flex h-11 items-center rounded-lg border border-amber-300 px-4 text-sm font-bold text-amber-950"
            >
              Email us directly
            </a>
          </div>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-emerald-950">Message sent</h3>
        <p className="mt-2 text-sm text-emerald-800">
          Thanks for reaching out. We&rsquo;ll get back to you within one business day.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="source" value={source ?? ''} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold text-slate-700">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Your name"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-slate-700">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div>
        <label htmlFor="company" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Company <span className="text-xs font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="company"
          name="company"
          type="text"
          autoComplete="organization"
          placeholder="Your company or agency"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>

      <div>
        <label htmlFor="message" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          defaultValue={defaultMessage}
          placeholder="Tell us about your business and what you're looking for…"
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>

      {status === 'error' && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="flex h-12 w-full items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto sm:px-8"
      >
        {status === 'submitting' ? (
          <>
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            Sending…
          </>
        ) : (
          'Send message'
        )}
      </button>
    </form>
  )
}
