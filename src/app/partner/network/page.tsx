'use client'

import { useEffect, useState, type ReactNode } from 'react'

interface NetworkView {
  ready: boolean
  displayName: string
  status: string
  identityLabel: string
  monthLabel: string
  pendingMuCents: number
  validMuCents: number
  retailRateLabel: string
  retailNextLabel: string | null
  teamMuCents: number
  teamTierLabel: string
  teamNextLabel: string | null
  earnings: { retail: number; l1: number; l2: number; team: number; peer: number; total: number }
  byProduct: { productId: string; name: string; muCents: number; retail: number; l1: number; l2: number }[]
  tree: { id: string; name: string; identityLabel: string; teamMuCents: number; depth: number }[]
  settlements: { month: string; statusLabel: string; payoutMuCents: number; carryMuCents: number }[]
  payoutStatusLabel: string
  fxLabel: string | null
  localPayoutLabel: string | null
  shares: { productName: string; code: string; url: string }[]
  notices: string[]
}

function formatMu(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100).toLocaleString('en-NZ')
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${whole}.${fraction} MU`
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-me-ivory px-4 py-3">
      <div className="text-xs font-semibold text-me-charcoal/55">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-me-charcoal/90">{value}</div>
    </div>
  )
}

function ShareRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-me-charcoal/65">{label}</div>
      <div className="flex gap-2">
        <input readOnly aria-label={label} value={value} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-lg border border-black/[0.1] bg-me-ivory px-2 py-1 text-xs text-me-charcoal/80" />
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false)) }}
          className="shrink-0 rounded-lg bg-me-ochre px-3 py-1 text-xs font-bold text-white"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}

function MonthCard({ view }: { view: NetworkView }) {
  return (
    <Card title={`${view.monthLabel} · 业绩单位`}>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="待确认" value={formatMu(view.pendingMuCents)} />
        <Metric label="已有效" value={formatMu(view.validMuCents)} />
        <Metric label="零售比例" value={view.retailRateLabel} />
        <Metric label="团队档" value={view.teamTierLabel} />
      </div>
      <p className="mt-3 text-sm text-me-charcoal/70">团队业绩 {formatMu(view.teamMuCents)}</p>
      {view.retailNextLabel && <p className="mt-1 text-sm text-me-charcoal/70">{view.retailNextLabel}</p>}
      {view.teamNextLabel && <p className="mt-1 text-sm text-me-charcoal/70">{view.teamNextLabel}</p>}
    </Card>
  )
}

function EarningsCard({ view }: { view: NetworkView }) {
  const rows = [
    ['零售', view.earnings.retail], ['第一层', view.earnings.l1], ['第二层', view.earnings.l2],
    ['团队', view.earnings.team], ['平级', view.earnings.peer],
  ] as const
  return (
    <Card title="本月收益">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map(([label, cents]) => <Metric key={label} label={label} value={formatMu(cents)} />)}
        <Metric label="合计" value={formatMu(view.earnings.total)} />
      </div>
      <p className="mt-3 text-sm text-me-charcoal/70">{view.payoutStatusLabel}</p>
      {view.localPayoutLabel && <p className="mt-1 text-sm text-me-charcoal/70">按本月锁定汇率约合 {view.localPayoutLabel}</p>}
      {!view.fxLabel && <p className="mt-1 text-sm text-me-charcoal/55">汇率还没锁定，这里只显示业绩单位。</p>}
    </Card>
  )
}

function ProductCard({ view }: { view: NetworkView }) {
  return (
    <Card title="按商品">
      {view.byProduct.length === 0 ? <p className="text-sm text-me-charcoal/55">这个月还没有按商品拆开的收益。</p> : (
        <ul className="divide-y divide-black/[0.06]">
          {view.byProduct.map((row) => (
            <li key={row.productId} className="py-3 text-sm text-me-charcoal/80">
              <div className="font-bold text-me-charcoal/90">{row.name}</div>
              <div className="mt-1 tabular-nums">销售 {formatMu(row.muCents)} · 零售 {formatMu(row.retail)} · 两层 {formatMu(row.l1 + row.l2)}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-me-charcoal/50">团队奖和平级奖按全部商品合在一起算，不拆到单个商品上。</p>
    </Card>
  )
}

function TeamCard({ view }: { view: NetworkView }) {
  return (
    <Card title="我的团队">
      {view.tree.length === 0 ? <p className="text-sm text-me-charcoal/55">还没有下线。</p> : (
        <ul className="divide-y divide-black/[0.06]">
          {view.tree.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-3 text-sm" style={{ paddingLeft: `${(row.depth - 1) * 16}px` }}>
              <span className="text-me-charcoal/85">{row.name} · {row.identityLabel}</span>
              <span className="tabular-nums text-me-charcoal/60">{formatMu(row.teamMuCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function HistoryCard({ view }: { view: NetworkView }) {
  return (
    <Card title="月结和打款">
      {view.settlements.length === 0 ? <p className="text-sm text-me-charcoal/55">还没有单位制月结。系统不会自动打款。</p> : (
        <ul className="divide-y divide-black/[0.06]">
          {view.settlements.map((row) => (
            <li key={row.month} className="flex items-center justify-between py-3 text-sm">
              <span className="text-me-charcoal/85">{row.month} · {row.statusLabel}</span>
              <span className="tabular-nums text-me-charcoal/70">{formatMu(row.payoutMuCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Header({ view }: { view: NetworkView }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-bold tracking-[0.08em] text-me-ochre">MAGIC NETWORK</div>
      <h1 className="mt-1 text-2xl font-bold text-me-charcoal/90">你好，{view.displayName}</h1>
      <span className="mt-2 inline-block rounded-full bg-me-ochre/15 px-3 py-1 text-xs font-bold text-me-charcoal/75">{view.identityLabel}</span>
      <p className="mt-3 text-sm text-me-charcoal/65"><a href="/partner" className="font-bold text-me-ochre">返回原来的月结</a></p>
    </div>
  )
}

function ShareCard({ view }: { view: NetworkView }) {
  return (
    <Card title="商品分享链接">
      {view.shares.length === 0 ? <p className="text-sm text-me-charcoal/55">批准之后才会有邀请码。</p> : view.shares.map((share) => (
        <ShareRow key={share.url} label={`${share.productName} · 邀请码 ${share.code}`} value={share.url} />
      ))}
    </Card>
  )
}

export function NetworkDashboard({ view }: { view: NetworkView }) {
  return (
    <div>
      <Header view={view} />
      {view.notices.map((notice) => (
        <div key={notice} className="mb-3 rounded-2xl bg-me-ochre/10 px-4 py-3 text-sm font-medium text-me-charcoal/80">{notice}</div>
      ))}
      <MonthCard view={view} />
      <EarningsCard view={view} />
      <ProductCard view={view} />
      <TeamCard view={view} />
      <ShareCard view={view} />
      <HistoryCard view={view} />
    </div>
  )
}

export default function NetworkPage() {
  const [view, setView] = useState<NetworkView | null>(null)
  const [state, setState] = useState<'loading' | 'unauthorized' | 'error' | 'ok'>('loading')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/partner/network', { cache: 'no-store' })
        if (cancelled) return
        if (response.status === 401) { setState('unauthorized'); return }
        if (!response.ok) { setState('error'); return }
        setView(await response.json() as NetworkView)
        setState('ok')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-me-ivory">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {state === 'loading' && <div className="mx-auto h-3 w-24 animate-pulse rounded bg-me-charcoal/10" />}
        {state === 'unauthorized' && <p className="text-center text-sm text-me-charcoal/70">登录链接已失效。请联系给你开通的管理员，重新发一条登录链接。</p>}
        {state === 'error' && <p className="text-center text-sm text-me-charcoal/70">暂时打不开，请稍后再试。</p>}
        {state === 'ok' && view && <NetworkDashboard view={view} />}
      </div>
    </div>
  )
}
