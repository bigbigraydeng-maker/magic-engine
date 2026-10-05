import { deletionStatus } from '@/lib/meta-oauth/data-deletion'

export const dynamic = 'force-dynamic'

const NOT_FOUND = 'We could not find this confirmation code. Please check the link was copied in full, or email hello@magicengine.cloud. / 没有找到这个确认码。请检查链接是否复制完整；有疑问请发邮件到 hello@magicengine.cloud。'
const ERROR = 'We could not check the status right now. Please try again later. / 暂时查不到进度，请稍后再试。'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export default async function DataDeletionStatusPage({
  searchParams,
}: {
  searchParams: { code?: string }
}) {
  const code = typeof searchParams.code === 'string' ? searchParams.code : ''
  let message = NOT_FOUND

  if (code) {
    try {
      const result = await deletionStatus(code)
      if (result) {
        const date = formatDate(result.receivedAt)
        message =
          result.status === 'completed'
            ? `Your data deletion request was completed on ${date}. / 你的删除数据申请已于 ${date} 完成。`
            : `We received and processed your request on ${date}. We held no data linked to this Facebook account, so nothing needed deleting and nothing remains. / 我们已于 ${date} 收到并处理了你的申请。我们这边本来就没有存这个 Facebook 账号的数据，所以不用删，也没有留下任何东西。`
      }
    } catch {
      message = ERROR
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Data deletion status</h1>
        <p className="mb-10 text-gray-700">{message}</p>
        <p className="text-sm text-gray-500">
          <a href="/data-deletion" className="text-indigo-600 underline">
            Data deletion
          </a>
        </p>
      </div>
    </div>
  )
}
