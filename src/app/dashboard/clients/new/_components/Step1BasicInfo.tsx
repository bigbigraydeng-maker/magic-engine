'use client'

import { useState } from 'react'

export interface Step1Data {
  name: string
  domain: string
  targetMarket: 'au' | 'nz' | 'other'
}

interface Props {
  initial: Partial<Step1Data>
  onSubmit: (data: Step1Data) => void
  loading: boolean
}

function isValidDomain(url: string): boolean {
  try {
    if (!url.includes('://')) {
      new URL(`https://${url}`)
    } else {
      new URL(url)
    }
    return true
  } catch {
    return false
  }
}

export default function Step1BasicInfo({ initial, onSubmit, loading }: Props) {
  const [name, setName] = useState(initial.name ?? '')
  const [domain, setDomain] = useState(initial.domain ?? '')
  const [targetMarket, setTargetMarket] = useState<'au' | 'nz' | 'other'>(
    initial.targetMarket ?? 'au'
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = 'Customer name is required'
    if (!domain.trim()) {
      newErrors.domain = '请输入域名'
    } else if (!isValidDomain(domain)) {
      newErrors.domain = 'Please enter a valid domain (e.g., example.com)'
    }

    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    onSubmit({
      name: name.trim(),
      domain: domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
      targetMarket,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-me-charcoal/90 mb-1">Basic Information</h2>
        <p className="text-me-charcoal/60 text-sm">Tell us about the customer you&apos;re onboarding</p>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-me-charcoal/75 mb-2">
          Customer Name <span className="text-[#C2453A]">*</span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., CTS Tours Aotearoa"
          className={`w-full px-4 py-2 rounded-lg border transition-colors text-me-charcoal/90 ${
            errors.name
              ? 'border-[#C2453A] bg-[#C2453A]/10'
              : 'border-black/15 bg-white hover:border-black/20'
          } focus:outline-none focus:ring-2 focus:ring-me-ochre`}
          disabled={loading}
        />
        {errors.name && <p className="mt-1 text-sm text-[#C2453A]">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-medium text-me-charcoal/75 mb-2">
          Website Domain <span className="text-[#C2453A]">*</span>
        </label>
        <input
          id="domain"
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="e.g., ctstours.co.nz"
          className={`w-full px-4 py-2 rounded-lg border transition-colors text-me-charcoal/90 ${
            errors.domain
              ? 'border-[#C2453A] bg-[#C2453A]/10'
              : 'border-black/15 bg-white hover:border-black/20'
          } focus:outline-none focus:ring-2 focus:ring-me-ochre`}
          disabled={loading}
        />
        <p className="mt-1 text-xs text-me-charcoal/45">
          张骞将自动扫描该域名，生成业务画像、竞品、关键词和 AI 问句。
        </p>
        {errors.domain && <p className="mt-1 text-sm text-[#C2453A]">{errors.domain}</p>}
      </div>

      <div>
        <label htmlFor="market" className="block text-sm font-medium text-me-charcoal/75 mb-2">
          Primary Market <span className="text-[#C2453A]">*</span>
        </label>
        <select
          id="market"
          value={targetMarket}
          onChange={(e) => setTargetMarket(e.target.value as 'au' | 'nz' | 'other')}
          className="w-full px-4 py-2 rounded-lg border border-black/15 bg-white text-me-charcoal/90 hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-me-ochre transition-colors disabled:opacity-50"
          disabled={loading}
        >
          <option value="au">Australia (AU)</option>
          <option value="nz">New Zealand (NZ)</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="pt-4">
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-me-ochre hover:bg-me-ochre disabled:bg-me-charcoal/25 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? '正在创建客户…' : '🧭 派遣张骞'}
        </button>
      </div>
    </form>
  )
}
