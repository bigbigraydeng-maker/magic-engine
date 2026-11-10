import { TEMPLATE_LIBRARY } from './catalog'
import type { BrandExample, MediaClip, StyleFamilyRecord, StylePackRecord, TemplateLibrary, TemplateRecord } from './types'

export interface FamilyBlock {
  family: StyleFamilyRecord
  packs: readonly StylePackRecord[]
}

export interface BrandGroup {
  packName: string
  customers: readonly BrandExample[]
}

export interface LibraryView {
  notice: string
  styleReel: MediaClip
  styleOverview: string
  templates: readonly TemplateRecord[]
  platformFamilies: readonly FamilyBlock[]
  industryFamilies: readonly FamilyBlock[]
  brands: readonly BrandGroup[]
}

/** Packs that share a family, in catalog order. */
export function familyBlocks(library: TemplateLibrary, tier: 'platform' | 'industry'): FamilyBlock[] {
  return library.families
    .filter((family) => family.tier === tier)
    .map((family) => ({
      family,
      packs: library.packs.filter((pack) => pack.familyId === family.id),
    }))
}

/** Brand stills grouped by the edit they sit on, so A and B stay next to each other. */
export function brandGroups(examples: readonly BrandExample[]): BrandGroup[] {
  const order: string[] = []
  const grouped = new Map<string, BrandExample[]>()
  for (const example of examples) {
    const list = grouped.get(example.packName)
    if (!list) {
      order.push(example.packName)
      grouped.set(example.packName, [example])
    } else {
      list.push(example)
    }
  }
  return order.map((packName) => ({ packName, customers: grouped.get(packName) ?? [] }))
}

/** The shape the page renders. New catalog rows show up without a page rewrite. */
export function templateLibraryView(library: TemplateLibrary = TEMPLATE_LIBRARY): LibraryView {
  return {
    notice: library.notice,
    styleReel: library.styleReel,
    styleOverview: library.styleOverview,
    templates: library.templates,
    platformFamilies: familyBlocks(library, 'platform'),
    industryFamilies: familyBlocks(library, 'industry'),
    brands: brandGroups(library.brandExamples),
  }
}

/** Every preview file the catalog points at. */
export function libraryMediaPaths(library: TemplateLibrary): string[] {
  const paths = [library.styleReel.src, library.styleReel.poster, library.styleOverview]
  for (const template of library.templates) {
    paths.push(template.poster)
    if (template.comparison) paths.push(template.comparison.src, template.comparison.poster)
    for (const sample of template.samples) paths.push(sample.src, sample.poster)
  }
  for (const pack of library.packs) paths.push(pack.clip.src, pack.clip.poster)
  for (const brand of library.brandExamples) {
    for (const frame of brand.frames) paths.push(frame.src)
  }
  return paths
}
