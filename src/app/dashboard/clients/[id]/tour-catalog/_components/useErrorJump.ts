'use client'

import { useEffect, useRef, type RefObject } from 'react'

/** Shown next to the save button when the form was refused because of field errors. */
export function errorSummaryText(count: number): string {
  return `有 ${count} 项填得不对，已跳到第一处`
}

/**
 * After a refused save, bring the first red message into view and put the cursor in its input.
 * Field messages are found by `data-field-error`; the input is looked up next to the message.
 * `tick` goes up once per refused save (0 = nothing refused yet).
 */
export function useJumpToFirstError<T extends HTMLElement>(tick: number): RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (tick === 0) return
    const mark = ref.current?.querySelector<HTMLElement>('[data-field-error]')
    if (!mark) return
    const input = mark.parentElement?.querySelector<HTMLElement>('input, textarea, select') ?? null
    const target = input ?? mark
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
    input?.focus({ preventScroll: true })
  }, [tick])
  return ref
}
