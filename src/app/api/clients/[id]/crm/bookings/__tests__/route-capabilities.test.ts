import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BookingCapability } from '@/lib/crm/booking-types'

/**
 * Every CRM booking route handler must declare, as a string literal, the one capability it needs.
 * This test walks the folder, so a new route.ts or a new exported HTTP method that is not written
 * into EXPECTED below turns it red — nobody can add an endpoint and forget to decide who may call it.
 */

const ROUTES_DIR = join(process.cwd(), 'src', 'app', 'api', 'clients', '[id]', 'crm', 'bookings')

/** "<path relative to the bookings folder> <METHOD>" → capability. */
const EXPECTED: Record<string, BookingCapability> = {
  'route.ts GET': 'view',
  'route.ts POST': 'edit',
  '[bookingId]/route.ts PATCH': 'edit',
  '[bookingId]/confirm-departure/route.ts POST': 'edit',
  '[bookingId]/cancel/route.ts POST': 'edit',
  '[bookingId]/milestones/[kind]/paid/route.ts POST': 'edit',
  '[bookingId]/milestones/[kind]/unpaid/route.ts POST': 'edit',
  '[bookingId]/milestones/[kind]/override-due/route.ts POST': 'edit',
  '[bookingId]/milestones/[kind]/nudge/route.ts POST': 'edit',
  'nudge-list/route.ts GET': 'view',
  'options/route.ts GET': 'view',
  'overview/route.ts GET': 'view',
  'access/route.ts GET': 'view',
  'members/route.ts GET': 'manage_members',
  'members/route.ts POST': 'manage_members',
  'members/route.ts DELETE': 'manage_members',
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
/** `export async function GET(`, `export function GET(`, `export const GET =`, `export { x as GET }`. */
const EXPORT_RE = new RegExp(
  `export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODS.join('|')})\\b|export\\s+const\\s+(${HTTP_METHODS.join('|')})\\b|\\bas\\s+(${HTTP_METHODS.join('|')})\\b`,
  'g',
)

function listRouteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') listRouteFiles(full, out)
    } else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

interface Handler {
  key: string
  /** Source from this handler's export up to the next exported handler (or the end of the file). */
  body: string
}

function handlersIn(full: string): Handler[] {
  const path = relative(ROUTES_DIR, full).split(sep).join('/')
  const source = readFileSync(full, 'utf8')
  const marks: Array<{ method: string; index: number }> = []
  for (let m = EXPORT_RE.exec(source); m !== null; m = EXPORT_RE.exec(source)) {
    marks.push({ method: m[1] ?? m[2] ?? m[3], index: m.index })
  }
  return marks.map((mark, i) => ({
    key: `${path} ${mark.method}`,
    body: source.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : source.length),
  }))
}

function allHandlers(): Handler[] {
  return listRouteFiles(ROUTES_DIR).flatMap(handlersIn)
}

const ACCESS_CALL_RE = /requireBookingAccess\(\s*clientId\s*,\s*'([a-z_]+)'\s*\)/g

describe('crm booking routes declare their capability', () => {
  it('finds exactly the handlers that are registered — a new route or method must be added to EXPECTED', () => {
    const found = allHandlers().map((h) => h.key).sort()
    expect(found).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('%s requires %s', (key, capability) => {
    const handler = allHandlers().find((h) => h.key === key)
    expect(handler, `${key} not found`).toBeDefined()
    if (handler === undefined) return
    const calls = Array.from(handler.body.matchAll(ACCESS_CALL_RE)).map((m) => m[1])
    // Exactly one gate per handler, with the expected literal.
    expect(calls).toEqual([capability])
  })

  it.each(Object.keys(EXPECTED))('%s checks access before it reads the body or touches the database', (key) => {
    const handler = allHandlers().find((h) => h.key === key)
    if (handler === undefined) throw new Error(`${key} not found`)
    const gate = handler.body.search(ACCESS_CALL_RE)
    ACCESS_CALL_RE.lastIndex = 0
    const denied = handler.body.indexOf('if (!access.ok)')
    expect(gate).toBeGreaterThan(-1)
    expect(denied).toBeGreaterThan(gate)
    for (const early of ['supabaseAdmin', 'readBookingBody(', 'prepareBookingWrite(', '.text()', '.json()', 'searchParams']) {
      const at = handler.body.indexOf(early)
      if (at !== -1) expect(at, `${key}: "${early}" appears before the access check`).toBeGreaterThan(denied)
    }
  })

  it('no route file passes a capability that is not a string literal', () => {
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      const all = source.match(/requireBookingAccess\(/g) ?? []
      const literal = source.match(ACCESS_CALL_RE) ?? []
      expect(literal.length, full).toBe(all.length)
    }
  })

  it('every capability in the contract is used by at least one route', () => {
    const used = new Set(Object.values(EXPECTED))
    const all: BookingCapability[] = ['view', 'edit', 'manage_members']
    expect(all.filter((c) => !used.has(c))).toEqual([])
  })

  it('only requireBookingAccess is used as the gate — no other access helper is imported or called', () => {
    const forbidden = ['requirePaidClientAccess', 'requireDashboardClientAccess', 'requireSession']
    const offenders: string[] = []
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      if (forbidden.some((name) => source.includes(name))) offenders.push(full)
    }
    expect(offenders).toEqual([])
  })

  it('no route file reads an identity from the request body', () => {
    const forbidden = [
      'body.actor', 'body.actor_email', 'body.actorEmail', 'body.email_actor', 'body.client_id', 'body.clientId',
    ]
    const offenders: string[] = []
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      if (forbidden.some((needle) => source.includes(needle))) offenders.push(full)
    }
    expect(offenders).toEqual([])
  })

  it('every store write call passes access.actor', () => {
    const writes = [
      'setPaid(', 'unsetPaid(', 'overrideDue(', 'nudgeMilestone(', 'confirmDeparture(', 'cancelBooking(', 'updateBooking(', 'createBooking(',
    ]
    const offenders: string[] = []
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      for (const write of writes) {
        let at = source.indexOf(write)
        while (at !== -1) {
          // Grab the call's argument list up to the matching close paren (best effort, one level).
          const open = at + write.length - 1
          const close = source.indexOf(')', open)
          const args = close === -1 ? source.slice(open) : source.slice(open, close)
          if (!args.includes('access.actor')) offenders.push(`${full}: ${write}`)
          at = source.indexOf(write, at + write.length)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the library never lets staff code claim the email source', () => {
    const storePath = join(process.cwd(), 'src', 'lib', 'crm', 'booking-store.ts')
    const store = readFileSync(storePath, 'utf8')
    for (const needle of ["p_paid_source: 'staff'", 'p_evidence_ref: null', 'p_server_detector: false']) {
      const count = store.split(needle).length - 1
      expect(count, `${needle} in booking-store.ts`).toBe(1)
    }

    const libDir = join(process.cwd(), 'src', 'lib', 'crm')
    const files: string[] = []
    for (const name of readdirSync(libDir)) {
      const full = join(libDir, name)
      if (statSync(full).isFile() && /^booking.*\.ts$/.test(name) && !name.includes('.test.')) files.push(full)
    }
    files.push(...listRouteFiles(ROUTES_DIR))

    const forbidden = ["p_server_detector: true", "paid_source: 'email'", "paid_source = 'email'"]
    const offenders: string[] = []
    for (const full of files) {
      const source = readFileSync(full, 'utf8')
      if (forbidden.some((needle) => source.includes(needle))) offenders.push(full)
    }
    expect(offenders).toEqual([])
  })

  it('every booking route file is force-dynamic', () => {
    const offenders: string[] = []
    for (const full of listRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(full, 'utf8')
      if (!source.includes("export const dynamic = 'force-dynamic'")) offenders.push(full)
    }
    expect(offenders).toEqual([])
  })
})
