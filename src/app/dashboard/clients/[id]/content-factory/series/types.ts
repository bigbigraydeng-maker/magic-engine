export interface Episode {
  key: string
  cover?: { url: string; fullUrl: string; mobileUrl: string; creditUrl: string; status: 'draft' | 'approved'; photoNote: string }
  series: string
  location: string
  title: string
  angle: string
  scenes: string[]
  kiwi: string
  materialGap: string
  status: string
  format: string
  derivatives: string
}
export interface EpisodeLinks { youtube: string; tiktok: string; preview: string }
export interface Observation {
  status: 'ok' | 'missing_key' | 'unavailable' | 'upstream_error' | 'unlinked'
  views: number | null
  likes: number | null
  observedAt: string | null
}
export interface SeriesEpisode extends Episode {
  links: EpisodeLinks
  youtube: Observation
}
export interface SeriesBoard {
  name: string
  voice: string
  style: string
  seasonalNote: string
  cadence: string
  episodes: SeriesEpisode[]
}
