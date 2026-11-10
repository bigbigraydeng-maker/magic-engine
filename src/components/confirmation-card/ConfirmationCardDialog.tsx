'use client'

import React, { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'

export interface ConfirmationCardDialogProps {
  readonly open: boolean
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly statusLine: string
  readonly confirmEnabled: boolean
  readonly blockedReason: string | null
  readonly busy?: boolean
  readonly onClose: () => void
  readonly onConfirm: () => void
}

function touchesMeta(what: string, scope: string): boolean {
  const t = `${what} ${scope}`
  return /(Meta|预算|暂停|打开|投放)/.test(t)
}

export function ConfirmationCardDialog(props: ConfirmationCardDialogProps) {
  const [checked, setChecked] = useState(false)
  if (!props.open) return null

  const meta = touchesMeta(props.what, props.scope)
  const canSubmit = props.confirmEnabled && checked && !props.busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-me-charcoal/40 p-4" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] border border-me-stone bg-me-ivory shadow-card">
        {meta && (
          <div className="border-b border-me-gold/40 bg-me-gold/15 px-5 py-3 text-sm text-status-rej">
            会改动 Meta 里的广告 · {props.expiresLabel.replace(/^请在\s*/, '').replace(/前点.*/, '前有效（新西兰时间）')}
          </div>
        )}
        <div className="space-y-4 p-6">
          <h2 className="font-display text-xl font-bold text-me-charcoal">{props.what}</h2>
          <p className="text-sm text-me-charcoal/55">{props.account}</p>
          <div className="rounded-xl border border-me-stone bg-white px-4 py-3 text-center text-sm text-me-charcoal">
            <p className="font-semibold tabular-nums">{props.amount}</p>
            {props.date ? <p className="mt-1 text-xs text-me-charcoal/55">{props.date}</p> : null}
          </div>
          <div>
            <p className="text-xs font-semibold text-me-charcoal">确认后会发生</p>
            <p className="mt-1 text-sm text-me-charcoal/75">{props.scope}</p>
          </div>
          {props.statusLine ? (
            <p className="rounded-lg border border-me-stone bg-white px-3 py-2 text-xs text-me-charcoal/70">{props.statusLine}</p>
          ) : null}
          {props.blockedReason ? (
            <p className="text-sm text-status-rej">{props.blockedReason}</p>
          ) : null}
          <label className="flex cursor-pointer items-start gap-2 text-sm text-me-charcoal">
            <input
              type="checkbox"
              className="mt-1"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
            />
            我看过改之前和改之后的数字
          </label>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <MeButton type="button" variant="ghost" size="sm" disabled={props.busy} onClick={props.onClose}>
              取消，先不动
            </MeButton>
            <MeButton type="button" variant="primary" size="sm" disabled={!canSubmit} onClick={props.onConfirm}>
              确认
            </MeButton>
          </div>
        </div>
      </div>
    </div>
  )
}
