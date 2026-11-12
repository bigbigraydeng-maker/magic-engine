import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Magic Network 经销商后台 · Magic Engine',
  robots: { index: false, follow: false },
}

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return children
}
