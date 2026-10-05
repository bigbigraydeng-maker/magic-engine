'use client'

/**
 * 「电话前 30 秒」：销售拨号前该知道的几样事，摆在抽屉最上面。
 *
 * 只展示，不写任何东西、不发任何消息。数据全部来自已有的私信需求卡
 * （`conversation_briefs`）和往来记录，由时间线接口顺带算好（`lib/crm/precall-card`）。
 * 缺项提示（「电话里要问」）和「已超过承诺时间」的判据都在服务端那一份，这里只管画。
 */

import type { PrecallCard } from '@/lib/crm/precall-card'
import type { PrecallBrief } from '@/lib/crm/precall-brief'

const NZ_TZ = 'Pacific/Auckland'

const INTENT_LABEL: Record<string, string> = {
  high: '意向高',
  medium: '意向中',
  low: '意向低',
  unknown: '意向不明',
}

/** 新西兰时间的「月/日 时:分」，跟销售所在时区一致。 */
function fmtNz(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', {
    timeZone: NZ_TZ,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function tripChips(trip: PrecallBrief['trip']): string[] {
  const chips: string[] = []
  if (trip.tour_interest) chips.push(`想去：${trip.tour_interest}`)
  if (trip.travel_window) chips.push(`${trip.travel_window} 走`)
  if (trip.party_size !== null) chips.push(`${trip.party_size} 人`)
  if (trip.departure_city) chips.push(`${trip.departure_city} 出发`)
  if (trip.first_time_to_china !== null) chips.push(trip.first_time_to_china ? '第一次去' : '去过')
  if (trip.budget_signal) chips.push(`预算：${trip.budget_signal}`)
  return chips
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: 'normal' | 'warn' }) {
  if (items.length === 0) return null
  const cls = tone === 'warn' ? 'text-red-700' : 'text-me-charcoal/80'
  return (
    <div className="mt-2">
      <p className={`text-[11px] font-bold ${cls}`}>{title}</p>
      <ul className={`mt-0.5 list-disc pl-4 text-[12px] leading-relaxed ${cls}`}>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

function StatusBadges({ lead }: { lead: PrecallCard['lead'] }) {
  if (!lead.isFormLead) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {lead.overdue && (
        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-black text-white">
          已超过承诺时间（应在 {fmtNz(lead.dueAt)} 前联系）
        </span>
      )}
      {lead.guestReplied === true && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
          客人已回复
        </span>
      )}
      {lead.guestReplied === false && (
        <span className="rounded-full bg-me-charcoal/10 px-2 py-0.5 text-[11px] font-bold text-me-charcoal/70">
          客人还没回复
        </span>
      )}
    </div>
  )
}

export function PrecallBriefCard({ card }: { card: PrecallCard }) {
  const { brief, lead, briefReadFailed } = card
  const border = lead.overdue ? 'border-red-300 bg-red-50' : 'border-me-ochre/25 bg-me-ochre/[0.06]'
  return (
    <div className={`mb-3 rounded-xl border px-3 py-2.5 ${border}`} data-testid="precall-brief-card">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-me-ochre">电话前 30 秒</p>
      <StatusBadges lead={lead} />
      {briefReadFailed && (
        <p className="mt-1.5 text-[12px] font-bold text-red-700">需求卡没读出来，请刷新再试。</p>
      )}
      {brief && (
        <>
          {brief.summary && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-me-charcoal/90">
              {brief.intentLevel && (
                <span className="mr-1 font-bold">[{INTENT_LABEL[brief.intentLevel]}]</span>
              )}
              {brief.summary}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {tripChips(brief.trip).map((c) => (
              <span key={c} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-me-charcoal/75">
                {c}
              </span>
            ))}
          </div>
          {(brief.phone || brief.email) && (
            <p className="mt-2 text-[12px] text-me-charcoal/80">
              {brief.phone && <span className="mr-3">电话：{brief.phone}</span>}
              {brief.email && <span>邮箱：{brief.email}</span>}
            </p>
          )}
          <ListBlock title="我们答应过客人" items={brief.promisesMade} tone="normal" />
          <ListBlock title="要留意" items={brief.riskFlags} tone="warn" />
          {brief.nextAction && (
            <p className="mt-2 text-[12px] text-me-charcoal/80">
              <span className="font-bold">建议下一步：</span>
              {brief.nextAction}
            </p>
          )}
          {brief.askMissing.length > 0 && (
            <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[12px] font-bold text-me-charcoal/80">
              电话里要问：{brief.askMissing.join('、')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
