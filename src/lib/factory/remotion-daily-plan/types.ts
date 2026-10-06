export type ProductFactStatus = 'ok' | 'stale' | 'fetch_failed' | 'not_measured'

/** Narrow input mirroring the website product-fact snapshot; the adapter lives elsewhere. */
export interface ProductFactInput {
  name: string | null
  duration_days: number | null
  from_price: { amount: number; currency: string } | null
  price_basis: string | null
  departures: string[] | null // ISO dates YYYY-MM-DD
  inclusions: string[] | null
  source_url: string
  verified_at: string | null // ISO datetime
  status: ProductFactStatus
}

export type ClipKind = 'aerial' | 'street' | 'person' | 'detail'
export type ClipSource = 'own' | 'stock' | 'ai'

export interface AssetPoolClip {
  file: string
  tag: string
  kind: ClipKind
  source: ClipSource
  lenFrames: number
  luma?: number
}

export interface BrandInput {
  brandColor: string // #RRGGBB
  logoFile: string
}

export interface MusicTrack {
  id: string
  folder: 'Music' | '_shared/music'
  file: string
  durationSec: number
  bpmDetected: number
  offsetSec: number
  barPhase: number
  status: 'ready' | 'beats_unverified'
  energy: 'low' | 'mid' | 'high'
  style: string
  mood: string
}

export interface WordSpec {
  text: string
  beats: 1 | 2 | 3
  bg: 'black' | 'brand' | 'white'
}

/** Industry-specific word chain. A profile never invents numbers: every digit must come from the fact. */
export interface IndustryWordProfile {
  id: string
  buildWords(fact: ProductFactInput, now: Date): { ok: true; words: WordSpec[] } | { ok: false; reason: BlockReason; detail: string }
}

export type BlockReason =
  | 'fact_not_ok' | 'fact_stale' | 'fact_incomplete' | 'departures_past' | 'price_currency_unknown'
  | 'pool_too_small' | 'pool_kinds_too_few' | 'pool_duplicate_file'
  | 'no_usable_music' | 'too_few_words' | 'too_many_words' | 'number_not_in_fact' | 'word_too_long'

export interface MontageProps {
  brandColor: string
  logoFile: string
  musicFile: string
  beats: number[]
  totalBeats: number
  fastBars: number[]
  placeTerms: string[]
  words: Array<{ at: number; beats: number; text: string; bg: 'black' | 'brand' | 'white'; rot: number }>
  clips: AssetPoolClip[]
}

export interface MontageBuildReceipt {
  template: 'montage'
  profile: string
  music: { id: string; folder: string; file: string; status: string }
  total_beats: number
  duration_sec: number
  words: string[]
  recipe_gaps: Array<{ column: string; reason: string }>
  fact_source_url: string
  fact_verified_at: string
  no_publish: true
}

export type MontageBuildResult =
  | { ok: true; props: MontageProps; receipt: MontageBuildReceipt }
  | { ok: false; reason: BlockReason; detail: string; fix: string }
