import type { Metadata } from 'next'
import GaScripts from '@/components/marketing/GaScripts'
import MetaPixelScripts from '@/components/marketing/MetaPixelScripts'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const siteDescription =
  'AI upgrade and training for AU/NZ businesses. Bilingual English/中文 support for teams in Australia and New Zealand.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Magic Engine',
    template: '%s | Magic Engine',
  },
  description: siteDescription,
  applicationName: 'Magic Engine',
  authors: [{ name: 'Magic Engine AI Technology Limited' }],
  creator: 'Magic Engine AI Technology Limited',
  publisher: 'Magic Engine AI Technology Limited',
  openGraph: {
    type: 'website',
    locale: 'en_AU',
    url: '/',
    siteName: 'Magic Engine',
    title: 'Magic Engine',
    description: siteDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Magic Engine',
    description: siteDescription,
  },
  // Meta (Facebook) Business Manager domain ownership verification —
  // required for Aggregated Event Measurement + trusted delivery of Meta
  // ads pointing at this domain. Value comes from Business Settings →
  // Brand Safety → Domains → magicengine.com.au (asset 1591700959300128).
  other: {
    'facebook-domain-verification': 'o3eut05f26ow89p225dihdmxeai483',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <GaScripts />
        <MetaPixelScripts />
      </body>
    </html>
  )
}
