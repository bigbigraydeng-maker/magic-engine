import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { listItineraries } from '@/lib/tailor-made/store'
import { TAILOR_MADE_STATUS_LABEL, type TailorMadeSummary } from '@/lib/tailor-made/types'
import TailorMadeNewButton from './_components/TailorMadeNewButton'

export const dynamic = 'force-dynamic'

export default async function TailorMadeListPage({ params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return <Notice title="无权访问" body={access.error} />
  }

  let items: TailorMadeSummary[] = []
  let error: string | null = null
  try {
    items = await listItineraries(params.id)
  } catch (err) {
    error = err instanceof Error ? err.message : '读取失败'
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/clients/${params.id}`}
            className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
          >
            ← 返回工作台
          </Link>
          <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">Tailor-made 行程单</h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            定制行程报价单：填表 → 预览 → 导出 PDF 发给客户
          </p>
        </div>
        <TailorMadeNewButton clientId={params.id} />
      </div>

      {error && (
        <Notice
          title="读取行程单列表失败"
          body={error}
          hint="若提示表不存在，需先执行 supabase/migrations/20260728115948_tailor_made_itineraries.sql"
        />
      )}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
          <p className="font-black text-me-charcoal">还没有行程单</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            点右上角「新建行程单」开始第一份。
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
              <tr>
                <th className="px-4 py-3">报价编号</th>
                <th className="px-4 py-3">终端客户</th>
                <th className="px-4 py-3">行程</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">最近修改</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-black/5 last:border-0 hover:bg-me-ivory/60">
                  <td className="px-4 py-3 font-mono text-xs text-me-charcoal/70">{item.quote_ref}</td>
                  <td className="px-4 py-3 font-semibold text-me-charcoal">
                    {item.end_client_name || <span className="text-me-charcoal/35">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/clients/${params.id}/tailor-made/${item.id}`}
                      className="font-black text-me-charcoal hover:text-me-ochre"
                    >
                      {item.trip_title || '未命名行程'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-me-charcoal/45">
                    {formatWhen(item.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TailorMadeNewButton
                      clientId={params.id}
                      sourceId={item.id}
                      label="复制新建"
                      variant="ghost"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Notice({ title, body, hint }: { title: string; body: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-black text-[#C2453A]">{title}</p>
      <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{body}</p>
      {hint && <p className="mt-2 text-xs font-semibold text-me-charcoal/45">{hint}</p>}
    </div>
  )
}

function StatusChip({ status }: { status: TailorMadeSummary['status'] }) {
  const tone: Record<string, string> = {
    draft: 'bg-me-ivory text-me-charcoal/60 border-black/10',
    sent: 'bg-[#3E6E8C]/12 text-[#3E6E8C] border-[#3E6E8C]/30',
    confirmed: 'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30',
    archived: 'bg-me-ivory text-me-charcoal/35 border-black/5',
  }
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${
        tone[status] ?? tone.draft
      }`}
    >
      {TAILOR_MADE_STATUS_LABEL[status]}
    </span>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
