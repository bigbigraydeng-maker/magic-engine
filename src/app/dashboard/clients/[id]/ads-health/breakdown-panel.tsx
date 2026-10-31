'use client'

/**
 * 多维数据（只读，只给内部员工）：按小时/星期/版位/设备/年龄性别/地区拆开的花费与进线。
 * 数据来自 /ad-health/breakdowns（读 ad_breakdown_stats + CRM 表单进线，不写库、不调 Meta）。
 *
 * 🔴 读不到就写「读不到」，不画成 0。403 直接不渲染（内部页面，非内部人员不该看到报错框）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BreakdownReport, ReportRow, ReportAccount, NonLeadSpend,
} from '@/lib/ads-strategy/breakdown-stats/report-types'
import { REPORT_DEFAULT_DAYS } from '@/lib/ads-strategy/breakdown-stats/report-types'
import { buildDaySeries } from '@/lib/ads-strategy/breakdown-stats/day-series'
import { DayBarCharts, DayTrendChart } from './day-charts'

function fmtNzTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

const DAY_OPTIONS = [30, 90, 180] as const

function money(n: number | null, cur: string | null): string {
  if (n === null) return '—'
  return cur ? `${n.toFixed(2)} ${cur}` : n.toFixed(2)
}

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`
}

function flagLabel(flag: ReportRow['flag']): { text: string; cls: string } {
  switch (flag) {
    case 'costly': return { text: '偏贵', cls: 'text-red-700' }
    case 'cheap': return { text: '偏便宜', cls: 'text-emerald-700' }
    case 'normal': return { text: '正常', cls: 'text-gray-500' }
    case 'too_few': return { text: '样本不足', cls: 'text-gray-500' }
    default: return { text: '—', cls: 'text-gray-500' }
  }
}

function objectiveLabel(objective: string): string {
  switch (objective) {
    case 'OUTCOME_ENGAGEMENT': return '私信/互动'
    case 'OUTCOME_AWARENESS': return '播放量/曝光'
    case 'OUTCOME_TRAFFIC': return '官网点击'
    case 'UNKNOWN': return '未知'
    default: return objective
  }
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function weekdayLabel(key: string): string {
  const n = Number(key)
  return WEEKDAYS[n - 1] ?? key
}

function dayLabel(key: string): string {
  const n = isoWeekdayOf(key)
  return n === null ? key : `${key.slice(5)} ${WEEKDAYS[n - 1]}`
}

function isoWeekdayOf(date: string): number | null {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const day = d.getUTCDay()
  return day === 0 ? 7 : day
}

function hourLabel(key: string): string {
  const n = Number(key)
  return Number.isFinite(n) ? `${String(n).padStart(2, '0')}:00` : key
}

/** Link click rate. Null clicks means the rows did not store link clicks. */
function ctrOf(clicks: number | null, impressions: number): number | null {
  if (clicks === null || impressions <= 0) return null
  return clicks / impressions
}

/** Cost per 1000 impressions. */
function cpmOf(spend: number, impressions: number): number | null {
  return impressions > 0 ? (spend / impressions) * 1000 : null
}

function FlagCell({ flag }: { flag: ReportRow['flag'] }) {
  const { text, cls } = flagLabel(flag)
  return <td className={`py-1.5 text-right ${cls}`}>{text}</td>
}

/** Things that make the numbers below less trustworthy, said in plain words. */
function reportWarnings(report: BreakdownReport): string[] {
  const out: string[] = []
  const currencies = new Set(report.accounts.map(a => a.currency ?? '读不到'))
  if (currencies.size > 1) {
    out.push(`这个客户的广告账户用了不同币种（${[...currencies].join('、')}），下面的花费和成本是直接相加的，不能当真。`)
  }
  if (report.accounts.some(a => a.timezone === null)) {
    out.push('有广告账户读不到时区，它的进线按国际标准时间分小时，按小时和按星期的结果会错位。')
  }
  if (report.totals.crmLeadsUnmatched > 0) {
    out.push(`另有 ${report.totals.crmLeadsUnmatched} 条进线对不上广告账户（那条广告这段时间没抓到数据），没算进上面的进线数。`)
  }
  return out
}

function hourTitle(report: BreakdownReport): string {
  const zones = [...new Set(report.accounts.map(a => a.timezone).filter((z): z is string => z !== null))]
  return zones.length > 0 ? `按小时（广告账户时区：${zones.join('、')}）` : '按小时（广告账户时区读不到）'
}

function OverviewCard({ report }: { report: BreakdownReport }) {
  const cur = report.accounts[0]?.currency ?? null
  const t = report.totals
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">总览</h2>
      <p className="mt-1 text-xs text-gray-500">
        {report.window.since} – {report.window.until}（{report.window.days} 天）
      </p>
      <p className="mt-1 text-xs text-gray-500">每条进线成本只算收表单的系列；其他目标的花费单列在下面。</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          <tr><td className="py-1 text-gray-500">总花费</td><td className="py-1 text-right">{money(t.spendAll, cur)}</td></tr>
          <tr><td className="py-1 text-gray-500">收表单系列花费</td><td className="py-1 text-right">{money(t.spendLeadObjective, cur)}</td></tr>
          <tr><td className="py-1 text-gray-500">链接点击率（收表单系列）</td><td className="py-1 text-right">{pct(ctrOf(t.linkClicksLeadObjective, t.impressionsLeadObjective))}</td></tr>
          <tr><td className="py-1 text-gray-500">千次展示费用（CPM，收表单系列）</td><td className="py-1 text-right">{money(cpmOf(t.spendLeadObjective, t.impressionsLeadObjective), cur)}</td></tr>
          <tr><td className="py-1 text-gray-500">CRM 进线</td><td className="py-1 text-right">{t.crmLeads}</td></tr>
          <tr><td className="py-1 text-gray-500">Meta 留资</td><td className="py-1 text-right">{t.metaLeads}</td></tr>
          <tr><td className="py-1 text-gray-500">匹配率</td><td className="py-1 text-right">{pct(t.matchRate)}</td></tr>
          <tr><td className="py-1 text-gray-500">每条进线成本</td><td className="py-1 text-right">{money(t.costPerCrmLead, cur)}</td></tr>
        </tbody>
      </table>
      {report.accounts.map(acc => <AccountLine key={acc.adAccountId} acc={acc} />)}
      {reportWarnings(report).map(w => <p key={w} className="mt-2 text-xs text-amber-800">{w}</p>)}
    </div>
  )
}

function AccountLine({ acc }: { acc: ReportAccount }) {
  return (
    <p className="mt-1 text-xs text-gray-500">
      账户 {acc.adAccountId}：数据更新到 {acc.latestStatDate ?? '读不到'}，最后抓取 {acc.lastFetchedAt ? fmtNzTime(acc.lastFetchedAt) : '读不到'}（新西兰时间）
    </p>
  )
}

function NonLeadCard({ rows, cur }: { rows: NonLeadSpend[]; cur: string | null }) {
  if (rows.length === 0) return null
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">其他目标的花费</h2>
      <p className="mt-1 text-xs text-gray-500">这些系列不收表单，花费不计入每条进线成本。</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(r => (
            <tr key={r.objective} className="border-t border-gray-100">
              <td className="py-1.5 text-gray-700">{objectiveLabel(r.objective)}</td>
              <td className="py-1.5 text-right">{money(r.spend, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HourBars({ rows, cur }: { rows: ReportRow[]; cur: string | null }) {
  const rates = rows.map(r => (r.spend > 0 && r.leads !== null ? (r.leads / r.spend) * 100 : null))
  const max = Math.max(0, ...rates.map(v => v ?? 0))
  return (
    <div className="mt-2">
      {rows.map((r, i) => {
        const v = rates[i]
        const w = v !== null && max > 0 ? Math.round((v / max) * 100) : 0
        return (
          <div key={r.key} className="flex items-center gap-2 py-0.5 text-xs">
            <span className="w-12 text-gray-500">{hourLabel(r.key)}</span>
            <div className="h-2 flex-1 rounded bg-gray-100">
              <div className="h-2 rounded bg-sky-400" style={{ width: `${w}%` }} />
            </div>
            <span className="w-36 shrink-0 text-right text-gray-600">{v === null ? '—' : `${v.toFixed(1)} 条 / 每 100 ${cur ?? ''}`}</span>
          </div>
        )
      })}
    </div>
  )
}

function RowTable({ rows, cur, label }: { rows: ReportRow[]; cur: string | null; label: (k: string) => string }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="font-normal">名称</th>
          <th className="text-right font-normal">花费</th>
          <th className="text-right font-normal">链接点击率</th>
          <th className="text-right font-normal">CPM</th>
          <th className="text-right font-normal">进线</th>
          <th className="text-right font-normal">每条成本</th>
          <th className="text-right font-normal">预期进线</th>
          <th className="text-right font-normal">判断</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-t border-gray-100">
            <td className="py-1.5 text-gray-700">{label(r.key)}</td>
            <td className="py-1.5 text-right">{money(r.spend, cur)}</td>
            <td className="py-1.5 text-right">{pct(ctrOf(r.linkClicks, r.impressions))}</td>
            <td className="py-1.5 text-right">{money(cpmOf(r.spend, r.impressions), cur)}</td>
            <td className="py-1.5 text-right">{r.leads === null ? '—' : r.leads}</td>
            <td className="py-1.5 text-right">{money(r.costPerLead, cur)}</td>
            <td className="py-1.5 text-right">{r.expectedLeads === null ? '—' : r.expectedLeads.toFixed(1)}</td>
            <FlagCell flag={r.flag} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BreakdownTable({ rows, cur }: { rows: ReportRow[]; cur: string | null }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="font-normal">名称</th>
          <th className="text-right font-normal">花费</th>
          <th className="text-right font-normal">花费占比</th>
          <th className="text-right font-normal">链接点击率</th>
          <th className="text-right font-normal">CPM</th>
          <th className="text-right font-normal">留资</th>
          <th className="text-right font-normal">每条成本</th>
          <th className="text-right font-normal">判断</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-t border-gray-100">
            <td className="py-1.5 text-gray-700">{r.key}</td>
            <td className="py-1.5 text-right">{money(r.spend, cur)}</td>
            <td className="py-1.5 text-right">{pct(r.spendShare)}</td>
            <td className="py-1.5 text-right">{pct(ctrOf(r.linkClicks, r.impressions))}</td>
            <td className="py-1.5 text-right">{money(cpmOf(r.spend, r.impressions), cur)}</td>
            <td className="py-1.5 text-right">{r.leads === null ? '—' : r.leads}</td>
            <td className="py-1.5 text-right">{money(r.costPerLead, cur)}</td>
            <FlagCell flag={r.flag} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RegionTable({ rows, cur }: { rows: ReportRow[]; cur: string | null }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="font-normal">地区</th>
          <th className="text-right font-normal">花费</th>
          <th className="text-right font-normal">点击</th>
          <th className="text-right font-normal">链接点击率</th>
          <th className="text-right font-normal">每次点击</th>
          <th className="text-right font-normal">CPM</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const ctr = ctrOf(r.linkClicks, r.impressions)
          const cpc = r.clicks > 0 ? r.spend / r.clicks : null
          return (
            <tr key={r.key} className="border-t border-gray-100">
              <td className="py-1.5 text-gray-700">{r.key}</td>
              <td className="py-1.5 text-right">{money(r.spend, cur)}</td>
              <td className="py-1.5 text-right">{r.clicks}</td>
              <td className="py-1.5 text-right">{pct(ctr)}</td>
              <td className="py-1.5 text-right">{money(cpc, cur)}</td>
              <td className="py-1.5 text-right">{money(cpmOf(r.spend, r.impressions), cur)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
      {children}
    </div>
  )
}

type DayView = 'table' | 'bar' | 'trend'

const DAY_VIEWS: ReadonlyArray<{ key: DayView; label: string }> = [
  { key: 'table', label: '表格' },
  { key: 'bar', label: '柱状图' },
  { key: 'trend', label: '走势图' },
]

/** 「按天」：表格 / 柱状图 / 走势图三种看法，默认表格；表格一直在，图只是另一种看法。 */
function DaySection({ rows, cur }: { rows: ReportRow[]; cur: string | null }) {
  const [view, setView] = useState<DayView>('table')
  const points = useMemo(() => buildDaySeries(rows), [rows])
  return (
    <Section title="按天" note="每天的花费来自当天每小时数据加总，进线按客户系统里的提交时间算；单独一天样本太少，不打「偏贵/偏便宜」。">
      <div className="mt-2 inline-flex gap-1" role="group" aria-label="按天的看法">
        {DAY_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
            className={`rounded-md px-3 py-1 text-xs ${view === v.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'table' && <RowTable rows={rows} cur={cur} label={dayLabel} />}
      {view === 'bar' && <DayBarCharts points={points} cur={cur} />}
      {view === 'trend' && <DayTrendChart points={points} cur={cur} />}
    </Section>
  )
}

export default function BreakdownPanel({ clientId }: { clientId: string }) {
  const [days, setDays] = useState<number>(REPORT_DEFAULT_DAYS)
  const [report, setReport] = useState<BreakdownReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/breakdowns?days=${days}`, { cache: 'no-store' })
      if (res.status === 403) { setHidden(true); return }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.report) { setError(body.error ?? '读不到多维数据'); setReport(null); return }
      setError(null); setReport(body.report as BreakdownReport)
    } catch {
      setError('读不到多维数据（网络出错）'); setReport(null)
    } finally {
      setBusy(false)
    }
  }, [clientId, days])

  useEffect(() => { void load() }, [load])

  if (hidden) return null
  const cur = report?.accounts[0]?.currency ?? null

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded px-2 py-1 text-xs ${days === d ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {d} 天
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">
          {busy ? '读取中…' : '刷新'}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      {report && (
        <>
          <OverviewCard report={report} />
          <p className="mb-3 text-xs text-gray-500">往下依次是：按天、其他目标的花费、按小时、按星期、版位、设备、年龄性别、地区。</p>
          <DaySection rows={report.day} cur={cur} />
          <NonLeadCard rows={report.nonLeadSpend} cur={cur} />
          <Section title={hourTitle(report)} note="每小时每花 100 块能带来几条进线；进线按客户系统里的提交时间算。">
            <HourBars rows={report.hour} cur={cur} />
            <RowTable rows={report.hour} cur={cur} label={hourLabel} />
          </Section>
          <Section title="按星期" note="进线按客户系统里的提交时间算。">
            <RowTable rows={report.weekday} cur={cur} label={weekdayLabel} />
          </Section>
          <Section title="版位" note="留资是 Meta 自己报的（客户系统里没有这些信息），只算最后一下的功劳。">
            <BreakdownTable rows={report.placement} cur={cur} />
          </Section>
          <Section title="设备" note="留资是 Meta 自己报的（客户系统里没有这些信息），只算最后一下的功劳。">
            <BreakdownTable rows={report.device} cur={cur} />
          </Section>
          <Section title="年龄性别" note="留资是 Meta 自己报的（客户系统里没有这些信息），只算最后一下的功劳。">
            <BreakdownTable rows={report.ageGender} cur={cur} />
          </Section>
          <Section title="地区（花费前 15）" note="Meta 按地区拆时不给留资数。">
            <RegionTable rows={report.region} cur={cur} />
          </Section>
          <p className="text-xs text-gray-500">
            「判断」是粗筛：和同表其余行比，偏离超过两个标准差才标；预期不到 5 条标「样本不足」。没做多重比较修正，要做对照测试才能下结论。
          </p>
        </>
      )}
    </div>
  )
}
