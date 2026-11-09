/**
 * A tiny stand-in for next/navigation so page tests can watch the address bar.
 * `router.push` updates the stored query string and re-renders every component that
 * reads `useSearchParams`, like the real router does. Not a test file.
 */

import { useMemo, useSyncExternalStore } from 'react'

let search = ''
const listeners = new Set<() => void>()
export const pushes: string[] = []

export function setSearch(next: string): void {
  search = next.startsWith('?') ? next.slice(1) : next
  listeners.forEach((l) => l())
}

export function resetNav(initial = ''): void {
  pushes.length = 0
  setSearch(initial)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const navigationMock = {
  useParams: () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  usePathname: () => '/dashboard/clients/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/crm/payments',
  useSearchParams: () => {
    const current = useSyncExternalStore(subscribe, () => search, () => search)
    return useMemo(() => new URLSearchParams(current), [current])
  },
  useRouter: () => ({
    push: (url: string) => {
      pushes.push(url)
      const q = url.indexOf('?')
      if (url.includes('/crm/payments')) setSearch(q === -1 ? '' : url.slice(q))
    },
    replace: () => undefined,
    back: () => undefined,
  }),
}
