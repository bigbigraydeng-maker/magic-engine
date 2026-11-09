'use client'

import { useEffect } from 'react'

/**
 * Stops the page behind a side drawer from scrolling while the drawer is open.
 *
 * Reference-counted so two drawers (or a StrictMode mount → unmount → mount) never
 * clobber each other: the first lock remembers the exact previous inline value,
 * the last unlock puts exactly that value back.
 */
let lockCount = 0
let previousOverflow = ''

export function useBodyScrollLock(): void {
  useEffect(() => {
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1
    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [])
}
