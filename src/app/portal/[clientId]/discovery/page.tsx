import { supabaseAdmin } from '@/lib/supabase'
import { ReportView } from '@/components/prospect/ProspectReportView'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

interface Props {
  params: { clientId: string }
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  })
}

export default async function PortalDiscoveryPage({ params }: Props) {
  const { clientId } = params

  const { data: discovery } = await supabaseAdmin
    .from('client_discovery')
    .select('domain, payload, generated_at')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!discovery?.payload) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
        <p className="text-sm font-bold text-slate-700">No Discovery Report available yet.</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your Discovery Report will appear here once your initial scan is complete.
        </p>
      </div>
    )
  }

  const report = discovery.payload as unknown as DiscoveryReport
  const scannedDate = formatDate(discovery.generated_at)

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Discovery report
        </p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">
          {report.business?.name ?? discovery.domain}
        </h1>
        {scannedDate && (
          <p className="mt-1 text-sm text-slate-500">Scanned {scannedDate}</p>
        )}
      </div>

      <ReportView report={report} />
    </div>
  )
}
