import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'

const routes = ['/', '/about', '/contact', '/discover', '/geo', '/geo/glossary', '/privacy', '/terms', '/training']

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return routes.map(route => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1 : 0.7,
  }))
}
