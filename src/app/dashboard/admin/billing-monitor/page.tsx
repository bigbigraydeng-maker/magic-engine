'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BillingData {
  month: string
  totalCost: number
  totalApiCalls: number
  costsByService: Record<string, number>
  byClient: Array<{
    clientId: string
    service: string
    apiCalls: number
    costUsd: number
  }>
}

export default function BillingMonitorPage() {
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [billingData, setBillingData] = useState<BillingData | null>(null)
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // Fetch available months on mount
  useEffect(() => {
    const fetchMonths = async () => {
      try {
        const res = await fetch('/api/admin/billing/datasources')
        const data = await res.json()
        if (data.availableMonths) {
          setAvailableMonths(data.availableMonths)
          if (data.availableMonths.length > 0) {
            setSelectedMonth(data.availableMonths[0])
          }
        }
      } catch (err) {
        // Silently fail - no months available yet
      }
    }
    fetchMonths()
  }, [])

  // Fetch billing data when month changes
  useEffect(() => {
    if (!selectedMonth) return

    const fetchBillingData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/admin/billing/datasources?month=${selectedMonth}`)
        const data = await res.json()

        if (res.ok) {
          setBillingData(data)
        } else {
          setError(data.error || 'Failed to fetch billing data')
        }
      } catch (err) {
        setError('Failed to fetch billing data')
      } finally {
        setLoading(false)
      }
    }

    fetchBillingData()
  }, [selectedMonth])

  return (
    <div className="min-h-screen bg-me-ivory py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">💳</span>
            <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90">Billing Monitor</h1>
          </div>
          <p className="text-me-charcoal/60">Track DataForSEO API usage and costs by client and month</p>
        </div>

        {/* Month Selector */}
        <div className="mb-8 bg-white rounded-lg shadow p-6">
          <label className="block text-sm font-medium text-me-charcoal/75 mb-2">
            Select Month
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="block w-full rounded-md border border-black/15 bg-white text-me-charcoal/90 px-3 py-2 shadow-sm focus:border-me-ochre focus:outline-none focus:ring-me-ochre"
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-8 rounded-md bg-[#C2453A]/10 p-4 text-[#C2453A]">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {billingData && !loading && (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
              {/* Total Cost Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-me-charcoal/60">Total Cost</p>
                <p className="mt-2 text-3xl font-display font-bold tracking-tight text-me-charcoal/90">
                  ${billingData.totalCost.toFixed(2)}
                </p>
              </div>

              {/* Total API Calls Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-me-charcoal/60">Total API Calls</p>
                <p className="mt-2 text-3xl font-display font-bold tracking-tight text-me-charcoal/90">
                  {billingData.totalApiCalls.toLocaleString()}
                </p>
              </div>

              {/* Services Count Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-me-charcoal/60">Services</p>
                <p className="mt-2 text-3xl font-display font-bold tracking-tight text-me-charcoal/90">
                  {Object.keys(billingData.costsByService).length}
                </p>
              </div>
            </div>

            {/* Costs by Service */}
            <div className="mb-8 bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-black/10">
                <h2 className="text-lg font-semibold text-me-charcoal/90">Costs by Service</h2>
              </div>
              <div className="divide-y divide-black/10">
                {Object.entries(billingData.costsByService).map(([service, cost]) => (
                  <div key={service} className="px-6 py-4 flex justify-between">
                    <span className="text-me-charcoal/90">{service}</span>
                    <span className="font-semibold text-me-charcoal/90">
                      ${Number(cost).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Breakdown */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-black/10">
                <h2 className="text-lg font-semibold text-me-charcoal/90">Breakdown by Client & Service</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-me-ivory">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-me-charcoal/90">
                        Client ID
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-me-charcoal/90">
                        Service
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-me-charcoal/90">
                        API Calls
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-me-charcoal/90">
                        Cost (USD)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {billingData.byClient.map((log, idx) => (
                      <tr key={idx} className="hover:bg-me-ivory">
                        <td className="px-6 py-4 text-sm text-me-charcoal/90">
                          <Link
                            href={`/dashboard/clients/${log.clientId}`}
                            className="text-me-ochre hover:text-me-ochre"
                          >
                            {log.clientId.substring(0, 8)}...
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-sm text-me-charcoal/90">{log.service}</td>
                        <td className="px-6 py-4 text-sm text-right text-me-charcoal/90">
                          {log.apiCalls.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-me-charcoal/90">
                          ${log.costUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="inline-flex items-center gap-2 text-me-charcoal/60">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/15 border-t-me-ochre"></div>
              Loading billing data...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
