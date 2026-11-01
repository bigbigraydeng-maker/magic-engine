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
        点「确认」或「不做」才算数。标题是「批准建 Meta 暂停草稿并送审」的那张，点了确认才会去建暂停草稿。建成后仍是暂停，不会开启，也不会花钱。标题是「批准推广计划草稿（只改计划状态，不开投）」的那张，点了确认会批准这份计划，仍然不开投、不花钱。其他卡点了只是记下。
      </p>
      <CardList clientId={params.id} />
    </main>
  )
}
