/**
 * Short names for the campaign picker on the 图文帖子 tab. Campaign titles are long mixed-language sentences
 * ("名字 · 卖点 · 日期 · Campaign"); the picker shows the lead part and the page keeps the full title as the heading.
 * Display only: pure string rules, no I/O, nothing is changed in the stored title, no customer names.
 */

/** A trailing "· Campaign" that was added to the end of the title is a label, not part of the name. */
const TRAILING_LABEL = /\s*[·•|\-–—]\s*Campaign\s*$/i
/** A separator is a dot, bar or dash with spaces around it, so "FB+IG" and "2027-03-25" are never cut. */
const SEPARATOR = /\s+[·•|]\s+|\s+[—–-]\s+/
const MAX_LENGTH = 22

function clip(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text
}

function partsOf(title: string): string[] {
  const cleaned = title.replace(/\s+/g, ' ').trim().replace(TRAILING_LABEL, '')
  const parts = cleaned.split(SEPARATOR).map((part) => part.trim()).filter((part) => part.length > 0)
  return parts.length > 0 ? parts : [title.trim()]
}

/** "CTS 3 月团招募 · 四个中国团 · 每日计划 · Campaign" gives "CTS 3 月团招募". */
export function shortCampaignName(title: string): string {
  return clip(partsOf(title)[0])
}

/**
 * Short names for a whole list. When two campaigns would get the same short name, the next part of each title is added
 * ("Spring · Leads" / "Spring · Brand") until they differ, so a person can always tell them apart.
 */
export function shortCampaignNames(titles: ReadonlyArray<string>): string[] {
  const parts = titles.map(partsOf)
  const depth = titles.map(() => 1)
  for (let round = 0; round < 4; round += 1) {
    const names = parts.map((p, i) => p.slice(0, depth[i]).join(' · '))
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    let changed = false
    names.forEach((name, i) => {
      if ((counts.get(name) ?? 0) > 1 && depth[i] < parts[i].length) {
        depth[i] += 1
        changed = true
      }
    })
    if (!changed) break
  }
  return parts.map((p, i) => clip(p.slice(0, depth[i]).join(' · ')))
}
