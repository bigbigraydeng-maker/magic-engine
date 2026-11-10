export type NavItem = {
  key: string
  label: string
  href?: string
  mark?: string
  soon?: boolean
  paidOnlyFeature?: string
  badge?: 'admin' | 'fde'
}

export type NavSection = {
  title?: string
  items: NavItem[]
  collapsed?: boolean
}

export function activeNavKey(pathname: string, sections: NavSection[]): string {
  for (const section of sections) {
    for (const item of section.items) {
      if (!item.href) continue
      const exact = item.key === 'overview' || item.key === 'client-home'
      const hrefPath = item.href.split('?')[0]
      if (exact ? pathname === hrefPath : (pathname === hrefPath || pathname.startsWith(hrefPath + '/'))) {
        return item.key
      }
    }
  }
  return ''
}

export function swapClientInPath(pathname: string, nextClientId: string): string {
  const prefix = '/dashboard/clients/'
  if (!pathname.startsWith(prefix)) return `/dashboard/clients/${nextClientId}`
  const rest = pathname.slice(prefix.length)
  const slash = rest.indexOf('/')
  const suffix = slash === -1 ? '' : rest.slice(slash)
  return `${prefix}${nextClientId}${suffix}`
}
