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
