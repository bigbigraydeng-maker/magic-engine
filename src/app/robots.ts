import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/dashboard/', '/portal/', '/login', '/unauthorized'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
