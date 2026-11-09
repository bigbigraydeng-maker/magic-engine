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
/** When two names are the same only because the cut removed what told them apart, they get this much room. */
const WIDE_LENGTH = 48

/** Cuts by character (an emoji is never split) and adds an ellipsis. */
function clipTo(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text
}

function partsOf(title: string): string[] {
  const cleaned = title.replace(/\s+/g, ' ').trim().replace(TRAILING_LABEL, '')
  const parts = cleaned.split(SEPARATOR).map((part) => part.trim()).filter((part) => part.length > 0)
  return parts.length > 0 ? parts : [title.trim()]
}

/** "Spring Launch · Four Tours · Daily Plan · Campaign" gives "Spring Launch". */
export function shortCampaignName(title: string): string {
  return clipTo(partsOf(title)[0], MAX_LENGTH)
}

/**
 * Short names for a whole list. When two campaigns would get the same short name, the next part of each title is added
 * ("Spring · Leads" / "Spring · Brand") until they differ. If the cut to a short length then makes them the same again,
 * the two are shown longer, so a person can always tell them apart.
 */
export function shortCampaignNames(titles: ReadonlyArray<string>): string[] {
  const parts = titles.map(partsOf)
  const depth = parts.map(() => 1)
  const joined = (i: number): string => parts[i].slice(0, depth[i]).join(' · ')
  const count = (names: string[]): Map<string, number> => {
    const seen = new Map<string, number>()
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1)
    return seen
  }
  for (let round = 0; round < 4; round += 1) {
    const full = parts.map((_, i) => joined(i))
    const seen = count(full)
    let changed = false
    full.forEach((name, i) => {
      if ((seen.get(name) ?? 0) > 1 && depth[i] < parts[i].length) {
        depth[i] += 1
        changed = true
      }
    })
    if (!changed) break
  }
  const names = parts.map((_, i) => clipTo(joined(i), MAX_LENGTH))
  const shown = count(names)
  return names.map((name, i) => ((shown.get(name) ?? 0) > 1 ? clipTo(joined(i), WIDE_LENGTH) : name))
}
