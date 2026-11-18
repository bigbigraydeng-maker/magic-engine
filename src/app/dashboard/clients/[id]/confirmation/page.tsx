import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import ConfirmationGenerator from '@/components/confirmation/ConfirmationGenerator'

export const dynamic = 'force-dynamic'

export default async function ConfirmationPage({ params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return <Notice title="无权访问" body={access.error} />

  // 和 Tailor-made 行程单同一个行业闸：只给旅游业务用。
  if (!(await clientHasIndustryFeature(params.id, 'tailor_made'))) {
    const notice = INDUSTRY_FEATURE_NOTICE.tailor_made
    return <Notice title={notice.title} body={notice.body} />
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-8">
      <div className="mb-6 print:hidden">
        <Link href={`/dashboard/clients/${params.id}`} className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre">
          ← 返回工作台
        </Link>
        <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">确认单生成器</h1>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
          填好左边，右边就是客人收到的文件。可下载 PDF，或下载可再编辑的 Word。
        </p>
      </div>
      {/* key: switching client remounts, so one client's draft can never be saved under another */}
      <ConfirmationGenerator key={params.id} clientId={params.id} />
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center">
      <p className="font-black text-me-charcoal">{title}</p>
      <p className="mt-2 text-sm font-semibold text-me-charcoal/55">{body}</p>
    </div>
  )
}
