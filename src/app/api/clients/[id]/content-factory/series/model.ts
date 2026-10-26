import type { EpisodeLinks } from '@/app/dashboard/clients/[id]/content-factory/series/types'

export function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function publicUrl(value: string): URL | null {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
    return u
  } catch { return null }
}

export function youtubeUrl(value: string): string | null {
  const u = publicUrl(value)
  if (!u) return null
  let id: string | null = null
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1)
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else if (/^\/shorts\/[^/]+$/.test(u.pathname)) id = u.pathname.split('/')[2]
  }
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

export function tiktokUrl(value: string): string | null {
  const u = publicUrl(value)
  return u && ['tiktok.com', 'www.tiktok.com'].includes(u.hostname)
    && /^\/@[\w.-]+\/video\/\d{10,30}$/.test(u.pathname)
    ? `https://www.tiktok.com${u.pathname}` : null
}

// Preview URLs are played by the browser only, never fetched by this server.
export function previewUrl(value: string): string | null {
  const u = publicUrl(value)
  if (!u || !u.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(u.hostname)
    || /^\d+(?:\.\d+){3}$/.test(u.hostname) || u.hostname.includes(':')) return null
  return u.href
}

export function validateLinks(raw: unknown): EpisodeLinks | null {
  const row = objectOf(raw)
  if (!['youtube', 'tiktok', 'preview'].every(k => typeof row[k] === 'string' && (row[k] as string).length <= 2048)) return null
  const input = row as unknown as EpisodeLinks
  const youtube = input.youtube.trim() ? youtubeUrl(input.youtube.trim()) : ''
  const tiktok = input.tiktok.trim() ? tiktokUrl(input.tiktok.trim()) : ''
  const preview = input.preview.trim() ? previewUrl(input.preview.trim()) : ''
  return youtube !== null && tiktok !== null && preview !== null ? { youtube, tiktok, preview } : null
}

export function linksFor(config: unknown, key: string): EpisodeLinks {
  const stored = objectOf(objectOf(config).documentary_links)[key]
  return validateLinks(stored) ?? { youtube: '', tiktok: '', preview: '' }
}
export function mergeLinks(config: unknown, key: string, links: EpisodeLinks): Record<string, unknown> {
  return { ...objectOf(config), documentary_links: { ...objectOf(objectOf(config).documentary_links), [key]: links } }
}
