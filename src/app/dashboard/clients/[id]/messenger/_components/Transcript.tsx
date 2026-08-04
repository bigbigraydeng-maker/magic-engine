'use client'

/**
 * The raw thread, shown on demand.
 *
 * The card is what staff act on, but they must be able to check it — an AI
 * summary nobody can verify is an AI summary nobody should trust. Outbound
 * messages include ones Meta's own agent sent, which is often the surprise
 * ("who promised them that?"), so both sides are labelled.
 */

import React from 'react'
import type { ThreadMessage } from '../types'
import { formatMoment } from './bits'

export function Transcript({ messages }: { messages: ThreadMessage[] }) {
  if (!messages.length) {
    return <p className="text-sm text-me-charcoal/45">这条对话还没有同步到消息内容。</p>
  }

  return (
    <div className="max-h-96 space-y-2.5 overflow-y-auto rounded-lg bg-me-ivory p-3">
      {messages.map((m, i) => {
        const fromCustomer = m.direction === 'inbound'
        return (
          <div key={i} className={fromCustomer ? '' : 'sm:pl-8'}>
            <p className="text-[11px] font-semibold text-me-charcoal/45">
              {fromCustomer ? (m.senderName ?? '客户') : `CTS（${m.senderName ?? '主页'}）`}
              <span className="ml-1.5 font-normal">{formatMoment(m.sentAt)}</span>
            </p>
            <p
              className={`mt-0.5 whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
                fromCustomer
                  ? 'bg-white text-me-charcoal'
                  : 'bg-me-stone/60 text-me-charcoal/80'
              }`}
            >
              {m.body || '（无文字内容）'}
            </p>
          </div>
        )
      })}
    </div>
  )
}
