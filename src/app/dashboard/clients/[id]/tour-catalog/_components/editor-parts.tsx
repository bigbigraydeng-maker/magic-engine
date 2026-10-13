'use client'

import type { ReactNode } from 'react'

/** Small shared pieces of the tour editor: colours, labels, red field messages, the folding group. */

export const DANGER = '#C2453A'
export const SUCCESS = '#456F35'
export const AMBER = '#B7791F'

/** Server field path (e.g. `gallery[2]`, `faqs[0].link.href`) -> plain-Chinese message. */
export interface FieldErrors {
  [field: string]: string
}

export const inputClass =
  'w-full rounded-xl border border-black/10 bg-me-ivory px-3 py-2 text-sm text-me-charcoal'

export const smallButtonClass =
  'whitespace-nowrap rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold text-me-charcoal hover:bg-me-ivory disabled:cursor-not-allowed disabled:opacity-40'

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p data-field-error className="mt-1 text-xs" style={{ color: DANGER }}>
      {message}
    </p>
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-me-charcoal">
      {children}
    </label>
  )
}

export function HelpText({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-me-charcoal/60">{children}</p>
}

/** "12/120" under a text box; turns red once over the limit. */
export function CharCount({ length, max }: { length: number; max: number }) {
  return (
    <p
      className="mt-1 text-right text-xs tabular-nums text-me-charcoal/60"
      style={length > max ? { color: DANGER } : undefined}
    >
      {length}/{max}
    </p>
  )
}

/** The top-level field a server path belongs to: `faqs[0].link.href` -> `faqs`. */
export function fieldRoot(path: string): string {
  const cut = path.search(/[[.]/)
  return cut === -1 ? path : path.slice(0, cut)
}

/** Messages whose path is `prefix` itself or sits under it (`prefix[0]`, `prefix.x`), in server order. */
export function errorsUnder(errors: FieldErrors, prefix: string): string[] {
  return Object.keys(errors)
    .filter((key) => key === prefix || key.startsWith(`${prefix}[`) || key.startsWith(`${prefix}.`))
    .map((key) => errors[key])
}

/** Every message under `prefix`, one red line each. */
export function FieldErrorList({ errors, prefix }: { errors: FieldErrors; prefix: string }) {
  const messages = errorsUnder(errors, prefix)
  if (messages.length === 0) return null
  return (
    <div>
      {messages.map((message, index) => (
        <FieldError key={`${prefix}-${index}`} message={message} />
      ))}
    </div>
  )
}

export interface EditorGroupProps {
  id: string
  title: string
  open: boolean
  onToggle: (id: string) => void
  /** This group holds edits that are not saved yet. */
  dirty: boolean
  /** The last save was refused because of something in this group. */
  hasError: boolean
  children: ReactNode
}

/** One folding block of the editor. The body stays mounted while folded so typed text is not lost. */
export function EditorGroup(props: EditorGroupProps) {
  const { id, title, open, onToggle, dirty, hasError, children } = props
  const bodyId = `tour-editor-group-${id}`
  return (
    <section data-group={id} className="rounded-xl border border-black/10">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(id)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-black text-me-charcoal hover:bg-me-ivory"
        >
          <span aria-hidden className="w-3 text-me-charcoal/60">
            {open ? '▾' : '▸'}
          </span>
          <span className="min-w-0 flex-1">{title}</span>
          {dirty ? (
            <span
              data-testid={`group-dirty-${id}`}
              title="有没保存的改动"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: AMBER }}
            >
              <span className="sr-only">有没保存的改动</span>
            </span>
          ) : null}
          {hasError ? (
            <span
              data-testid={`group-error-${id}`}
              title="有填得不对的地方"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: DANGER }}
            >
              <span className="sr-only">有填得不对的地方</span>
            </span>
          ) : null}
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="space-y-4 border-t border-black/10 p-3">
        {children}
      </div>
    </section>
  )
}
