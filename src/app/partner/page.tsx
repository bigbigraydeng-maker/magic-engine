'use client'
import { useEffect, useState } from 'react'
import { formatMoney, formatDate } from '../dashboard/admin/distributors/shared'

type Level = 'standard' | 'tier1' | 'premier' | null

type PortalView = {
  profile: { display_name: string; status: string; level: Level; approved_at: string | null; referral_code: string | null }
  upgrade: {
    next: Level
    selfPurchaseBestCents: number
    selfPurchaseTargetCents: number
    directSalesCents: number
    directSalesTargetCents: number
    recentTeamMonths: { month: string; team_sales_cents: number }[]
    premierMonthlyTargetCents: number
    directTier1: number
    directTier1Target: number
  }
  team: { direct: { display_name: string; level: Level; status: string }[]; total: number }
  sales: {
    id: string
    kind: 'plan' | 'addon' | 'refund'
    plan_code: string | null
    months: number | null
    extra_avatars: number
    amount_cents: number
    paid_at: string
    settled: boolean
  }[]
  statements: {
    month: string
    status: string
    payout_cents: number
    closing_cents: number
    opening_cents: number
    retail_cents: number
    peer_cents: number
    team_cents: number
  }[]
}

const LEVEL_BADGE: Record<NonNullable<Level>, string> = {
  standard: '普通经销商',
  tier1: '一级经销商',
  premier: '特级经销商',
}

const STATEMENT_STATUS: Record<string, string> = {
  computed: '已算好，待批准',
  approved: '已批准，待付款',
  paid: '已付',
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-2xl bg-me-ochre/10 px-4 py-3 text-sm font-medium text-me-charcoal/80">
      {children}
    </div>
  )
}

function ProgressRow({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-me-charcoal/80">{label}</span>
        <span className="tabular-nums text-me-charcoal/60">
          {formatMoney(value)} / {formatMoney(target)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-me-charcoal/10">
        <div className="h-full rounded-full bg-me-ochre" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Header({ profile, onLogout }: { profile: PortalView['profile']; onLogout: () => void }) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.08em] text-me-ochre">MAGIC NETWORK</div>
          <h1 className="mt-1 text-2xl font-bold text-me-charcoal/90">你好，{profile.display_name}</h1>
          <span className="mt-2 inline-block rounded-full bg-me-ochre/15 px-3 py-1 text-xs font-bold text-me-charcoal/75">
            {profile.level ? LEVEL_BADGE[profile.level] : '—'}
          </span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75"
        >
          退出
        </button>
      </div>
      {profile.status === 'suspended' && (
        <div className="mt-4">
          <Notice>你的账号已停用：停用期间的收益只记账、不发放，恢复后也不补发。</Notice>
        </div>
      )}
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-me-charcoal/65">{label}</div>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label={label}
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-black/[0.1] bg-me-ivory px-2 py-1 text-xs text-me-charcoal/80"
        />
        <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-me-ochre px-3 py-1 text-xs font-bold text-white">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}

function ReferralCard({ code }: { code: string }) {
  const origin = window.location.origin
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">我的推荐链接</h2>
      </div>
      <div className="px-6 py-5">
        <p className="text-sm text-me-charcoal/75">
          你的邀请码是 <span className="font-bold tabular-nums">{code}</span>。下面两条链接都带着它。
        </p>
        <CopyRow label="发给客户：产品介绍页" value={`${origin}/ai-steward?ref=${code}`} />
        <CopyRow label="发给想做经销商的人：申请页（审核通过后挂在你下面）" value={`${origin}/partner/apply?ref=${code}`} />
        <p className="mt-4 text-sm text-me-charcoal/75">
          <a href="/partner/network" className="font-bold text-me-ochre">单位制账本</a>
          用业绩单位记账。汇率和身份过渡还没定，不改你现在的月结。
        </p>
      </div>
    </div>
  )
}

function UpgradeCard({ upgrade, level }: { upgrade: PortalView['upgrade']; level: Level }) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">升级进度</h2>
      </div>
      <div className="px-6 py-5">
        {level === 'standard' && (
          <>
            <ProgressRow label="一次性自购" value={upgrade.selfPurchaseBestCents} target={upgrade.selfPurchaseTargetCents} />
            <ProgressRow label="累计直销" value={upgrade.directSalesCents} target={upgrade.directSalesTargetCents} />
            <p className="text-xs text-me-charcoal/55">达到任意一项就升一级。只算付款满 14 天、没有退款的单。</p>
          </>
        )}
        {level === 'tier1' && (
          <>
            <div className="mb-4 space-y-2">
              {upgrade.recentTeamMonths.map((m) => (
                <div key={m.month} className="flex items-center justify-between text-sm">
                  <span className="text-me-charcoal/75">
                    {m.month} 团队销售 {formatMoney(m.team_sales_cents)}
                  </span>
                  {m.team_sales_cents >= upgrade.premierMonthlyTargetCents && (
                    <span className="font-bold text-me-ochre">✓</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mb-4 text-sm text-me-charcoal/75">
              直属一级经销商 {upgrade.directTier1} / {upgrade.directTier1Target}
            </div>
            <p className="text-xs text-me-charcoal/55">
              连续 3 个月团队销售都达到 {formatMoney(upgrade.premierMonthlyTargetCents)}，并且有{' '}
              {upgrade.directTier1Target} 位直属一级，就升特级。
            </p>
          </>
        )}
        {level === 'premier' && <p className="text-sm text-me-charcoal/75">你已经是最高等级。</p>}
        {upgrade.next !== null && (
          <p className="mt-4 text-sm font-medium text-[#3F7A4E]">已达到升级条件，等管理员确认。</p>
        )}
      </div>
    </div>
  )
}

function TeamCard({ team }: { team: PortalView['team'] }) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">我的团队</h2>
      </div>
      <div className="px-6 py-5">
        <p className="mb-4 text-sm text-me-charcoal/75">
          团队一共 {team.total} 人，直属 {team.direct.length} 人。
        </p>
        {team.direct.length === 0 ? (
          <p className="text-sm text-me-charcoal/45">还没有下级。</p>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {team.direct.map((m, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-me-charcoal/90">{m.display_name}</span>
                <span className="text-me-charcoal/60">
                  {m.level ? LEVEL_BADGE[m.level] : '—'}
                  {m.status === 'suspended' && ' · 已暂停'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function saleContent(s: PortalView['sales'][number]): string {
  if (s.kind === 'refund') return '退款'
  if (s.kind === 'addon') return `加 ${s.extra_avatars} 个数字人`
  let text = `${s.plan_code ?? ''} × ${s.months ?? 0} 个月`
  if (s.extra_avatars > 0) text += ` +${s.extra_avatars} 个数字人`
  return text
}

function SalesCard({ sales }: { sales: PortalView['sales'] }) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">我的销售</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-me-ivory">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">付款日期</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">内容</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">金额</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {sales.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-sm text-me-charcoal/45">
                  还没有销售记录。
                </td>
              </tr>
            ) : (
              sales.map((s) => (
                <tr key={s.id} className="hover:bg-me-ivory/60 transition-colors">
                  <td className="px-6 py-4 text-sm text-me-charcoal/75">{formatDate(s.paid_at)}</td>
                  <td className="px-6 py-4 text-sm text-me-charcoal/75">{saleContent(s)}</td>
                  <td
                    className={`px-6 py-4 text-right text-sm font-bold tabular-nums ${
                      s.kind === 'refund' ? 'text-[#C2453A]' : 'text-me-charcoal/90'
                    }`}
                  >
                    {formatMoney(s.amount_cents)}
                  </td>
                  <td className="px-6 py-4 text-sm text-me-charcoal/75">
                    {s.settled ? '已结算' : '待结算（付款满 14 天后进月结）'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatementsCard({ statements }: { statements: PortalView['statements'] }) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">我的月结</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-me-ivory">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">月份</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">零售</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">平级</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">团队</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">上月欠款</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">本月应付</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {statements.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-me-charcoal/45">
                  还没有月结。
                </td>
              </tr>
            ) : (
              statements.map((st) => (
                <tr key={st.month} className="hover:bg-me-ivory/60 transition-colors align-top">
                  <td className="px-6 py-4 text-sm font-medium text-me-charcoal/90">{st.month}</td>
                  <td className="px-6 py-4 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(st.retail_cents)}</td>
                  <td className="px-6 py-4 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(st.peer_cents)}</td>
                  <td className="px-6 py-4 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(st.team_cents)}</td>
                  <td className="px-6 py-4 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(st.opening_cents)}</td>
                  <td className="px-6 py-4 text-right text-sm font-bold tabular-nums text-me-charcoal/90">
                    {formatMoney(st.payout_cents)}
                    {st.closing_cents < 0 && (
                      <div className="mt-1 text-xs font-medium text-[#C2453A]">
                        结转欠款 {formatMoney(st.closing_cents)}，从下个月收益里扣。
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-me-charcoal/75">{STATEMENT_STATUS[st.status] ?? st.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MessageCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white px-6 py-8 text-center shadow-sm">
      <h1 className="mb-3 text-lg font-bold text-me-charcoal/90">{title}</h1>
      {lines.map((line, i) => (
        <p key={i} className="mt-1 text-sm text-me-charcoal/65">
          {line}
        </p>
      ))}
    </div>
  )
}

export default function PartnerPage() {
  const [view, setView] = useState<PortalView | null>(null)
  const [state, setState] = useState<'loading' | 'unauthorized' | 'error' | 'ok'>('loading')
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/partner/me', { cache: 'no-store' })
        if (cancelled) return
        if (res.status === 401) {
          setExpired(new URLSearchParams(window.location.search).get('link') === 'expired')
          setState('unauthorized')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        const json: unknown = await res.json()
        if (cancelled) return
        setView(json as PortalView)
        setState('ok')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const logout = async () => {
    try {
      await fetch('/api/partner/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      // ignore
    }
    window.location.href = '/partner'
  }

  return (
    <div className="min-h-screen bg-me-ivory">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {state === 'loading' && (
          <div className="mx-auto max-w-md rounded-2xl bg-white px-6 py-8 text-center shadow-sm">
            <div className="mx-auto h-3 w-24 animate-pulse rounded bg-me-charcoal/10" />
          </div>
        )}
        {state === 'unauthorized' && (
          <MessageCard
            title="登录链接已失效"
            lines={[
              '请联系给你开通的管理员，重新发一条登录链接。',
              ...(expired ? ['这条链接已经用过或已过期。'] : []),
            ]}
          />
        )}
        {state === 'error' && <MessageCard title="暂时打不开，请稍后再试。" lines={[]} />}
        {state === 'ok' && view && (
          <>
            <Header profile={view.profile} onLogout={logout} />
            {view.profile.referral_code && <ReferralCard code={view.profile.referral_code} />}
            <UpgradeCard upgrade={view.upgrade} level={view.profile.level} />
            <TeamCard team={view.team} />
            <SalesCard sales={view.sales} />
            <StatementsCard statements={view.statements} />
          </>
        )}
      </div>
    </div>
  )
}
