'use client'

import { useState } from 'react'

export default function RegisterForm() {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    websiteUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          businessName: form.businessName.trim(),
          websiteUrl: form.websiteUrl.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Unable to register. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="py-4">
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-900">
          OK
        </div>
        <h2 className="text-2xl font-black text-slate-950">Check your email</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          We sent a confirmation link to{' '}
          <span className="font-bold text-slate-950">{form.email}</span>.
          Click the link to activate your account and receive your <strong>500 MTC</strong> welcome bonus.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="businessName" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Business name
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          value={form.businessName}
          onChange={handleChange}
          placeholder="Acme Co"
          className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
        />
      </div>

      <div>
        <label htmlFor="email" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={handleChange}
          placeholder="you@company.com"
          className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={handleChange}
          placeholder="At least 8 characters"
          className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
        />
      </div>

      <div>
        <label htmlFor="websiteUrl" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Website URL <span className="font-medium text-slate-400">(optional)</span>
        </label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={handleChange}
          placeholder="https://yoursite.com.au"
          className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`flex h-12 w-full items-center justify-center rounded-lg text-sm font-black transition ${
          loading
            ? 'cursor-wait bg-slate-300 text-slate-600'
            : 'bg-slate-950 text-white hover:bg-slate-800'
        }`}
      >
        {loading ? 'Creating account…' : 'Create account — free'}
      </button>
    </form>
  )
}
