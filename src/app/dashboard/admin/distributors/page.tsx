'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, ErrorBox, errorText, postJson, type ApiError, type Catalog, type Distributor, type Sale } from './shared'
import { DistributorTable } from './distributor-table'
import { NewDistributorForm } from './new-distributor-form'
import { SaleForm } from './sale-form'
import { SalesTable } from './sales-table'

export default function DistributorsPage() {
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [salesLoading, setSalesLoading] = useState(true)
  const [error, setError] = useState('')
  const [salesError, setSalesError] = useState('')
  const [decisionErr, setDecisionErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadDistributors = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/distributors')
      const json: unknown = await res.json()
      if (res.ok) {
        const data = json as { distributors: Distributor[] }
        setDistributors(data.distributors)
        setError('')
      } else {
        setError(errorText(json as ApiError) || '加载经销商失败')
      }
    } catch {
      setError('加载经销商失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSales = useCallback(async () => {
    setSalesLoading(true)
    try {
      const res = await fetch('/api/admin/distributors/sales')
      const json: unknown = await res.json()
      if (res.ok) {
        const data = json as { sales: Sale[]; catalog: Catalog }
        setSales(data.sales)
        setCatalog(data.catalog)
        setSalesError('')
      } else {
        setSalesError(errorText(json as ApiError) || '加载销售记录失败')
      }
    } catch {
      setSalesError('加载销售记录失败')
    } finally {
      setSalesLoading(false)
    }
  }, [])

  const reloadAll = useCallback(() => {
    void loadDistributors()
    void loadSales()
  }, [loadDistributors, loadSales])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  const approved = useMemo(
    () => distributors.filter((d) => d.status === 'approved'),
    [distributors]
  )

  const handleDecision = async (
    d: Distributor,
    decision: 'approve' | 'reject' | 'suspend' | 'reinstate'
  ) => {
    setDecisionErr('')
    const name = d.display_name
    const message =
      decision === 'approve'
        ? `确定批准「${name}」成为经销商？`
        : decision === 'reject'
        ? `确定拒绝「${name}」的申请？`
        : decision === 'suspend'
        ? `确定停用「${name}」？停用期间收益照算但不发。`
        : `确定恢复「${name}」？`
    if (!window.confirm(message)) return
    setBusyId(d.id)
    const res = await postJson<{ distributor: Distributor }>(
      `/api/admin/distributors/${d.id}/decision`,
      { decision }
    )
    setBusyId(null)
    if (!res.ok) {
      setDecisionErr(errorText(res.err))
      return
    }
    reloadAll()
  }

  return (
    <div className="min-h-screen bg-me-ivory py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
            经销商管理
          </h1>
          <p className="mt-1 text-sm text-me-charcoal/55">
            这里只记账，不会付钱。每月付款要另外批准。
          </p>
        </div>

        {error && (
          <div className="mb-8 rounded-2xl bg-[#C2453A]/10 px-6 py-4 text-sm font-medium text-[#C2453A]">
            {error}
          </div>
        )}

        <Card title="经销商名单">
          <ErrorBox message={decisionErr} />
          <DistributorTable
            distributors={distributors}
            loading={loading}
            onDecision={handleDecision}
            busyId={busyId}
          />
        </Card>

        <Card title="新增经销商">
          <NewDistributorForm approved={approved} onCreated={reloadAll} />
        </Card>

        <Card title="录一笔销售">
          <SaleForm approved={approved} catalog={catalog} onCreated={reloadAll} />
        </Card>

        <Card title="最近的销售和退款">
          <ErrorBox message={salesError} />
          <SalesTable
            sales={sales}
            distributors={distributors}
            catalog={catalog}
            loading={salesLoading}
            onRefunded={reloadAll}
          />
        </Card>
      </div>
    </div>
  )
}
