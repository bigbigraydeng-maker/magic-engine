/**
 * 跟进进度页里一组客人的名单：名字、什么时候填的表、什么时候来过信或电话、上次什么时候有人打过或发过信，点名字进客人记录。
 * 不显示邮箱和电话，联系方式在客人记录里看。
 */

import Link from 'next/link'
import { GROUP_LIST_MAX, type GroupList } from '@/lib/crm/followup-progress/group-list'
import { groupMeta } from '@/lib/crm/followup-progress/groups'

function day(iso: string | null, timeZone: string): string {
  if (iso === null || !Number.isFinite(Date.parse(iso))) return '—'
  return new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).format(new Date(iso))
}

export function GroupListView({ clientId, list, timeZone }: { clientId: string; list: GroupList; timeZone: string }): JSX.Element {
  const meta = groupMeta()[list.group]
  const base = `/dashboard/clients/${clientId}/crm`
  return (
    <>
      <p className="mb-3 text-sm"><Link className="underline" href={`${base}/followup-progress`}>← 回到跟进进度</Link></p>
      <h1 className="text-lg font-semibold text-me-charcoal">{meta.label}（{list.total} 位）</h1>
      <p className="mb-4 mt-1 text-sm text-me-charcoal/70">{meta.howTo}</p>
      {list.total === 0 ? (
        <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">这一组现在没有人。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[12.5px] text-me-charcoal/60">
                <th className="py-2 pr-4 font-normal">客人</th>
                <th className="py-2 pr-4 font-normal">最近填表</th>
                <th className="py-2 pr-4 font-normal">最近来信或来电</th>
                <th className="py-2 font-normal">上次打过或发过信</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.contactId} className="border-t border-me-charcoal/10">
                  <td className="py-2.5 pr-4"><Link className="font-medium text-me-charcoal underline" href={`${base}/all?contact=${r.contactId}`}>{r.name}</Link></td>
                  <td className="py-2.5 pr-4 tabular-nums text-me-charcoal/80">{day(r.lastEnquiryAt, timeZone)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-me-charcoal/80">{day(r.lastGuestMessageAt, timeZone)}</td>
                  <td className="py-2.5 tabular-nums text-me-charcoal/80">{day(r.lastStaffAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.total > list.rows.length ? <p className="mt-3 text-[12.5px] text-me-charcoal/70">这里只列最新的 {GROUP_LIST_MAX} 位，这一组一共 {list.total} 位。</p> : null}
      <p className="mt-6 text-[12.5px] leading-relaxed text-me-charcoal/60">
        最新的排在最前面。「上次打过或发过信」只认系统里记下的电话、邮件和 WhatsApp；员工用自己手机打的看不到，所以打之前先看一眼客人记录。
      </p>
    </>
  )
}
