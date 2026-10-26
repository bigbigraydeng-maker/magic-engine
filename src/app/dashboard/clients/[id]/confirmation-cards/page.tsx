import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { CardList } from './card-list'

export const dynamic = 'force-dynamic'

export default async function ConfirmationCardsPage({
  params,
}: {
  params: { id: string }
}) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const line = access.status === 401 ? '请先登录。' : '你不能看这位客户的确认卡。'
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-neutral-900">请确认</h1>
        <p className="mt-3 text-base text-neutral-800">{line}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">请确认</h1>
      <p className="mt-2 text-base text-neutral-700">
        点确认只是记下同意，不会改广告也不会花钱。
      </p>
      <CardList clientId={params.id} />
    </main>
  )
}
