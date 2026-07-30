'use client'

import { usePathname } from 'next/navigation'
import { MeMarkDefs, MeMark } from '@/components/ui/me-mark'
import { cx } from '@/components/ui/me-theme'
import Link from 'next/link'
import { useState } from 'react'
import { FeatureLockModal } from '@/components/auth/FeatureLockGate'

interface Props {
  children: React.ReactNode
  userEmail: string
  userRole: string
  /** Phase X.S4 — semantic tier; drives sidebar lock styling + upsell modal. */
  userTier: 'admin' | 'paid_client' | 'self_serve' | 'portal_only'
  allowedClientId: string | null
  roleLabel: string
}

// ── Nav definition ────────────────────────────────────────────────────────────

type NavItem = {
  key: string
  label: string
  href?: string
  mark: string
  soon?: boolean
  /** Feature label shown in the upsell modal when self_serve clicks this. */
  paidOnlyFeature?: string
}
type NavSection = { title?: string; items: NavItem[] }

const ADMIN_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'overview',  label: 'Overview', mark: 'OV', href: '/dashboard' },
      { key: 'clients',   label: 'Clients',  mark: 'CL', href: '/dashboard/clients' },
    ],
  },
  {
    title: 'Create',
    items: [
      // 每天高频入口:看片 + 拍板。页面早就存在,但此前全站没有任何链接指向它,
      // 只能手敲 URL —— 等于不存在。排在本组第一位是因为它是日常最常来的地方。
      { key: 'factory', label: '视频工厂', mark: 'VF', href: '/dashboard/factory' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { key: 'launch-hub',       label: 'Launch Hub',      mark: 'LH', href: '/dashboard/visuals' },
      { key: 'analytics',        label: 'Analytics',       mark: 'AN', soon: true },
      { key: 'reports',          label: 'Reports',         mark: 'RP', href: '/dashboard/reports' },
      { key: 'billing-monitor',  label: 'Billing Monitor', mark: 'BM', href: '/dashboard/admin/billing-monitor' },
      { key: 'mtc-overview',     label: 'MTC Overview',    mark: 'MC', href: '/dashboard/admin/mtc-overview' },
      { key: 'ai-gateway',       label: 'AI Gateway',      mark: 'AG', href: '/dashboard/admin/ai-gateway' },
      { key: 'viral-references', label: 'Viral References',mark: 'VR', href: '/dashboard/admin/viral-references' },
      { key: 'user-console',     label: 'User Console',    mark: 'UC', href: '/dashboard/admin/users' },
      { key: 'prospecting',      label: 'Prospecting',     mark: 'PS', href: '/dashboard/admin/prospecting' },
      { key: 'industry-baselines', label: 'Industry Baselines', mark: 'IB', href: '/dashboard/industry-baselines' },
      { key: 'cron-health',     label: 'Cron Health',     mark: 'CH', href: '/dashboard/admin/cron-health' },
    ],
  },
]

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function NavLink({
  item,
  active,
  locked,
  onLockedClick,
}: {
  item: NavItem
  active: boolean
  /** When true, the click opens the upsell modal instead of navigating. */
  locked?: boolean
  onLockedClick?: (feature: string) => void
}) {
  const cls = cx(
    'group flex items-center gap-3 rounded-[10px] px-3 py-[10px] text-[13.5px] font-medium transition',
    active
      ? 'bg-[#C4912E]/16 text-[#EBCB8B]'
      : item.soon
        ? 'cursor-default text-white/25'
        : locked
          ? 'cursor-pointer text-white/40 hover:bg-white/[.04] hover:text-white/60'
          : 'text-white/55 hover:bg-white/[.06] hover:text-[#FBF8F3]',
  )
  const mark = (
    <span className={cx(
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black',
      active ? 'bg-[#C4912E]/25 text-[#EBCB8B]' : 'bg-white/[.08] text-white/40',
    )}>
      {item.mark}
    </span>
  )
  const inner = (
    <>
      {mark}
      <span className="flex-1">{item.label}</span>
      {locked && (
        <span aria-hidden className="text-[11px] text-amber-400/80" title="Paid feature">🔒</span>
      )}
      {item.soon && (
        <span className="rounded bg-white/[.06] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/25">
          Soon
        </span>
      )}
    </>
  )

  if (item.soon || !item.href) return <div className={cls}>{inner}</div>
  if (locked && onLockedClick) {
    const feature = item.paidOnlyFeature ?? item.label
    return (
      <button
        type="button"
        onClick={() => onLockedClick(feature)}
        className={cls}
      >
        {inner}
      </button>
    )
  }
  return <Link href={item.href} className={cls}>{inner}</Link>
}

// ── DashboardShell ────────────────────────────────────────────────────────────

// ── Self-serve nav: consumption-only links, paid features show as locked ─────
// We render these in the client area sub-tree so the user sees the lock
// affordance for the gated features they *would* see as a paid customer.
function buildSelfServeSections(clientId: string): NavSection[] {
  return [
    {
      items: [
        { key: 'client-home', label: 'My workspace', mark: 'CL', href: `/dashboard/clients/${clientId}` },
      ],
    },
    {
      title: 'Create',
      items: [
        // ⚠️ 这里是 **self-serve 客户** 的导航,不是内部导航。
        // 「视频工厂」不能放这儿:middleware 对 client-viewer 只放行 /dashboard/clients/<自己>/**,
        // /dashboard/factory 会被直接 redirect 回工作台(点了没反应);就算放行,
        // /api/factory/work-orders 是 guardAdmin,整页也只会是 403 红条。
        // 内部人员的入口在 ADMIN_SECTIONS 里(不带 ?client=,跨客户总览)。
        { key: 'assets',  label: '素材库',   mark: 'AS', href: `/dashboard/clients/${clientId}/assets` },
        { key: 'visuals', label: 'Visual Studio', mark: 'VS', href: '/dashboard/visuals' },
        { key: 'content', label: 'Content',       mark: 'CT', href: '/dashboard/content' },
      ],
    },
    {
      title: 'Paid features',
      items: [
        { key: 'goals',       label: 'Goals',       mark: 'GO', href: `/dashboard/clients/${clientId}/goals`,       paidOnlyFeature: 'Goals' },
        { key: 'strategy',    label: 'Strategy',    mark: 'ST', href: `/dashboard/clients/${clientId}/strategy`,    paidOnlyFeature: 'Strategy' },
        { key: 'diagnostic',  label: 'Diagnostic',  mark: 'DG', href: `/dashboard/clients/${clientId}/diagnostic`,  paidOnlyFeature: 'Diagnostic' },
        { key: 'execution',   label: 'Execution',   mark: 'EX', href: `/dashboard/clients/${clientId}/execution`,   paidOnlyFeature: 'Execution' },
        { key: 'connectors',  label: 'Connectors',  mark: 'CN', href: `/dashboard/clients/${clientId}/connectors`,  paidOnlyFeature: 'Connectors' },
      ],
    },
  ]
}

/**
 * 受限管理员（DEMO_ADMINS）的导航。
 *
 * 给的是 FDE 视角 —— 客户工作台里该有的都有；但平台级入口（客户总览、
 * 账单、MTC、Prospecting、Cron 健康…）一律不出现，因为那些页面聚合的是
 * 全部客户的数据。middleware 已在服务端挡死，这里是不让它们出现在眼前。
 */
function buildScopedAdminSections(clientId: string): NavSection[] {
  const at = (p: string) => `/dashboard/clients/${clientId}${p}`
  return [
    { items: [{ key: 'client-home', label: '客户工作台', mark: 'CL', href: at('') }] },
    {
      title: '诊断与策略',
      items: [
        { key: 'zhangqian',  label: '品牌扫描', mark: 'ZQ', href: at('/zhangqian') },
        { key: 'diagnostic', label: '深度诊断', mark: 'DG', href: at('/diagnostic') },
        { key: 'goals',      label: '目标',     mark: 'GO', href: at('/goals') },
        { key: 'strategy',   label: '策略',     mark: 'ST', href: at('/strategy') },
        { key: 'execution',  label: '执行追踪', mark: 'EX', href: at('/execution') },
      ],
    },
    {
      title: '经营工具',
      items: [
        { key: 'tailor-made', label: '行程单',   mark: 'TM', href: at('/tailor-made') },
        { key: 'listings',    label: '房子',     mark: 'LI', href: at('/listings') },
        { key: 'crm',         label: '客户跟进', mark: 'CR', href: at('/crm') },
        { key: 'connectors',  label: '数据连接', mark: 'CN', href: at('/connectors') },
      ],
    },
  ]
}

export default function DashboardShell({ children, userEmail, userRole, userTier, allowedClientId }: Props) {
  const pathname = usePathname()
  const [lockModalFeature, setLockModalFeature] = useState<string | null>(null)

  const isClientViewer = userRole === 'client-viewer' && allowedClientId
  const isSelfServe = isClientViewer && userTier === 'self_serve'
  // 受限管理员（DEMO_ADMINS）：FDE 视角，但只在一个客户范围内
  const isScopedAdmin = userRole === 'admin' && Boolean(allowedClientId)

  const sections: NavSection[] | null = isScopedAdmin && allowedClientId
    ? buildScopedAdminSections(allowedClientId)
    : isSelfServe && allowedClientId
      ? buildSelfServeSections(allowedClientId)
      : null

  // Compute the active nav key off whichever section list is in play.
  const activeKey = (() => {
    const list = sections ?? ADMIN_SECTIONS
    for (const section of list) {
      for (const item of section.items) {
        if (!item.href) continue
        const exact = item.key === 'overview' || item.key === 'client-home'
        // href 可能带 query(如 ?client=xxx),而 pathname 永远不含 query —— 不剥掉就永不高亮
        const hrefPath = item.href.split('?')[0]
        if (exact ? pathname === hrefPath : (pathname === hrefPath || pathname.startsWith(hrefPath + '/'))) {
          return item.key
        }
      }
    }
    return ''
  })()

  return (
    <div className="grid min-h-screen bg-[#FBF8F3] font-sans [grid-template-columns:248px_1fr] max-[720px]:grid-cols-1">
      <MeMarkDefs />

      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col bg-[#0D0D0D] md:flex">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-[11px] px-5 pb-5 pt-4">
          <MeMark className="h-7 w-8 flex-none" />
          <span className="leading-none">
            <span className="block whitespace-nowrap font-display text-[15px] font-bold text-[#FBF8F3]">
              Magic Engine
            </span>
            <span className="mt-[3px] block text-[10px] tracking-[.04em] text-white/35">
              Admin cockpit
            </span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections ? (
            sections.map((section, i) => (
              <div key={i} className="mb-4">
                {section.title && (
                  <p className="mb-1.5 px-3 text-[9.5px] font-black uppercase tracking-[.16em] text-white/22">
                    {section.title}
                  </p>
                )}
                <div className="space-y-[2px]">
                  {section.items.map(item => (
                    <NavLink
                      key={item.key}
                      item={item}
                      active={item.key === activeKey}
                      locked={Boolean(item.paidOnlyFeature)}
                      onLockedClick={setLockModalFeature}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : isClientViewer ? (
            <NavLink
              item={{ key: 'clients', label: 'My client', mark: 'CL', href: `/dashboard/clients/${allowedClientId}` }}
              active={pathname.startsWith(`/dashboard/clients/${allowedClientId}`)}
            />
          ) : (
            ADMIN_SECTIONS.map((section, i) => (
              <div key={i} className="mb-4">
                {section.title && (
                  <p className="mb-1.5 px-3 text-[9.5px] font-black uppercase tracking-[.16em] text-white/22">
                    {section.title}
                  </p>
                )}
                <div className="space-y-[2px]">
                  {section.items.map(item => (
                    <NavLink key={item.key} item={item} active={item.key === activeKey} />
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[.07] px-4 py-3.5">
          <p className="truncate text-[11px] text-white/30">{userEmail}</p>
          <form action="/auth/signout" method="POST" className="mt-2.5">
            <button
              type="submit"
              className="flex h-9 w-full items-center justify-between rounded-lg border border-white/[.08] px-3 text-[12.5px] font-semibold text-white/40 transition hover:border-white/20 hover:text-white/70"
            >
              Sign out <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold">Magic Engine</span>
        </div>
        <form action="/auth/signout" method="POST">
          <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/60">
            Sign out
          </button>
        </form>
      </header>

      {/* Main content */}
      <main className="min-w-0 flex-col">
        {children}
      </main>

      {/* Phase X.S4 — upsell modal triggered by sidebar lock clicks. */}
      {lockModalFeature && (
        <FeatureLockModal
          feature={lockModalFeature}
          open={true}
          onClose={() => setLockModalFeature(null)}
          dismissible
        />
      )}
    </div>
  )
}
