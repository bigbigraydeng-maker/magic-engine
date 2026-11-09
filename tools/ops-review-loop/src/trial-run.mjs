/**
 * Parsers for the "当场试跑" (trial-run) gate: the PR body section, a GitHub
 * workflow's `on.schedule`, and a ledger card's `verify_by`.
 *
 * 🔴 **Why this exists.** PM rule 2026-09-26 (CLAUDE.md「当场试跑」): anything
 * that will run automatically later must be triggered once, end to end, before
 * it counts as done. Scheduled jobs that were only unit-tested kept failing on
 * their first real run days later. The text rule alone does not stop a B-level
 * PR from auto-merging, so the merge gate checks that the PR body at least
 * *records* a trial run.
 *
 * 🔴 **What this does NOT do.** It checks that the section is present and
 * well-formed. It cannot tell a real trial run from an invented one — that is
 * the reviewers' job, and every summary says so out loud.
 *
 * 🔴 **Why workflows are parsed by hand.** The Risk gate runs from `main`
 * without `npm ci`, so no YAML library is available. The parser below is
 * deliberately narrow and fails towards "needs a trial run" whenever it cannot
 * tell: an unreadable workflow must not be waved through as unscheduled.
 *
 * Pure module: no I/O, no clock. `tests/trial-run.test.ts` exercises it offline.
 */

/** Section heading that carries the trial-run record. */
const SECTION_HEADING = /^##[ \t]*当场试跑(?=[\s（(：:]|$)/

/** Any heading of level 1 or 2 ends the section; `###` sub-headings stay inside. */
const SECTION_END = /^#{1,2}[ \t]/

/**
 * The three elements the rule asks for. Labels are a closed whitelist
 * (狄仁杰 DR78-3): a free-form `…时间` pattern let `预计时间` or `未跑状态` count.
 */
export const TRIAL_RUN_ELEMENTS = [
  { key: 'trigger', label: '触发方式', pattern: /^触发方式$/ },
  { key: 'time', label: '时间', pattern: /^(时间|触发时间|运行时间)$/ },
  { key: 'status', label: '状态 / 退出码', pattern: /^(状态|运行状态|退出码)$/ },
]

/**
 * Values that are placeholders — or an honest "did not run" — not answers.
 * Compared after trimming. `0` is handled separately: it is a real exit code.
 */
const PLACEHOLDER = /^(|-+|—+|…+|\.{2,}|\?+|？+|todo|tbd|n\/a|xxx+|待填|待补|待定|无|略|未跑|没跑|未运行|没运行|<[^>]*>)$/i

/** A time must name a checkable moment: a date or an hh:mm. */
const CHECKABLE_TIME = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.月]\d{1,2}|\d{1,2}:\d{2}/

/**
 * Strip HTML comments, so a template's placeholder text inside `<!-- -->`
 * can never count as a filled-in record.
 *
 * @param {string} text
 * @returns {string}
 */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?(-->|$)/g, '')
}

/**
 * The body lines of every `## 当场试跑` section, concatenated.
 *
 * @param {unknown} body
 * @returns {string[]|null} `null` when there is no such section
 */
export function extractTrialRunSection(body) {
  if (typeof body !== 'string') return null
  const lines = stripHtmlComments(body).replace(/\r\n/g, '\n').split('\n')
  const out = []
  let inside = false
  let found = false
  for (const line of lines) {
    if (SECTION_HEADING.test(line)) {
      inside = true
      found = true
      continue
    }
    if (inside && SECTION_END.test(line)) inside = false
    if (inside) out.push(line)
  }
  return found ? out : null
}

/**
 * Split one markdown line into `[label, value]`, tolerating list bullets,
 * bold, quotes and table pipes: `- **触发方式**：手动`, `| 时间 | 2026-09-27 |`.
 *
 * @param {string} line
 * @returns {[string, string]|null}
 */
function splitLabelled(line) {
  const cleaned = line.replace(/[*`]/g, '').replace(/^[\s>|+-]*/, '')
  const match = cleaned.match(/^([^:：|]{1,12}?)\s*[:：|]\s*(.*)$/)
  if (!match) return null
  const value = match[2].replace(/\|\s*$/, '').trim()
  return [match[1].trim(), value]
}

/**
 * Which of the three elements the section fills in, with a real value.
 *
 * @param {string[]} sectionLines
 * @returns {{present: string[], missing: string[]}} element labels
 */
export function checkTrialRunElements(sectionLines) {
  const filled = new Set()
  for (const line of sectionLines) {
    const pair = splitLabelled(line)
    if (!pair) continue
    const [label, value] = pair
    if (PLACEHOLDER.test(value)) continue
    // `0` is a real answer only as an exit code; as a status or time it is filler.
    if (value === '0' && label !== '退出码') continue
    for (const element of TRIAL_RUN_ELEMENTS) {
      if (!element.pattern.test(label)) continue
      // A time with no date or hh:mm in it ("刚才", "今天") names no moment anyone can check.
      if (element.key === 'time' && !CHECKABLE_TIME.test(value)) continue
      filled.add(element.key)
    }
  }
  return {
    present: TRIAL_RUN_ELEMENTS.filter((e) => filled.has(e.key)).map((e) => e.label),
    missing: TRIAL_RUN_ELEMENTS.filter((e) => !filled.has(e.key)).map((e) => e.label),
  }
}

/**
 * The "当场跑不了" exit, if the section takes it: the stated reason and every
 * ledger-card id mentioned anywhere in the section.
 *
 * @param {string[]} sectionLines
 * @returns {{reason: string, cardIds: string[]}|null}
 */
export function findCannotRunExit(sectionLines) {
  let reason = null
  for (const line of sectionLines) {
    const pair = splitLabelled(line)
    if (pair && pair[0] === '当场跑不了' && !PLACEHOLDER.test(pair[1])) {
      reason = pair[1]
      break
    }
  }
  if (reason === null) return null
  const ids = new Set()
  for (const line of sectionLines) {
    for (const m of line.matchAll(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*)\b/g)) ids.add(m[1])
  }
  return { reason, cardIds: [...ids] }
}

/**
 * `verify_by` from a ledger card's frontmatter, or `null`.
 *
 * @param {unknown} text
 * @returns {string|null} YYYY-MM-DD
 */
export function parseLedgerVerifyBy(text) {
  if (typeof text !== 'string') return null
  const normalised = text.replace(/\r\n/g, '\n')
  if (!normalised.startsWith('---\n')) return null
  const close = normalised.indexOf('\n---', 4)
  if (close === -1) return null
  const match = normalised.slice(4, close).match(/^verify_by:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/m)
  if (!match) return null
  const date = new Date(`${match[1]}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] ? null : match[1]
}

/**
 * Remove YAML comments: `#` at line start or after whitespace. Quotes are not
 * tracked, which can only remove text — so at worst a `schedule` hidden after
 * ` #` inside a quoted string is missed, and such a string is never an `on:` key.
 *
 * @param {string} line
 * @returns {string}
 */
function stripYamlComment(line) {
  const idx = line.search(/(^|\s)#/)
  return idx === -1 ? line : line.slice(0, idx)
}

const ON_KEY = /^(on|"on"|'on')[ \t]*:(.*)$/

/**
 * Does this workflow run on a schedule? `true` / `false`, or `null` when the
 * file cannot be read with confidence (the caller treats `null` as "yes").
 *
 * Only the top-level `on:` key counts, and only a `schedule` key directly
 * under it (block style) or inside its same-line value (flow style). A
 * `schedule:` in a comment or inside a job's script does not.
 *
 * @param {unknown} text
 * @returns {boolean|null}
 */
export function workflowHasSchedule(text) {
  if (typeof text !== 'string') return null
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(stripYamlComment)
  const onLines = lines.flatMap((line, i) => (ON_KEY.test(line) ? [i] : []))
  // Two `on:` keys: which one GitHub honours is not something to guess (DR78-4).
  if (onLines.length !== 1) return null
  const start = onLines[0]
  const inline = lines[start].match(ON_KEY)[2].trim()
  if (inline !== '') {
    if (inline.startsWith('*') || inline.startsWith('&')) return null
    // A flow collection continued on later lines is beyond this parser (DR78-4).
    if ((inline.startsWith('{') && !inline.endsWith('}')) || (inline.startsWith('[') && !inline.endsWith(']'))) {
      return null
    }
    return /\bschedule\b/.test(inline)
  }
  let childIndent = -1
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) break
    if (childIndent === -1) childIndent = indent
    if (indent !== childIndent) continue
    const key = line.trim()
    if (key.startsWith('<<') || key.startsWith('*')) return null
    if (/^(schedule|"schedule"|'schedule')[ \t]*:/.test(key)) return true
  }
  return childIndent === -1 ? null : false
}

/** What in an added line marks scheduled or background work (DR78-1 / DR78-2). */
const SCHEDULED_CODE = [
  { re: /createFunction\s*\(/, what: 'createFunction(' },
  { re: /\bcron\s*:/, what: 'cron:' },
  { re: /_CRON\b\s*=/, what: '_CRON =' },
]

/**
 * Scheduled / background-work markers in the lines a diff ADDS. Reads the
 * `patch` the files API already returns — no extra fetch.
 *
 * @param {unknown} patch
 * @returns {string[]|null} matched markers, or `null` when there is no patch to read
 */
export function scheduledCodeInPatch(patch) {
  if (typeof patch !== 'string') return null
  const found = new Set()
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const { re, what } of SCHEDULED_CODE) if (re.test(line)) found.add(what)
  }
  return [...found]
}
