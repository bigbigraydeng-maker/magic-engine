import type { Availability } from './types'

/** Map `ListReel.tsx` / `DataCardReel.tsx` to the id the work order uses. */
export function templateIdFromReelFile(fileName: string): string | null {
  const match = /^([A-Z][A-Za-z]*)Reel\.tsx$/.exec(fileName)
  if (!match) return null
  const stem = match[1] ?? ''
  return stem.charAt(0).toLowerCase() + stem.slice(1).replace(/[A-Z]/g, (ch) => ch.toLowerCase())
}

/** Ids of every `*Reel.tsx` composition file. */
export function templateIdsFromReelFiles(fileNames: readonly string[]): string[] {
  return fileNames.flatMap((name) => {
    const id = templateIdFromReelFile(name)
    return id === null ? [] : [id]
  })
}

interface CatalogTemplate {
  id: string
  availability: Availability
}

/**
 * The page lists whatever is in the catalog. This check fails when the renderer
 * grows a template the catalog forgot, or when a badge still says "upcoming"
 * after that file has landed.
 */
export function templateSyncIssues(
  engineIds: readonly string[],
  templates: readonly CatalogTemplate[],
): string[] {
  const issues: string[] = []
  const byId = new Map(templates.map((row) => [row.id, row]))
  for (const id of engineIds) {
    const row = byId.get(id)
    if (!row) issues.push(`${id} 在出片机里，模板库没有这条`)
    else if (row.availability !== 'live') issues.push(`${id} 已经在出片机里，模板库仍标成还在审核`)
  }
  for (const row of templates) {
    if (row.availability === 'live' && !engineIds.includes(row.id)) {
      issues.push(`${row.id} 标成现在就能用，出片机里没有这个文件`)
    }
  }
  return issues
}

/** Family ids from `export type FamilyId = 'flash' | ...`, or null when the line is absent. */
export function familyIdsFromCraftSource(source: string): string[] | null {
  const line = source.match(/export type FamilyId = ([^\n]+)/)
  if (!line) return null
  return [...(line[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '').filter(Boolean)
}
