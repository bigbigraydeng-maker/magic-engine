'use client'

import Link from 'next/link'
import { CampaignPanel } from './CampaignPanel'

interface Props {
  clientId: string
}

const PRODUCTION_SHORTCUTS = [
  {
    icon: '📋',
    label: '内容看板',
    desc: '审核 · 排期 · 发布所有内容',
    href: (id: string) => `/dashboard/content?client=${id}`,
    color: 'hover:border-me-ochre/40',
  },
]

export function ContentHub({ clientId }: Props) {
  return (
    <div className="space-y-6">
      {/* Campaign management — strategic layer */}
      <CampaignPanel clientId={clientId} />

      {/* Production shortcuts — link out, not embed */}
      <div>
        <p className="text-xs font-semibold text-me-charcoal/45 uppercase tracking-widest mb-3">生产工作台</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRODUCTION_SHORTCUTS.map(s => (
            <Link
              key={s.label}
              href={s.href(clientId)}
              className={`flex items-center gap-3 p-4 rounded-xl border border-black/10 bg-white transition-all group ${s.color} hover:shadow-sm`}
            >
              <span className="text-2xl">{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-me-charcoal/90">{s.label}</p>
                <p className="text-xs text-me-charcoal/55 mt-0.5">{s.desc}</p>
              </div>
              <span className="text-me-charcoal/35 group-hover:text-me-ochre transition-colors">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
