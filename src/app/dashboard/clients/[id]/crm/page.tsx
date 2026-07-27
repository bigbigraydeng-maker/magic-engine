'use client'

/**
 * 今天该联系谁。
 *
 * 分段照搬 PM 在 Google Sheet 第 4 个 tab 里手工维护的那份（客户已回信 →
 * 已约回电 → 新 lead 待首联），只是让系统自己算，不用人再填一遍状态。
 *
 * 手机优先：销售在外面用这一页，一屏一个人，电话邮箱点一下就拨。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Segment =
  | 'replied' | 'callback_due' | 'new_untouched'
  | 'retry_channel' | 'nurture_future' | 'excluded'

interface Row {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  segment: Segment
  temperature: 'hot' | 'warm' | 'cold' | 'off'
  reason: string
  suggestedChannel: 'phone' | 'sms' | 'email' | 'none'
  dueAt: string | null
  lastNote: string | null
}

interface Payload {
  worklist: Row[]
  counts: Record<Segment, number>
  totalContacts: number
  truncated: boolean
  error?: string
}

const SEGMENT_LABEL: Record<Segment, string> = {
  replied: '客户回话了',
  callback_due: '约好的时间到了',
  new_untouched: '新进线，没人碰过',
  retry_channel: '电话打不通',
  nurture_future: '以后才走',
  excluded: '别再联系',
}

/** 顺序即优先级，跟接口排出来的一致。 */
const GROUPS: Segment[] = ['replied', 'callback_due', 'new_untouched', 'retry_channel']

const CHANNEL_HINT: Record<Row['suggestedChannel'], string> = {
  phone: '打电话',
  sms: '发短信',
  email: '发邮件',
  none: '别联系',
}

function Stat({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-3 text-center">
      <p className={`text-2xl font-black ${strong && n > 0 ? 'text-[#C2453A]' : 'text-me-charcoal'}`}>{n}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-me-charcoal/45">{label}</p>
    </div>
  )
}

function PersonCard({ row }: { row: Row }) {
  const btn = 'rounded-lg border border-me-stone px-3 py-2 text-sm font-semibold text-me-charcoal'
  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate font-black text-me-charcoal">{row.name}</h3>
        <span className="shrink-0 rounded-full bg-me-charcoal px-2.5 py-1 text-[11px] font-black text-white">
          {CHANNEL_HINT[row.suggestedChannel]}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-me-charcoal/70">{row.reason}</p>

      {row.lastNote && (
        <p className="mt-2 rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/60">
          上次：{row.lastNote}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {row.phone && <a href={`tel:${row.phone}`} className={btn}>📞 {row.phone}</a>}
        {row.email && <a href={`mailto:${row.email}`} className={`${btn} break-all`}>✉️ {row.email}</a>}
      </div>
    </article>
  )
}

export default function CrmTodayPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/today`)
      const json = (await res.json()) as Payload
      if (!res.ok) { setError(json.error ?? '加载失败'); return }
      setData(json)
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">今天该联系谁</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          系统按所有渠道的接触记录自己排的 ——
          <span className="font-semibold text-me-charcoal/60">不用任何人去填状态。</span>
          说过别再联系的人已经被挡在名单外。
        </p>
      </header>

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm font-black text-me-charcoal underline">
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={data.counts.replied} label="回话了" strong />
            <Stat n={data.counts.callback_due} label="约好的到了" strong />
            <Stat n={data.counts.new_untouched} label="没人碰过" />
            <Stat n={data.counts.retry_channel} label="打不通" />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-me-charcoal/45">
            另有 <span className="font-semibold text-me-charcoal/70">{data.counts.nurture_future}</span> 人说了以后才走（现在打是打扰，进培育）、
            <span className="font-semibold text-me-charcoal/70"> {data.counts.excluded}</span> 人已排除（明确拒绝 / 号码作废）。
            共 {data.totalContacts} 人。
          </p>

          {data.worklist.length === 0 && (
            <p className="py-12 text-center text-sm text-me-charcoal/45">今天没有需要联系的人。</p>
          )}

          {GROUPS.map((seg) => {
            const rows = data.worklist.filter((r) => r.segment === seg)
            if (rows.length === 0) return null
            return (
              <section key={seg} className="mt-6">
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">
                  {SEGMENT_LABEL[seg]} · {rows.length}
                </p>
                <div className="space-y-3">
                  {rows.map((r) => <PersonCard key={r.contactId} row={r} />)}
                </div>
              </section>
            )
          })}

          {data.truncated && (
            <p className="mt-6 text-center text-xs text-me-charcoal/40">
              名单太长，这里只显示前 100 个 —— 先把上面的打完。
            </p>
          )}
        </>
      )}
    </div>
  )
}
