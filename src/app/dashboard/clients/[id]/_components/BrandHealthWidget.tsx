'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types'

type ZhangqianStatus = 'loading' | 'none' | 'reviewing' | 'confirmed'

const HEALTH_DIMS = [
  { key: 'seo', label: 'SEO' },
  { key: 'social', label: '社媒' },
  { key: 'ai_visibility', label: 'AI可见' },
  { key: 'ads', label: '广告' },
  { key: 'competitor', label: '竞品' },
  { key: 'reputation', label: '口碑' },
] as const

function scoreColor(v: number | null): string {
  if (v == null) return '#B7B1A5'
  if (v >= 60) return '#5C8A4A'
  if (v >= 40) return '#C4912E'
  return '#C2453A'
}

function RadarChart({ scores }: { scores: Record<string, number> }) {
  const cx = 110, cy = 110, maxR = 78
  const n = HEALTH_DIMS.length
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2
  const pt = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ]
  const rings = [25, 50, 75, 100]
  const scorePoly = HEALTH_DIMS
    .map((d, i) => {
      const s = scores[d.key]
      return s != null ? pt(i, (s / 100) * maxR) : null
    })
    .filter((p): p is [number, number] => p !== null)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox="0 0 220 220" className="w-full" style={{ maxHeight: 190 }}>
      {rings.map(pct => {
        const pts = HEALTH_DIMS.map((_, i) => {
          const [x, y] = pt(i, (pct / 100) * maxR)
          return `${x.toFixed(1)},${y.toFixed(1)}`
        }).join(' ')
        return (
          <polygon key={pct} points={pts}
            fill={pct === 100 ? '#FBF8F3' : 'none'}
            stroke="#EAE6DF" strokeWidth="0.75" />
        )
      })}
      {HEALTH_DIMS.map((_, i) => {
        const [x, y] = pt(i, maxR)
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#EAE6DF" strokeWidth="0.75" />
      })}
      <polygon points={scorePoly} fill="rgba(196,145,46,0.18)" stroke="#C4912E" strokeWidth="2" strokeLinejoin="round" />
      {HEALTH_DIMS.map((d, i) => {
        const s = scores[d.key]
        if (s == null) return null
        const [x, y] = pt(i, (s / 100) * maxR)
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#C4912E" stroke="white" strokeWidth="1.5" />
      })}
      {HEALTH_DIMS.map((d, i) => {
        const [lx, ly] = pt(i, maxR + 19)
        const v = scores[d.key] as number | undefined ?? null
        return (
          <g key={i}>
            <text x={lx.toFixed(1)} y={(ly - 4).toFixed(1)} textAnchor="middle" fontSize="9" fill="#1A1A1A" fontWeight="600">{d.label}</text>
            <text x={lx.toFixed(1)} y={(ly + 8).toFixed(1)} textAnchor="middle" fontSize="9" fill={scoreColor(v)} fontWeight="700">{v ?? '—'}</text>
          </g>
        )
      })}
    </svg>
  )
}

const CRISIS_BADGE: Record<string, { label: string; cls: string }> = {
  'TYPE_E 声誉陷阱': { label: '声誉陷阱', cls: 'bg-[#C2453A]/12 text-[#C2453A] border-[#C2453A]/30' },
  'TYPE_D 数字缺失': { label: '数字缺失', cls: 'bg-me-ochre/15 text-me-ochre border-me-ochre/30' },
  'TYPE_B 社媒空洞': { label: '社媒空洞', cls: 'bg-me-gold/30 text-me-ochre border-me-ochre/30' },
  'TYPE_A AI不可见': { label: 'AI不可见', cls: 'bg-[#3E6E8C]/12 text-[#3E6E8C] border-[#3E6E8C]/30' },
}

export function BrandHealthWidget({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<ZhangqianStatus>('loading')
  const [discovery, setDiscovery] = useState<ClientDiscoveryRow | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`)
        if (res.status === 404) { setStatus('none'); return }
        if (!res.ok) { setStatus('none'); return }
        const data = await res.json() as { success: boolean; discovery: ClientDiscoveryRow }
        if (data.success && data.discovery) {
          setDiscovery(data.discovery)
          setStatus(data.discovery.confirmed_at ? 'confirmed' : 'reviewing')
        } else {
          setStatus('none')
        }
      } catch {
        setStatus('none')
      }
    })()
  }, [clientId])

  if (status === 'loading') {
    return <div className="h-32 animate-pulse rounded-xl border border-black/10 bg-white p-4" />
  }

  if (status === 'none') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-me-ochre/30 bg-me-ochre/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-charcoal text-xs font-black text-white">DI</span>
          <div>
            <p className="text-sm font-black text-me-charcoal">品牌健康扫描未完成</p>
            <p className="text-xs font-semibold text-me-charcoal/55">张骞发现 Agent 将自动分析品牌现状，生成诊断报告</p>
          </div>
        </div>
        <Link href={`/dashboard/clients/${clientId}/zhangqian`} className="shrink-0 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85">
          启动发现 →
        </Link>
      </div>
    )
  }

  if (status === 'reviewing') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-ochre/15 text-xs font-black text-me-ochre">QA</span>
          <div>
            <p className="text-sm font-black text-me-charcoal">发现报告待确认</p>
            <p className="text-xs font-semibold text-me-ochre">张骞已完成扫描，请核查数据后确认导入</p>
          </div>
        </div>
        <Link href={`/dashboard/clients/${clientId}/zhangqian`} className="shrink-0 rounded-lg bg-me-ochre px-4 py-2 text-sm font-black text-white hover:bg-me-ochre/90">
          查看 &amp; 确认 →
        </Link>
      </div>
    )
  }

  const diag = discovery?.payload?.diagnosis
  const scores = diag?.scores as Record<string, number> | undefined
  const crisisType = diag?.crisis_type ?? null
  const crisisBadge = crisisType ? CRISIS_BADGE[crisisType] : null

  return (
    <div className="rounded-xl border border-me-ochre/30 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-ochre/10 text-xs font-black text-me-ochre">BH</span>
        <p className="text-sm font-black text-me-charcoal">品牌健康快照</p>
        {crisisBadge && (
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-bold ${crisisBadge.cls}`}>{crisisBadge.label}</span>
        )}
      </div>
      {discovery?.generated_at && (
        <p className="mb-3 text-xs font-semibold text-me-charcoal/45">
          发现于 {new Date(discovery.generated_at).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })}
        </p>
      )}
      {scores && <RadarChart scores={scores} />}
      {scores && (
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 border-t border-black/[.06] pt-3">
          {HEALTH_DIMS.map(({ key, label }) => {
            const v = scores[key] as number | undefined ?? null
            return (
              <div key={key} className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-me-charcoal/45">{label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: scoreColor(v) }}>{v ?? '—'}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
