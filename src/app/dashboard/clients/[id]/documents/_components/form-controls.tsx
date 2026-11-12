'use client'

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  VISIBILITY_LABELS,
  isDocumentCategory,
  isDocumentVisibility,
  type DocumentCategory,
  type DocumentVisibility,
} from '@/lib/client-documents/constants'
import { CLIENT_VISIBLE_NOTE } from './api-messages'

/** Form controls shared by the upload form and the per-file edit form. */

interface SelectProps<T extends string> {
  value: T
  onChange: (value: T) => void
  className: string
  id?: string
  ariaLabel?: string
}

export function CategorySelect({ value, onChange, className, id, ariaLabel }: SelectProps<DocumentCategory>): JSX.Element {
  return (
    <select id={id} aria-label={ariaLabel} className={className} value={value} onChange={e => isDocumentCategory(e.target.value) && onChange(e.target.value)}>
      {DOCUMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  )
}

export function VisibilitySelect({ value, onChange, className, id, ariaLabel }: SelectProps<DocumentVisibility>): JSX.Element {
  return (
    <select id={id} aria-label={ariaLabel} className={className} value={value} onChange={e => isDocumentVisibility(e.target.value) && onChange(e.target.value)}>
      {DOCUMENT_VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>)}
    </select>
  )
}

/** Only shown when the file will be visible to the client's own staff. */
export function VisibilityNote({ visibility }: { visibility: DocumentVisibility }): JSX.Element | null {
  if (visibility !== 'client') return null
  return <p role="note" className="text-xs font-semibold text-me-charcoal/70 sm:col-span-2">{CLIENT_VISIBLE_NOTE}</p>
}
