'use client'

import { useState } from 'react'
import type { PackageKey } from '@/lib/mtc/types'

interface Props {
  clientId: string
  packageKey: PackageKey
}

export default function WalletPurchase({ clientId, packageKey }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handlePurchase() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/mtc/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, packageKey }),
      })
      const data = await res.json()
      if (!res.ok || !data.checkoutUrl) {
        setError(data.error ?? 'Checkout failed. Please try again.')
        return
      }
      window.location.href = data.checkoutUrl
    } catch {
      setError('Unable to start checkout. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={handlePurchase}
        disabled={loading}
        className={`flex h-11 w-full items-center justify-center rounded-lg text-sm font-black transition ${
          loading
            ? 'cursor-wait bg-slate-200 text-slate-500'
            : 'bg-slate-950 text-white hover:bg-slate-800'
        }`}
      >
        {loading ? 'Loading…' : 'Purchase'}
      </button>
      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      )}
    </div>
  )
}
