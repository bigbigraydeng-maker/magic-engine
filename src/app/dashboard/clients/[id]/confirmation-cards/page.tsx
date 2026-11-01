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
        点「确认」或「不做」才算数。「批准推广计划草稿」卡会重新检查计划，符合条件才批；「批准建 Meta 暂停草稿并送审」卡点确认后才会建暂停草稿。落地页或表单核实卡只记下你看过。所有这些卡都不会开投，也不会花钱；其他卡点了只记下选择。
      </p>
      <CardList clientId={params.id} />
    </main>
  )
}
