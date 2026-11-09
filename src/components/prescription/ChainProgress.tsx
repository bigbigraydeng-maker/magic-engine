'use client'

import { useEffect, useState } from 'react'
import type { ChainStatus, ChainStep } from '@/lib/prescription-chain/types'

const TONE: Record<ChainStep['state'], string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  active: 'border-sky-200 bg-sky-50 text-sky-950',
  blocked: 'border-amber-300 bg-amber-50 text-amber-950',
  unread: 'border-gray-300 bg-gray-50 text-gray-700',
  waiting: 'border-gray-200 bg-white text-gray-400',
}

function showDetail(step: ChainStep): boolean {
  return (step.state === 'blocked' || step.state === 'active') && step.detail.trim() !== ''
}

function useChain(clientId: string, prescriptionId: string): ChainStatus | 'loading' | 'unread' {
  const [chain, setChain] = useState<ChainStatus | 'loading' | 'unread'>('loading')
  useEffect(() => {
    let cancelled = false
    const url = `/api/clients/${encodeURIComponent(clientId)}/prescription/${encodeURIComponent(prescriptionId)}/chain`
    const run = typeof fetch === 'function'
      ? fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      : Promise.reject(new Error('unread'))
    run
      .then(async (res) => {
        if (!res.ok) throw new Error('unread')
        return res.json() as Promise<{ chain?: ChainStatus }>
      })
      .then((body) => {
        if (!cancelled) setChain(body.chain?.steps ? body.chain : 'unread')
      })
      .catch(() => {
        if (!cancelled) setChain('unread')
      })
    return () => {
      cancelled = true
    }
  }, [clientId, prescriptionId])
  return chain
}

function StepList({ chain }: { chain: ChainStatus }) {
  return (
    <ol className="mt-3 flex flex-wrap gap-2" aria-label="链路进度">
      {chain.steps.map((step) => (
        <li key={step.id} data-state={step.state} className={`min-w-[4.5rem] max-w-[11rem] rounded-md border px-2 py-1 text-xs ${TONE[step.state]}`}>
          <div className="font-medium">{step.label}</div>
          <div>{step.stateLabel}</div>
          {showDetail(step) ? <p className="mt-1 leading-4">{step.detail}</p> : null}
        </li>
      ))}
    </ol>
  )
}

/** Nine-step chain bar. Fetches the read-only chain route. Does not change the page around it. */
export function ChainProgress({
  clientId,
  prescriptionId,
}: {
  clientId: string
  prescriptionId: string
}) {
  const chain = useChain(clientId, prescriptionId)
  if (chain === 'loading') return <p className="mt-3 text-xs text-gray-500">正在看走到哪一步。</p>
  if (chain === 'unread') return <p className="mt-3 text-xs text-gray-600">读不到</p>
  return <StepList chain={chain} />
}
