'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface MtcClient {
  clientId: string
  name: string
  currentBalance: number
  thisMonthSpend: number
}

interface MtcOverviewData {
  totalBalanceMtc: number
  totalRevenue: number
  totalSoldMtc: number
  totalConsumedMtc: number
  clients: MtcClient[]
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="h-3 w-28 animate-pulse rounded bg-me-charcoal/10 mb-4" />
      <div className="h-8 w-20 animate-pulse rounded bg-me-charcoal/10" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr>
      <td className="px-6 py-4">
        <div className="h-3 w-32 animate-pulse rounded bg-me-charcoal/10" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-20 animate-pulse rounded bg-me-charcoal/10 ml-auto" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-20 animate-pulse rounded bg-me-charcoal/10 ml-auto" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-16 animate-pulse rounded bg-me-charcoal/10 ml-auto" />
      </td>
    </tr>
  )
}

export default function MtcOverviewPage() {
  const [data, setData] = useState<MtcOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/admin/mtc/overview')
        const json = await res.json()
        if (res.ok) {
          setData(json)
        } else {
          setError((json as { error?: string }).error ?? 'Failed to load MTC overview')
        }
      } catch {
        setError('Failed to load MTC overview')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  return (
    <div className="min-h-screen bg-me-ivory py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
            MTC Overview
          </h1>
          <p className="mt-1 text-sm text-me-charcoal/55">
            Magic Token Credit balances, revenue, and consumption across all clients
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 rounded-2xl bg-[#C2453A]/10 px-6 py-4 text-sm font-medium text-[#C2453A]">
            {error}
          </div>
        )}

        {/* Stat Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : data ? (
            <>
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                  Total Balance (unredeemed)
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
                  {data.totalBalanceMtc.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-me-charcoal/45">MTC</p>
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                  Total Revenue
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
                  ${data.totalRevenue.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-0.5 text-xs text-me-charcoal/45">NZD</p>
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                  Total Sold
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
                  {data.totalSoldMtc.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-me-charcoal/45">MTC</p>
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                  Total Consumed
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
                  {data.totalConsumedMtc.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-me-charcoal/45">MTC</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Client Table */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-black/[0.06] px-6 py-4">
            <h2 className="text-base font-bold text-me-charcoal/90">Client Balances</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-me-ivory">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                    Client Name
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                    Current Balance (MTC)
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                    This Month Spent (MTC)
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
                    Wallet
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {loading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : !data || data.clients.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-10 text-center text-sm text-me-charcoal/45"
                    >
                      No clients with active MTC balances
                    </td>
                  </tr>
                ) : (
                  data.clients.map((client) => (
                    <tr key={client.clientId} className="hover:bg-me-ivory/60 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-me-charcoal/90">
                        {client.name}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-bold tabular-nums">
                        <span
                          className={
                            client.currentBalance === 0
                              ? 'text-[#C2453A]'
                              : 'text-me-charcoal/90'
                          }
                        >
                          {client.currentBalance.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm tabular-nums text-me-charcoal/75">
                        {client.thisMonthSpend.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/dashboard/clients/${client.clientId}/wallet`}
                          className="text-xs font-bold text-me-ochre hover:underline"
                        >
                          View wallet →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
