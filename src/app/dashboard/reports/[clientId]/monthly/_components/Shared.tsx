/**
 * Shared components for Monthly Report panels — ME design system
 */
import React from 'react'
import { GOLD_GRADIENT } from '@/components/ui/me-theme'

export function ReportSectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="font-display text-[15px] font-semibold tracking-tight text-[#1A1A1A]">
        {title}
      </h3>
      {right}
    </div>
  )
}

/** @deprecated Use ReportSectionHeader */
export function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span
        className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[11px] font-bold text-[#2A2008]"
        style={{ background: GOLD_GRADIENT }}
      >
        {number}
      </span>
      <h2 className="font-display text-base font-semibold tracking-tight text-[#1A1A1A]">{title}</h2>
    </div>
  )
}

/** @deprecated use MeStatCard from me-primitives */
export function KpiCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string
  value: string
  sub: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={`rounded-[18px] border p-4 ${
      highlight
        ? 'border-[rgba(92,138,74,.30)] bg-[rgba(92,138,74,.06)]'
        : 'border-black/10 bg-white'
    } shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]`}>
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">{label}</p>
      <p className="mt-1 font-display text-[26px] font-bold leading-none text-[#1A1A1A]">{value}</p>
      <div className="mt-1.5">{sub}</div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="py-10 text-center text-sm text-black/40">{message}</p>
  )
}

export function delta(n: number | null, invert = false) {
  if (n == null) return <span className="text-xs text-black/30">—</span>
  const good  = invert ? n < 0 : n > 0
  const bad   = invert ? n > 0 : n < 0
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '→'
  const color = good ? '#5C8A4A' : bad ? '#C2453A' : '#C4912E'
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color }}>
      {arrow} {Math.abs(n)}
    </span>
  )
}

/** Horizontal bar used in rpanel rows (mirrors .barh from dashboard.css) */
export function RBar({ pct, label }: { pct: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-[6px] w-24 overflow-hidden rounded-full bg-[#EAE6DF]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: GOLD_GRADIENT }}
        />
      </span>
      {label && <span className="text-[12px] font-semibold text-black/60">{label}</span>}
    </span>
  )
}

/** A key-value row used inside rpanel cards (mirrors .rrow) */
export function RRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-black/[.06] py-2 text-[13px] first:border-t-0">
      <span className="text-black/60">{label}</span>
      <span className="font-display font-semibold text-[#1A1A1A]">{value}</span>
    </div>
  )
}
