'use client'

import { Suspense, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const signals = [
  'Search demand and ranking gaps',
  'AI visibility and answer coverage',
  'Competitor positioning',
  'Social proof and review signals',
  'Website health and conversion friction',
  'Priority actions your team can approve',
]

const reportSections = [
  { label: 'Brand health', value: '6 signals' },
  { label: 'Quick wins', value: 'Ranked' },
  { label: 'Next step', value: 'Action plan' },
]

const workflow = [
  { label: 'Submit website', state: 'Now' },
  { label: 'Discovery scan', state: '3-5 min' },
  { label: 'Report link', state: 'Email' },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">
      M
    </div>
  )
}

function ReportPreview() {
  return (
    <div className="border border-white/10 bg-white/[0.08] p-4 text-white shadow-2xl backdrop-blur-sm lg:w-[460px]">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <p className="text-sm font-bold">Discovery report</p>
          <p className="text-[11px] text-slate-300">Prospect view</p>
        </div>
        <span className="rounded-lg bg-cyan-300/15 px-3 py-1.5 text-xs font-bold text-cyan-100">
          Live scan
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {reportSections.map(item => (
          <div key={item.label} className="rounded-lg bg-slate-950/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-5 text-base font-black text-white">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-slate-950/60 p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold">Execution readiness</p>
          <p className="text-xs font-semibold text-emerald-200">72%</p>
        </div>
        <div className="h-2 rounded-lg bg-white/10">
          <div className="h-2 rounded-lg bg-emerald-300" style={{ width: '72%' }} />
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-300">
          Your report turns findings into ranked actions, so the next conversation starts with
          what to fix first.
        </p>
      </div>
    </div>
  )
}

function SuccessView({ email }: { email: string }) {
  return (
    <div className="py-4">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-900">
        OK
      </div>
      <h2 className="text-2xl font-black text-slate-950">Check your email</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        We sent a secure magic link to <span className="font-bold text-slate-950">{email}</span>.
        Your Discovery Report is already scanning.
      </p>
      <div className="mt-6 grid gap-2">
        {workflow.slice(1).map(item => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <span className="text-sm font-bold text-slate-800">{item.label}</span>
            <span className="text-xs font-semibold text-slate-500">{item.state}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-500">
        The link expires in 15 minutes. If it is not in your inbox, check spam or try the scan again.
      </p>
    </div>
  )
}

function DiscoverForm() {
  const searchParams = useSearchParams()
  const prefillUrl = searchParams.get('url') ?? ''

  const [url, setUrl] = useState(prefillUrl)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim() || !email.trim()) {
      setError('Please enter your website URL and email address.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/discover/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), name: name.trim(), email: email.trim() }),
      })

      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      setSent(true)
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  if (sent) return <SuccessView email={email} />

  const fieldClass = 'mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5'

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-4">
        <div>
          <label htmlFor="website-url" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            Website URL
          </label>
          <input
            id="website-url"
            type="text"
            inputMode="url"
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder="yourwebsite.com.au"
            required
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="name" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            Your name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Jane Smith"
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="email" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="jane@yourcompany.com.au"
            required
            className={fieldClass}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`mt-5 flex h-12 w-full items-center justify-center rounded-lg text-sm font-black transition ${
          loading
            ? 'cursor-wait bg-slate-300 text-slate-600'
            : 'bg-slate-950 text-white hover:bg-slate-800'
        }`}
      >
        {loading ? 'Sending secure link...' : 'Start free diagnosis'}
      </button>

      <p className="mt-3 text-center text-xs leading-5 text-slate-500">
        Free diagnosis. No credit card. Magic link access only.
      </p>
    </form>
  )
}

export default function DiscoverPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-white"
          >
            Back home
          </Link>
        </header>

        <div className="relative z-10 grid gap-10 px-5 pb-14 pt-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_520px] lg:items-start lg:pb-20 lg:pt-16">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              Free prospect diagnosis
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Start with your website. Leave with a ranked action plan.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Magic Engine scans your public digital footprint, turns weak spots into business
              priorities, and sends your secure report link by email.
            </p>

            <div className="mt-8 hidden gap-2 sm:grid sm:grid-cols-3">
              {workflow.map(item => (
                <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
                  <p className="text-sm font-black text-white">{item.label}</p>
                  <p className="mt-5 text-xs font-semibold text-cyan-100">{item.state}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 hidden lg:block">
              <ReportPreview />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#f6f7f2] p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-5 border-b border-slate-200 pb-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                Discovery request
              </p>
              <h2 className="mt-2 text-2xl font-black">Get your report link</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                We start the scan immediately and send the private report link to your inbox.
              </p>
            </div>

            <Suspense fallback={<p className="py-10 text-center text-sm text-slate-500">Loading form...</p>}>
              <DiscoverForm />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            What the scan checks
          </p>
          <h2 className="mt-2 text-3xl font-black leading-tight">
            A prospect view that feels like the client portal later.
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {signals.map((signal, index) => (
            <div key={signal} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                {String(index + 1).padStart(2, '0')}
              </p>
              <p className="mt-3 text-sm font-bold leading-5 text-slate-800">{signal}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
