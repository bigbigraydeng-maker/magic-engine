/**
 * Local, read-only dev script (NOT a test; never imported by tests/CI).
 *
 * Replays prepared customer timelines (plain text) through `computeEventFacts`
 * and prints how often `whoIsWaiting` agrees with:
 *   (a) the reference answers file, and
 *   (b) the facts embedded in the prepared file (a port check).
 *
 * Usage:
 *   npx tsx scripts/crm-hard-facts-replay.ts --prepared <prepared.json> --answers <answers.json> [--verbose]
 *
 * No network, no DB, no env, no writes: it only reads the two JSON files given
 * on the command line and prints a report.
 */

import fs from 'node:fs'
import { computeEventFacts } from '@/lib/crm/hard-facts'
import type { HardFactEvent, WhoIsWaiting } from '@/lib/crm/hard-facts'

interface PreparedContact {
  contactId: string
  user: string
  facts: { whoIsWaiting: WhoIsWaiting }
}

interface PreparedFile {
  asOf: string // 'YYYY-MM-DD'
  contacts: PreparedContact[]
}

interface AnswerContact {
  contactId: string
  whoIsWaiting: WhoIsWaiting
}

interface AnswersFile {
  contacts: AnswerContact[]
}

interface Args {
  prepared: string
  answers: string
  verbose: boolean
}

const USAGE =
  'Usage: npx tsx scripts/crm-hard-facts-replay.ts --prepared <prepared.json> --answers <answers.json> [--verbose]'

/** Parse CLI arguments; exits with code 2 on missing required flags. */
function parseArgs(argv: readonly string[]): Args {
  let prepared: string | null = null
  let answers: string | null = null
  let verbose = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--prepared') {
      prepared = argv[++i] ?? null
    } else if (arg === '--answers') {
      answers = argv[++i] ?? null
    } else if (arg === '--verbose') {
      verbose = true
    }
  }

  if (prepared === null || answers === null) {
    console.log(USAGE)
    process.exit(2)
  }

  return { prepared, answers, verbose }
}

/** Read and parse a JSON file from disk. */
function readJson<T>(path: string): T {
  return JSON.parse(fs.readFileSync(path, 'utf8')) as T
}

/** Find the first channel keyword in a line, defaulting to 'other'. */
function channelOf(rest: string): string {
  const match = rest.match(/\b(email|whatsapp|messenger|meta_lead_form|web_form|sms|phone)\b/)
  return match !== null ? match[1] : 'other'
}

/**
 * True when a call line has a next step that is a promise to send / quote / call back.
 * The speaker is deliberately ignored: a customer asking us to send info is a promise we owe too.
 * Looks at the text after `points:`, splits on `; `, and checks each `next_step=...` part.
 */
function hasCallPromise(line: string): boolean {
  const idx = line.indexOf('points:')
  if (idx === -1) return false
  const tail = line.slice(idx + 'points:'.length)
  const parts = tail.split('; ')
  const promiseRe = /(员工|旅行社|我们).{0,14}(发|整理|报价|寄|回电|再打)/
  return parts.some(
    (part) => part.trim().startsWith('next_step=') && promiseRe.test(part),
  )
}

/** Classify one timeline line into a HardFactEvent, or null to skip it. */
function classifyLine(at: string, rest: string): HardFactEvent | null {
  if (rest.startsWith('INTERNAL')) {
    return { at, kind: 'note', sub: 'other', channel: 'crm' }
  }

  if (rest.startsWith('CUSTOMER → us')) {
    if (rest.includes('[engagement only')) {
      return { at, kind: 'engagement', sub: 'other', channel: channelOf(rest) }
    }
    if (rest.includes('phone call [')) {
      const sub = rest.includes('[REAL CONVERSATION]') ? 'call_talk' : 'missed_call'
      return { at, kind: 'in_human', sub, channel: 'phone' }
    }
    if (rest.includes('[form fill]') || rest.includes('[auto-generated form message]')) {
      return { at, kind: 'in_human', sub: 'form', channel: channelOf(rest) }
    }
    return { at, kind: 'in_human', sub: 'message', channel: channelOf(rest) }
  }

  if (rest.startsWith('WE (') && rest.includes(' automated) → customer')) {
    return { at, kind: 'out_auto', sub: 'other', channel: channelOf(rest) }
  }

  if (rest.startsWith('WE (') && rest.includes(' staff) → customer')) {
    if (rest.includes('phone call [REAL CONVERSATION]')) {
      return {
        at,
        kind: 'out_human',
        sub: 'call_talk',
        channel: 'phone',
        promise: hasCallPromise(rest),
      }
    }
    if (rest.includes('phone call [')) {
      return { at, kind: 'out_attempt', sub: 'other', channel: 'phone' }
    }
    if (rest.includes('[staff follow-up log: NOT reached]')) {
      return { at, kind: 'out_attempt', sub: 'other', channel: 'phone' }
    }
    if (rest.includes('[staff follow-up log]')) {
      return { at, kind: 'out_human', sub: 'logged_contact', channel: 'phone' }
    }
    return { at, kind: 'out_human', sub: 'message', channel: channelOf(rest) }
  }

  return null
}

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\] (.*)$/

/** Parse a contact's prompt text into a list of classified events. */
function buildEvents(user: string): HardFactEvent[] {
  const lines = user.split('\n')
  const startIdx = lines.findIndex((line) => line.startsWith('Full timeline'))
  if (startIdx === -1) return []

  const events: HardFactEvent[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(LINE_RE)
    if (match === null) continue
    const [, date, hh, mm, rest] = match
    const at = `${date}T${hh}:${mm}:00Z`
    const event = classifyLine(at, rest)
    if (event !== null) events.push(event)
  }
  return events
}

/** Format a percentage rounded to a whole number, safe for N = 0. */
function percent(k: number, n: number): number {
  return n === 0 ? 0 : Math.round((k / n) * 100)
}

interface Compared {
  contactId: string
  ours: WhoIsWaiting
  reference: WhoIsWaiting
  prepared: WhoIsWaiting
}

/** Run the comparison and print the report. */
function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const prepared = readJson<PreparedFile>(args.prepared)
  const answers = readJson<AnswersFile>(args.answers)

  const answerById = new Map<string, WhoIsWaiting>()
  for (const a of answers.contacts) answerById.set(a.contactId, a.whoIsWaiting)

  const now = new Date(`${prepared.asOf}T12:00:00Z`)
  const compared: Compared[] = []

  for (const contact of prepared.contacts) {
    const reference = answerById.get(contact.contactId)
    if (reference === undefined) continue
    const events = buildEvents(contact.user)
    const facts = computeEventFacts(events, { now, timeZone: 'UTC' })
    compared.push({
      contactId: contact.contactId,
      ours: facts.whoIsWaiting,
      reference,
      prepared: contact.facts.whoIsWaiting,
    })
  }

  console.log(
    `Prepared contacts: ${prepared.contacts.length}, answers: ${answers.contacts.length}, compared: ${compared.length}`,
  )

  if (args.verbose) {
    for (const c of compared) {
      const status = c.ours === c.reference ? 'OK' : 'DIFF'
      console.log(`${c.contactId.slice(0, 8)}  ours=${c.ours}  ref=${c.reference}  ${status}`)
    }
  }

  const confusion = new Map<string, number>()
  for (const c of compared) {
    const key = `${c.ours} -> ${c.reference}`
    confusion.set(key, (confusion.get(key) ?? 0) + 1)
  }
  console.log('Confusion (ours -> reference answer):')
  for (const [key, count] of confusion) {
    console.log(`  ${key}: ${count}`)
  }

  const n = compared.length
  const refOk = compared.filter((c) => c.ours === c.reference).length
  const prepOk = compared.filter((c) => c.ours === c.prepared).length

  console.log(`Agreement with reference answers: ${refOk}/${n} (${percent(refOk, n)}%)`)
  console.log(`Agreement with prepared-file facts (port check): ${prepOk}/${n} (${percent(prepOk, n)}%)`)
}

main()
