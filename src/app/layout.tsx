import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import GaScripts from '@/components/marketing/GaScripts'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

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
  authors: [{ name: 'Magic Lab' }],
  creator: 'Magic Lab',
  publisher: 'Magic Lab',
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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">
        {children}
        <GaScripts />
      </body>
    </html>
  )
}
