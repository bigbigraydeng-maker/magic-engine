/**
 * ME UI primitives: Panel, StatCard, Pill, Trend, Button, Table, Chip, Meter
 * Import from '@/components/ui/me-primitives' or via the barrel.
 */

import Link from 'next/link'
import { GOLD_GRADIENT, STATUS, type StatusTone, cx } from './me-theme'

// ── Panel ─────────────────────────────────────────────────────────────────────

export function MePanel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cx(
      'rounded-[24px] border border-black/10 bg-white p-6',
      'shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]',
      className,
    )}>
      {children}
    </div>
  )
}

export function MePanelHeader({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
      {right}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

type IconTone = 'ochre' | 'stone' | 'attn' | 'track'
const ICON_TONE: Record<IconTone, string> = {
  ochre: 'bg-[#C4912E]/14 text-[#C4912E]',
  stone: 'bg-[#EAE6DF] text-black/60',
  attn:  'bg-[#B7B1A5]/20 text-[#8A8276]',
  track: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
}

export function MeStatCard({
  value, label, icon, tone = 'ochre', goldValue = false, footer,
}: {
  value: React.ReactNode
  label: string
  icon?: React.ReactNode
  tone?: IconTone
  goldValue?: boolean
  footer?: React.ReactNode
}) {
  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      <div className="flex items-center justify-between">
        <div
          className={cx('font-display text-[34px] font-bold leading-none', goldValue && 'bg-clip-text text-transparent')}
          style={goldValue ? { backgroundImage: GOLD_GRADIENT } : undefined}
        >
          {value}
        </div>
        {icon && (
          <div className={cx('grid h-[38px] w-[38px] place-items-center rounded-[10px]', ICON_TONE[tone])}>
            {icon}
          </div>
        )}
      </div>
      <div className="mt-[7px] text-[13px] text-black/60">{label}</div>
      {footer && <div className="mt-2 text-xs">{footer}</div>}
    </div>
  )
}

// ── Pill ──────────────────────────────────────────────────────────────────────

export function MePill({
  tone = 'track', children, className = '',
}: {
  tone?: StatusTone
  children: React.ReactNode
  className?: string
}) {
  const s = STATUS[tone]
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', className)}
      style={{ color: s.fg, background: s.bg }}
    >
      <span className="h-[6px] w-[6px] rounded-full bg-current" />
      {children}
    </span>
  )
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export function MeTrend({ dir, children }: { dir: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  const color = dir === 'up' ? '#5C8A4A' : dir === 'down' ? '#C2453A' : '#C4912E'
  const d = dir === 'up' ? 'M6 15l6-6 6 6' : dir === 'down' ? 'M6 9l6 6 6-6' : 'M4 12h16'
  return (
    <span className="inline-flex items-center gap-1 font-display text-[13px] font-semibold" style={{ color }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="h-3 w-3">
        <path d={d} />
      </svg>
      {children}
    </span>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost'
const BTN_BASE = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_SIZE = { md: 'px-5 py-3.5 text-[15px]', sm: 'px-4 py-2.5 text-sm' }
const BTN_VAR: Record<BtnVariant, string> = {
  primary:   'text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)]',
  secondary: 'bg-[#1A1A1A] text-[#FBF8F3]',
  ghost:     'border border-black/10 text-[#1A1A1A] hover:bg-[#EAE6DF]',
}

export function MeButton({
  variant = 'primary', size = 'md', href, className = '', children, ...rest
}: {
  variant?: BtnVariant
  size?: 'md' | 'sm'
  href?: string
  className?: string
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = cx(BTN_BASE, BTN_SIZE[size], BTN_VAR[variant], className)
  const style = variant === 'primary' ? { background: GOLD_GRADIENT } : undefined
  if (href) return <Link href={href} className={cls} style={style}>{children}</Link>
  return <button className={cls} style={style} {...rest}>{children}</button>
}

// ── Table primitives ──────────────────────────────────────────────────────────

export function MeTable({ children }: { children: React.ReactNode }) {
  return <table className="w-full border-collapse">{children}</table>
}

export function MeTh({ children, num = false }: { children?: React.ReactNode; num?: boolean }) {
  return (
    <th className={cx(
      'whitespace-nowrap border-b border-black/10 px-4 pb-3 text-[11px] font-semibold uppercase tracking-[.1em] text-black/40',
      num ? 'text-right' : 'text-left',
    )}>
      {children}
    </th>
  )
}

export function MeTd({ children, num = false, className = '' }: { children?: React.ReactNode; num?: boolean; className?: string }) {
  return (
    <td className={cx('border-b border-black/[.06] px-4 py-[15px] align-middle text-sm', num && 'text-right', className)}>
      {children}
    </td>
  )
}

export function MeTr({ children }: { children: React.ReactNode }) {
  return <tr className="transition-colors hover:bg-[#FBF8F3]">{children}</tr>
}

// ── Meter ─────────────────────────────────────────────────────────────────────

export function MeMeter({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EAE6DF]">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: GOLD_GRADIENT }} />
      </span>
      <span className="min-w-[26px] text-[12px] font-semibold text-black/60">{value}</span>
    </span>
  )
}

// ── Chip ──────────────────────────────────────────────────────────────────────

export function MeChip({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        gold ? 'text-[#C4912E]' : 'border border-black/10 bg-[#FBF8F3] text-black/60',
      )}
      style={gold ? { background: 'rgba(196,145,46,.12)' } : undefined}
    >
      {children}
    </span>
  )
}
