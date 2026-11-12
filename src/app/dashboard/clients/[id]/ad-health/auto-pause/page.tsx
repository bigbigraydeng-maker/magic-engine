import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { AutoPausePageView } from './auto-pause-page-view'

export const dynamic = 'force-dynamic'

/**
 * 自动暂停专属页（Figma 41-397）。
 *
 * 旧待办邮件和 `ad-health/auto-pause` 书签仍走这个网址。
 * 广告健康「等你点头」标签仍嵌入同款列表，但待办与侧栏以本页为准。
 */

export default async function AdsAutoPausePage({ params }: { params: { id: string } }) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const line = access.status === 401 ? '请先登录。' : '你不能看这位客户的自动暂停页。'
    return (
      <div className="px-6 py-10 md:px-10">
        <h1 className="font-display text-2xl font-bold text-me-charcoal">自动暂停</h1>
        <p className="mt-3 text-base text-me-charcoal/80">{line}</p>
      </div>
    )
  }

  return <AutoPausePageView clientId={params.id} />
}
