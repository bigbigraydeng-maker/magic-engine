'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ContentHub } from '../_components/ContentHub'
import { BriefGateBanner } from '../_components/BriefGateBanner'

export default function CampaignsPage() {
  const params = useParams()
  const clientId = params.id as string
  const [clientName, setClientName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${clientId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data?.client?.name) setClientName(data.client.name) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clientId])

  return (
    <div className="min-h-screen space-y-5 bg-[#f6f7f2] px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm font-semibold text-me-charcoal/45 hover:text-me-charcoal/75">
          ← {clientName ?? '客户首页'}
        </Link>
        <span className="text-me-charcoal/35">/</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal">推广活动</h1>
      </div>

      {/* Master Brief × Campaign = FDE 工作的上下文基座，内容生产应在某个活跃 Campaign 下进行。 */}
      <BriefGateBanner clientId={clientId} featureLabel="workspace production entry points">
        <section>
          <ContentHub clientId={clientId} />
        </section>
      </BriefGateBanner>
    </div>
  )
}
