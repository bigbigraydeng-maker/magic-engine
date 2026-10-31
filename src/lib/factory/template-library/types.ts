/** Where a template or edit style sits. Brand recolours a style; it is not a seventh look. */
export type LibraryTier = 'platform' | 'industry' | 'brand'

/** Live means today's renderer accepts it. Upcoming is visible here before that code is merged. */
export type Availability = 'live' | 'upcoming'

/** Portrait clips are 9:16. Wide clips are side-by-side. Stack is the six-style reel. */
export type MediaShape = 'portrait' | 'wide' | 'stack'

/** One playable clip or its poster. Paths are site-rooted public files. */
export interface MediaClip {
  src: string
  poster: string
  label: string
  shape: MediaShape
}

/** The four differences a person can see without reading a settings file. */
export interface StyleDifference {
  transition: string
  textMotion: string
  rhythm: string
  caption: string
}

/** One video layout the factory can render. */
export interface TemplateRecord {
  id: string
  name: string
  blurb: string
  goodFor: string
  skipWhen: string
  availability: Availability
  poster: string
  posterLabel: string
  posterShape: 'wide' | 'portrait'
  comparison: MediaClip | null
  samples: readonly MediaClip[]
}

/** A named look inside a family. Two packs in one family can still cut differently. */
export interface StylePackRecord {
  id: string
  name: string
  familyId: string
  availability: Availability
  difference: StyleDifference
  clip: MediaClip
}

/** A family groups packs that a person would describe with the same sentence. */
export interface StyleFamilyRecord {
  id: string
  name: string
  tier: Exclude<LibraryTier, 'brand'>
  summary: string
}

/** One still of the brand kit sitting on an already chosen pack. */
export interface BrandFrame {
  label: string
  src: string
}

/** Same edit, two fictional businesses. */
export interface BrandExample {
  id: string
  customer: string
  packName: string
  frames: readonly BrandFrame[]
}

/** Everything the library page is allowed to show. Adding a row is enough for a new template or style. */
export interface TemplateLibrary {
  notice: string
  styleReel: MediaClip
  styleOverview: string
  templates: readonly TemplateRecord[]
  families: readonly StyleFamilyRecord[]
  packs: readonly StylePackRecord[]
  brandExamples: readonly BrandExample[]
}
