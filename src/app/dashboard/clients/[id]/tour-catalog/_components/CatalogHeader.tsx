'use client'

import { useState } from 'react'
import type { CatalogSettings, CatalogViewer } from '@/lib/tour-catalog/catalog-contract'
import {
  brandTheme,
  BRAND_BADGE_CLASS,
  BRAND_BAND_CLASS,
  BRAND_LINE_CLASS,
  FEEDBACK_MAILTO,
} from './catalog-brand'

export const BETA_NOTE_UNCONNECTED =
  '测试版：这里的修改目前不会改动官网、广告和邮件，官网仍按原来的方式更新。请按真实信息填写——正式接通时会以这里为准。每次修改都会记录是谁改的。'
export const BETA_NOTE_CONNECTED =
  '测试版：上架后，官网等渠道会按这里的内容更新。每次修改都会记录是谁改的。'

interface CatalogHeaderProps {
  clientName: string
  settings: CatalogSettings
  viewer: CatalogViewer
}

function BetaNote({ connected }: { connected: boolean }): JSX.Element {
  const note = connected ? BETA_NOTE_CONNECTED : BETA_NOTE_UNCONNECTED
  const marker = '不会'
  const index = note.indexOf(marker)
  const before = index >= 0 ? note.slice(0, index) : note
  const after = index >= 0 ? note.slice(index + marker.length) : ''
  return (
    <p
      data-testid="beta-note"
      className={`border-t ${BRAND_LINE_CLASS} bg-me-ivory px-5 py-3 text-sm font-semibold text-me-charcoal/80`}
    >
      {index >= 0 ? (
        <>
          {before}
          <strong className="font-black">{marker}</strong>
          {after}
        </>
      ) : (
        note
      )}{' '}
      有问题或建议？{' '}
      <a href={FEEDBACK_MAILTO} className="font-black underline">
        告诉我们
      </a>
    </p>
  )
}

function HeaderLogo({ logoUrl, clientName }: { logoUrl: string; clientName: string }): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img is required: no image proxy, no referrer.
    <img
      src={logoUrl}
      alt={clientName || '客户标志'}
      referrerPolicy="no-referrer"
      className="h-10 w-auto max-w-[180px] shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  )
}

export function CatalogHeader({ clientName, settings, viewer }: CatalogHeaderProps): JSX.Element {
  const theme = brandTheme(settings)
  const email = typeof viewer.email === 'string' ? viewer.email.trim() : ''
  return (
    <header
      data-testid="catalog-header"
      data-branded={theme.branded ? 'true' : 'false'}
      className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          {theme.branded && theme.logoUrl ? (
            <HeaderLogo logoUrl={theme.logoUrl} clientName={clientName} />
          ) : null}
          <div className="min-w-0">
            {clientName ? (
              <p className="break-words text-sm font-black text-me-charcoal/70">{clientName}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-black text-me-charcoal">团目录</h1>
              <span
                data-testid="beta-badge"
                className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${BRAND_BADGE_CLASS}`}
              >
                Beta
              </span>
            </div>
          </div>
        </div>
        {email ? (
          <p className="break-all text-xs font-semibold text-me-charcoal/70">
            你正以 {email} 登录，修改记在这个账号名下
          </p>
        ) : null}
      </div>
      <div aria-hidden="true" className={`h-[3px] ${BRAND_BAND_CLASS}`} />
      <BetaNote connected={settings.channelsConnected === true} />
    </header>
  )
}
