/**
 * safe-fetch — connection-bound SSRF-safe fetch primitive for any URL
 * supplied by an untrusted source (a prospect's website, a client's sitemap
 * host, a redirect target neither of us chose, …).
 *
 * Prerequisite for PR #963, tracked by issue #965. Governance: issue #964.
 * This module intentionally owns the *entire* fetch-with-redirects flow
 * (issue #965's required outcome: "repeat the complete validation-and-binding
 * process on every hop") instead of only exposing a one-shot host check that
 * every caller re-loops around — that split is exactly what let PR #963's
 * per-caller loops drift out of sync with each other.
 *
 * Not wired into any caller yet. src/lib/prospecting/audit.ts and
 * src/lib/site-audit/crawler.ts keep their own pre-existing guards until a
 * follow-up PR migrates them to this primitive (see issue #965 "Compatibility").
 * The three format-only CMS guards (src/lib/cms/{ssrf,shopify,url}-guard.ts)
 * are a separate, out-of-scope consolidation decision — do not import from
 * or merge into them here.
 *
 * ── Threat model (see PR description for the full write-up) ───────────────
 * The URL (including every redirect hop) is attacker-controlled: the
 * attacker may run authoritative DNS for the hostname and return whatever
 * A/AAAA records they like, including a public "decoy" answer alongside a
 * private one, or a different answer between two separate resolutions of the
 * same name (DNS rebinding). The only thing standing between that hostname
 * and our internal network / cloud-metadata endpoint is this module, because
 * the process making the request already holds full internal privileges.
 * Every property below must hold even against an active, adversarial
 * authoritative DNS operator — not just against a static blocklist of
 * hostnames:
 *   1. No connection is ever made to a loopback / private / link-local
 *      (full fe80::/10) / CGNAT / unspecified / multicast / reserved /
 *      cloud-metadata address, IPv4 or IPv6, including IPv4-mapped/-compatible
 *      IPv6 forms, using CIDR-correct classification (not string prefixes).
 *   2. The address that was validated is *provably* the address the socket
 *      connects to — no second, unvalidated DNS resolution can happen between
 *      the check and the connect (see "Connection binding" below).
 *   3. If a hostname resolves to multiple addresses and even one is
 *      disallowed, the whole request is rejected (fail closed) — a client
 *      that only checks "the first answer" can be bypassed by putting the
 *      allowed address first and the attack address second.
 *   4. Every redirect hop is a brand-new untrusted URL and re-runs the exact
 *      same validation + binding; a public URL redirecting to a private one
 *      cannot bypass the guard, and the hop count is capped.
 *   5. Only http/https are ever dialed — file:, data:, gopher:, ftp:, etc.
 *      are rejected before any network activity, on every hop.
 *   6. Host header, TLS SNI, and certificate verification use the original
 *      hostname — never the resolved IP — so this only pins *where the
 *      socket connects*, not what the server sees or how the cert is checked.
 *   7. Response size and per-hop time are bounded so a hostile or oversized
 *      response can't exhaust memory or hang the caller.
 *
 * ── Connection binding ──────────────────────────────────────────────────
 * `resolveValidatedAddress()` resolves every candidate address for a hop's
 * hostname and validates all of them up front (#1/#3 above). `buildPinnedLookup()`
 * then wraps that single, already-validated address in a `net.LookupFunction`
 * that *ignores its inputs* and always hands back that literal address — it
 * never calls `dns` again. That function is passed as `connect.lookup` to a
 * fresh undici `Agent` used only for this one hop. Undici's connector forwards
 * `connect` options straight through to `net.connect`/`tls.connect` alongside
 * `host: hostname` (see node_modules/undici/lib/core/connect.js) — Node calls
 * `lookup` exactly once to turn that hostname into a socket address and dials
 * whatever it returns, with no other resolution step. Because our `lookup` is
 * a constant, there is no live DNS call left for a rebinding attacker's second
 * answer to land in. `servername`/Host are derived by undici from the request
 * URL as normal (#6) — pinning only touches the low-level connect address.
 *
 * ── Dependency / dispatcher choice ──────────────────────────────────────
 * IP classification: `ipaddr.js` (zero deps, MIT, ~30M weekly downloads) —
 * `ipaddr.process()` canonicalizes IPv4-mapped/-compatible IPv6 to a plain
 * IPv4 object before classification (handles `::ffff:7f00:1` for free, no
 * regex), and `.range()` is driven by a maintained CIDR table (includes the
 * full `fe80::/10`, `100.64.0.0/10` CGNAT, `fc00::/7`, deprecated/site-local,
 * discard-only, and RFC reserved ranges) instead of hand-rolled prefixes.
 * This module trusts only the `'unicast'` bucket (allow-list, not a
 * block-list that has to enumerate every dangerous category by name).
 * Connection binding: Node's own documented `connect.lookup` extension point
 * via the `undici` package (the reference implementation Node's global fetch
 * is built on; Node's docs point at installing `undici` directly for
 * dispatcher-level customization). Considered and rejected: (a) third-party
 * SSRF-guard npm packages — the ones surveyed either target older HTTP
 * clients (axios/request) with no platform-`fetch` integration, or validate
 * a hostname and then hand off to the client's own (separate) resolution,
 * the exact check-then-connect gap this issue exists to close; (b) raw
 * `net.connect` + hand-built HTTP/TLS — rejected as unnecessary attack
 * surface (redirects, chunked encoding, TLS session handling, …) when
 * undici's connector already does all of that correctly and only needs one
 * hook parameterized.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch, type Headers } from 'undici'
import ipaddr from 'ipaddr.js'

// ─── Errors (exported so callers can map them to their own strings) ───────

export class BlockedAddressError extends Error {
  constructor(
    public readonly host: string,
    public readonly address: string,
    public readonly range: string,
  ) {
    super(`blocked ${range} address for "${host}": ${address}`)
    this.name = 'BlockedAddressError'
  }
}

export class DisallowedSchemeError extends Error {
  constructor(public readonly scheme: string) {
    super(`scheme not allowed: ${scheme}`)
    this.name = 'DisallowedSchemeError'
  }
}

export class TooManyRedirectsError extends Error {
  constructor(public readonly limit: number) {
    super(`exceeded maximum of ${limit} redirects`)
    this.name = 'TooManyRedirectsError'
  }
}

export class InvalidRedirectError extends Error {
  constructor(public readonly status: number, reason: string) {
    super(`invalid redirect (HTTP ${status}): ${reason}`)
    this.name = 'InvalidRedirectError'
  }
}

export class ResponseTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`response exceeded ${limitBytes} byte limit`)
    this.name = 'ResponseTooLargeError'
  }
}

// ─── CIDR-correct address classification ───────────────────────────────────

interface ClassifiedAddress {
  address: string
  family: 4 | 6
  blocked: boolean
  range: string
}

/**
 * Allow-list, not a block-list: only ipaddr.js's 'unicast' bucket is safe to
 * dial. Everything else (loopback, private, the full linkLocal fe80::/10,
 * CGNAT, unspecified, multicast, uniqueLocal, ipv4-mapped forms once
 * unwrapped to their real IPv4 range, reserved/benchmarking/documentation
 * ranges, …) is rejected without having to name each category — exported
 * for tests. ipaddr.process() also canonicalizes IPv4-mapped/-compatible
 * IPv6 (e.g. "::ffff:7f00:1") down to its IPv4 form first.
 */
export function classifyAddress(address: string): ClassifiedAddress {
  const parsed = ipaddr.process(address)
  const range = parsed.range()
  const family: 4 | 6 = parsed.kind() === 'ipv4' ? 4 : 6
  return { address, family, blocked: range !== 'unicast', range }
}

// ─── Resolve-all, validate-all, fail-closed ────────────────────────────────

export interface ValidatedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/**
 * Resolves every candidate address for `hostname` (or classifies it directly
 * if it is already an IP literal) and throws BlockedAddressError if *any*
 * candidate is disallowed — a DNS answer with one public and one private
 * address must fail closed, not pass because the first record looked fine.
 * DNS lookup failures are not caught here; they propagate so callers keep
 * their own "couldn't resolve" classification. Exported for tests.
 */
export async function resolveValidatedAddress(hostname: string): Promise<ValidatedAddress> {
  const literalFamily = isIP(hostname)
  const candidates =
    literalFamily !== 0
      ? [{ address: hostname, family: literalFamily }]
      : await dnsLookup(hostname, { all: true, verbatim: true })

  const classified = candidates.map(c => classifyAddress(c.address))
  const blocked = classified.find(c => c.blocked)
  if (blocked) throw new BlockedAddressError(hostname, blocked.address, blocked.range)

  const chosen = classified[0]
  return { address: chosen.address, family: chosen.family }
}

/**
 * A net.LookupFunction that ignores its `hostname`/`options` arguments and
 * always hands back the single, already-validated address — see the module
 * doc comment's "Connection binding" section. Exported for tests: this
 * function must never touch `dns` again, by construction.
 */
export function buildPinnedLookup(validated: ValidatedAddress): LookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, validated.address, validated.family)
  }
}

// ─── Bounded body read ──────────────────────────────────────────────────

/**
 * The subset of a byte stream this module consumes. Declared structurally
 * rather than as `ReadableStream<Uint8Array>` because undici types
 * `Response.body` as `ReadableStream<any>` (from node:stream/web), which is
 * not assignable to the DOM lib's parameterized ReadableStream.
 */
interface ByteStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(): Promise<void>
}

interface ByteStream {
  getReader(): ByteStreamReader
}

async function readBoundedBytes(body: ByteStream | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done || !value) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ResponseTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

// ─── Public response shape ──────────────────────────────────────────────

export interface SafeFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  /** Final URL after following redirects (this hop's URL). */
  readonly url: string
  readonly headers: Headers
  /** Number of redirects followed to reach this response. */
  readonly hops: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

function buildSafeResponse(
  status: number,
  statusText: string,
  headers: Headers,
  url: string,
  hops: number,
  bytes: Uint8Array,
): SafeFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
    headers,
    hops,
    async text() {
      return new TextDecoder().decode(bytes)
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
  }
}

// ─── One hop: resolve, validate, pin, fetch ────────────────────────────────

export interface SafeFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | null
  /** Per-hop timeout in ms. Default: 10 000. */
  timeoutMs?: number
  /** Maximum redirects to follow. Default: 3. */
  maxRedirects?: number
  /** Maximum response body size in bytes. Default: 10 MiB. */
  maxResponseBytes?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

interface ResolvedOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | null
  timeoutMs: number
  maxRedirects: number
  maxResponseBytes: number
  userAgent: string
}

type HopOutcome = { kind: 'redirect'; location: URL } | { kind: 'terminal'; response: SafeFetchResponse }

/** One resolve+validate+pin+fetch cycle for a single URL. No redirect following. */
async function runHop(url: URL, hop: number, opts: ResolvedOptions): Promise<HopOutcome> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DisallowedSchemeError(url.protocol)
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const validated = await resolveValidatedAddress(hostname)
  const agent = new Agent({ connect: { lookup: buildPinnedLookup(validated) } })

  let res: Awaited<ReturnType<typeof undiciFetch>>
  try {
    res = await undiciFetch(url, {
      method: opts.method,
      headers: { 'User-Agent': opts.userAgent, ...opts.headers },
      body: opts.body ?? undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      dispatcher: agent,
    })
  } catch (err) {
    await agent.close().catch(() => {})
    throw err
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    await agent.close().catch(() => {})
    if (!location) throw new InvalidRedirectError(res.status, 'missing Location header')
    return { kind: 'redirect', location: new URL(location, url) }
  }

  let bytes: Uint8Array
  try {
    bytes = await readBoundedBytes(res.body, opts.maxResponseBytes)
  } finally {
    await agent.close().catch(() => {})
  }
  return { kind: 'terminal', response: buildSafeResponse(res.status, res.statusText, res.headers, url.href, hop, bytes) }
}

/**
 * Connection-bound, SSRF-safe fetch. Resolves, validates (fail-closed on any
 * disallowed candidate address), and pins the connection for the given URL,
 * following up to `maxRedirects` redirects — repeating the full
 * resolve/validate/pin cycle on every hop. Throws BlockedAddressError /
 * DisallowedSchemeError / TooManyRedirectsError / InvalidRedirectError /
 * ResponseTooLargeError for conditions this module itself enforces; network,
 * TLS, and timeout errors from the underlying fetch propagate unchanged so
 * callers can keep classifying them exactly as before (e.g. `.cause.code`,
 * `.name === 'TimeoutError'`).
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const resolvedOpts = {
    method: options.method,
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
  }

  let current = typeof input === 'string' ? new URL(input) : input
  for (let hop = 0; hop <= resolvedOpts.maxRedirects; hop++) {
    const outcome = await runHop(current, hop, resolvedOpts)
    if (outcome.kind === 'terminal') return outcome.response
    current = outcome.location
  }
  throw new TooManyRedirectsError(resolvedOpts.maxRedirects)
}
