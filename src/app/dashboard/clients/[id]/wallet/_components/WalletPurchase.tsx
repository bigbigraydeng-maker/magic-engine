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
        className="flex h-11 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_12px_36px_rgba(196,145,46,.18)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
      >
        {loading ? 'Loading…' : 'Purchase'}
      </button>
      {error && (
        <p className="mt-2 text-xs font-semibold text-[#C2453A]">{error}</p>
      )}
    </div>
  )
}
