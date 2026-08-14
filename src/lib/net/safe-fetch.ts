/**
 * safe-fetch — connection-bound, SSRF-safe **GET-only** text fetch for any URL
 * supplied by an untrusted source (a prospect's website, a client's sitemap
 * host, a redirect target neither of us chose, …).
 *
 * Prerequisite for PR #963, tracked by issue #965. Governance: issue #964.
 * Supersedes the primitives in PRs #967 and #968.
 *
 * ── Why v1 is GET-only, and why that is the design, not a shortcut ────────
 * The first attempt (#968) generalised this into a fetch that accepted any
 * method and body. That forced the module to reimplement the *entire* WHATWG
 * Fetch redirect algorithm — method downgrade rules, body replay, credential
 * stripping, `Content-*` header cleanup — and it got three of those details
 * wrong (`304` treated as a redirect, `HEAD` + `303` wrongly downgraded, and
 * `Content-*` headers surviving a POST→GET downgrade). None of that
 * complexity was needed: every caller #965 names (`prospecting/audit.ts`,
 * `site-audit/crawler.ts`) only ever needs to read a public page over GET.
 *
 * So the v1 contract is deliberately narrow. The following are **not part of
 * the contract** — not "not implemented yet":
 *   - no `method` (always GET), no `body`
 *   - no POST / PUT / PATCH / DELETE / HEAD
 *   - no caller-supplied `Authorization`, `Cookie`, or `Proxy-Authorization`
 *   - no caller override of `Host` / `:authority`
 * Each is rejected at the type level *and* at runtime (`assertHeadersAllowed`),
 * because a type-level-only ban is invisible to a JS caller or an `as any`.
 *
 * Consequences that make the redirect loop small enough to be obviously
 * correct: there is no method to downgrade, no body to replay, no `Content-*`
 * entity headers to strip, and no credentials that could leak to a hop the
 * *previous* server chose. The three defects above cannot be expressed.
 *
 * Not wired into any caller yet. `prospecting/audit.ts` and
 * `site-audit/crawler.ts` keep their own pre-existing guards until a follow-up
 * PR migrates them (see issue #965 "Compatibility"). The three format-only CMS
 * guards (`src/lib/cms/{ssrf,shopify,url}-guard.ts`) are a separate,
 * out-of-scope consolidation decision — do not import from or merge into them.
 *
 * ── Threat model ─────────────────────────────────────────────────────────
 * The URL — and every redirect hop — is attacker-controlled. The attacker is
 * assumed to **operate authoritative DNS** for the hostname, so they may
 * return any A/AAAA records: a public decoy answer beside a private one, or a
 * different answer between two resolutions of the same name (DNS rebinding).
 * The process making the request already holds full internal privileges, so
 * this module is the only thing between a hostile hostname and internal
 * infrastructure. Every property must hold against an *active* adversarial
 * DNS operator, not merely a static blocklist:
 *
 *   1. Never connect to loopback / private / link-local (full `fe80::/10`) /
 *      CGNAT / unspecified / multicast / reserved / cloud-metadata, IPv4 or
 *      IPv6, including both IPv4-mapped (`::ffff:0:0/96`) and IPv4-compatible
 *      (`::/96`) forms, by CIDR classification — never string prefixes.
 *   2. The validated address *is* the address the socket connects to; no
 *      second, unvalidated resolution can intervene (see "Connection
 *      binding").
 *   3. A multi-address DNS answer fails closed if **any** address is
 *      disallowed — checking only the first answer is bypassable by ordering.
 *   4. Every redirect hop is a brand-new untrusted URL: re-parsed,
 *      re-resolved, re-validated, re-pinned, with the hop count capped.
 *   5. Only `http:`/`https:` are ever dialed, re-checked on every hop.
 *   6. Host header, TLS SNI, and certificate verification use the original
 *      hostname — never the pinned IP. Pinning changes only *where the socket
 *      connects*, not what the server sees or how the cert is validated.
 *   7. Response size, DNS time, and per-hop request time are all bounded.
 *      Note the request timeout is per hop, so a redirect chain's worst case
 *      is (maxRedirects + 1) x timeoutMs.
 *
 * Explicitly not claimed: no defence against a server that is itself public
 * but proxies internally (an open proxy at a public IP), nor against
 * exfiltration to a public endpoint the attacker controls. Different controls.
 *
 * ── Connection binding ──────────────────────────────────────────────────
 * `resolveValidatedAddress()` resolves every candidate address for a hop's
 * hostname and validates all of them (#1/#3). `buildPinnedLookup()` wraps that
 * single validated address in a `net.LookupFunction` that never consults `dns`
 * again, and refuses outright if asked for a hostname it was not validated
 * for. That function is passed as `connect.lookup` to a **fresh** undici
 * `Agent` used only for this one hop. Undici's connector forwards `connect`
 * options straight into `net.connect`/`tls.connect` alongside
 * `host: hostname` (node_modules/undici/lib/core/connect.js), and Node calls
 * `lookup` exactly once, dialing whatever it returns. Since our lookup is a
 * constant, no live DNS call remains for a rebinding attacker's second answer
 * to occupy. `servername`/Host are still derived by undici from the request
 * URL (#6).
 *
 * Three details are load-bearing and verified empirically against undici 6.28
 * on Node 24 — read the tests before changing any of them:
 *
 *   a) **The callback shape is not optional.** Node signals the result shape
 *      it wants via `options.all`, and returning the wrong one is a hard
 *      `ERR_INVALID_IP_ADDRESS` — no connection at all. Node >= 20 defaults
 *      `autoSelectFamily` to true and undici 6 never overrides it, so the
 *      happy-eyeballs path (`{ hints: 1024, all: true }`, array result) is the
 *      one that runs in production. #968's first head returned only the
 *      single-address form and therefore could not connect to any hostname
 *      URL; its mocked tests all passed because the harness invoked the lookup
 *      with an empty options object, asserting a convention Node never uses.
 *      Do not force `autoSelectFamily: false` to dodge this — that would also
 *      disable legitimate IPv6→IPv4 fallback.
 *
 *   b) **A fresh Agent per hop is required.** With a reused keep-alive Agent,
 *      `connect.lookup` is *not called at all* for a reused socket, so sharing
 *      one Agent across hops would let hop 2 ride hop 1's connection and skip
 *      the entire resolve→validate→pin cycle. Do not hoist it for performance.
 *
 *   c) **The lookup surviving `Agent`'s option handling is an implicit undici
 *      contract.** `util.deepClone` is `JSON.parse(JSON.stringify())`, which
 *      destroys functions; it survives only because the constructor
 *      destructures `connect` out before cloning. A future undici could break
 *      pinning silently — the real-loopback suite is what would catch that.
 *
 * ── Dependency choice ───────────────────────────────────────────────────
 * `ipaddr.js` (MIT, zero deps) for classification: `.range()` is driven by a
 * maintained CIDR table, and `ipaddr.process()` unwraps IPv4-*mapped* IPv6 to
 * a real IPv4 object before classification. This module **allow-lists**
 * `'unicast'` rather than block-listing categories, so a dangerous range
 * nobody enumerated fails closed by default. The one place the table is
 * actually wrong is IPv4-*compatible* `::/96`, rejected explicitly below.
 * `undici` (MIT, zero deps) for `connect.lookup` — Node's own documented
 * dispatcher hook, and the implementation Node's global fetch is built on.
 * Rejected: third-party SSRF-guard packages (they validate a hostname then
 * hand off to the client's own separate resolution — the very check-then-
 * connect gap this exists to close); raw `net.connect` + hand-built HTTP/TLS
 * (large new attack surface for a hook undici already exposes);
 * `setGlobalDispatcher` (process-global, would alter every other outbound
 * call — pinning must be per-request).
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

export class DnsTimeoutError extends Error {
  constructor(public readonly hostname: string, public readonly timeoutMs: number) {
    super(`DNS resolution for "${hostname}" exceeded ${timeoutMs}ms`)
    this.name = 'DnsTimeoutError'
  }
}

/** A pinned lookup was invoked for a hostname it was not validated against. */
export class PinnedHostMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`pinned address was validated for "${expected}" but lookup asked for "${actual}"`)
    this.name = 'PinnedHostMismatchError'
  }
}

/** A caller passed a header the v1 contract does not permit. */
export class ForbiddenHeaderError extends Error {
  constructor(public readonly header: string) {
    super(`header not allowed by safeFetchText: ${header}`)
    this.name = 'ForbiddenHeaderError'
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
 * Allow-list, not a block-list: only ipaddr.js's `'unicast'` bucket is safe to
 * dial. Everything else (loopback, private, the full linkLocal `fe80::/10`,
 * CGNAT, unspecified, multicast, uniqueLocal, NAT64, 6to4, Teredo,
 * reserved/benchmarking/documentation, …) is rejected without this module
 * having to name each category. Exported for tests.
 *
 * Two things this handles that the range table alone does not:
 *
 *   1. **IPv4-mapped** IPv6 (`::ffff:0:0/96`) — `ipaddr.process()` unwraps it
 *      to a real IPv4 object first, so `::ffff:7f00:1` (Node's canonical form
 *      for `[::ffff:127.0.0.1]`) and the dotted spelling both land on
 *      `127.0.0.0/8`.
 *   2. **IPv4-compatible** IPv6 (`::/96`, e.g. `::7f00:1` == `::127.0.0.1`) —
 *      `process()` does NOT unwrap this and ipaddr.js has no `::/96` entry, so
 *      `::7f00:1` and `::a9fe:a9fe` (cloud metadata) would otherwise classify
 *      as plain `unicast`. Verified against ipaddr.js 2.5.0's SpecialRanges.
 *      The form is deprecated by RFC 4291 §2.5.5.1 and has no legitimate use,
 *      so the whole block is rejected — which also covers `::` and `::1` a
 *      second way.
 *
 * Fails closed on unparseable input: `ipaddr.process()` throws a bare Error
 * for malformed addresses, and this function is exported as a reusable
 * classifier, so a caller doing `instanceof BlockedAddressError` mapping must
 * never see a classification failure as "allowed".
 */
export function classifyAddress(address: string): ClassifiedAddress {
  let parsed: ReturnType<typeof ipaddr.process>
  try {
    parsed = ipaddr.process(address)
  } catch {
    return { address, family: 4, blocked: true, range: 'unparseable' }
  }

  if (parsed.kind() === 'ipv6') {
    const parts = (parsed as ipaddr.IPv6).parts
    // High 96 bits all zero => IPv4-compatible IPv6 (::/96), see note 2 above.
    if (parts.slice(0, 6).every(p => p === 0)) {
      return { address, family: 6, blocked: true, range: 'ipv4Compatible' }
    }
  }

  const range = parsed.range()
  const family: 4 | 6 = parsed.kind() === 'ipv4' ? 4 : 6
  return { address, family, blocked: range !== 'unicast', range }
}

// ─── Resolve-all, validate-all, fail-closed ────────────────────────────────

export interface ValidatedAddress {
  readonly address: string
  readonly family: 4 | 6
  /** The hostname this address was validated for. */
  readonly hostname: string
}

const DEFAULT_DNS_TIMEOUT_MS = 5_000

/**
 * Resolves every candidate address for `hostname` (or classifies it directly
 * if it is already an IP literal) and throws BlockedAddressError if *any*
 * candidate is disallowed — a DNS answer with one public and one private
 * address must fail closed, not pass because the first record looked fine.
 * DNS lookup failures are not caught here; they propagate so callers keep
 * their own "couldn't resolve" classification. Exported for tests.
 *
 * The lookup is bounded by `dnsTimeoutMs`. `dns.lookup` accepts no
 * AbortSignal, so this races it against a timer rather than truly cancelling:
 * the underlying getaddrinfo may still be in flight, but the caller stops
 * waiting. Without it, an attacker's nameserver that simply never answers
 * would stall for the resolver's whole retry budget — time that sits entirely
 * outside the per-hop request timeout.
 */
export async function resolveValidatedAddress(
  hostname: string,
  dnsTimeoutMs: number = DEFAULT_DNS_TIMEOUT_MS,
): Promise<ValidatedAddress> {
  const literalFamily = isIP(hostname)
  const candidates =
    literalFamily !== 0
      ? [{ address: hostname, family: literalFamily }]
      : await withDnsTimeout(dnsLookup(hostname, { all: true, verbatim: true }), hostname, dnsTimeoutMs)

  const classified = candidates.map(c => classifyAddress(c.address))
  const blocked = classified.find(c => c.blocked)
  if (blocked) throw new BlockedAddressError(hostname, blocked.address, blocked.range)

  const chosen = classified[0]
  return { address: chosen.address, family: chosen.family, hostname }
}

/** Races a DNS lookup against a timer; see resolveValidatedAddress. */
async function withDnsTimeout<T>(promise: Promise<T>, hostname: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DnsTimeoutError(hostname, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * A net.LookupFunction that returns the single pre-validated address without
 * ever consulting `dns` — see the module doc comment's "Connection binding"
 * section. Exported for tests.
 *
 * 🔴 `options.all` is NOT ignorable, even though the address is fixed: Node
 *    tells the lookup which result shape it expects and rejects the other with
 *    a hard `ERR_INVALID_IP_ADDRESS`. See note (a) in the module doc comment —
 *    this exact mistake made #968's first head unable to connect at all.
 *      - `all: true`  → callback(null, [{ address, family }])
 *      - otherwise    → callback(null, address, family)
 *
 *    Exactly one address is returned on purpose. Node dials each address a
 *    lookup returns, in order, so a multi-address return would only be safe if
 *    every entry were validated; one validated address makes that unable to go
 *    wrong.
 */
export function buildPinnedLookup(validated: ValidatedAddress): LookupFunction {
  return (hostname, options, callback) => {
    // Defence in depth. The pin is only correct for the hostname it was
    // validated against, and this function would otherwise happily redirect
    // *any* hostname to that address — so if a future change ever shares one
    // Agent across hops or origins, fail loudly here instead of silently
    // dialing host B at host A's validated address.
    if (hostname && hostname !== validated.hostname) {
      callback(new PinnedHostMismatchError(validated.hostname, hostname), '')
      return
    }
    if (options?.all) {
      callback(null, [{ address: validated.address, family: validated.family }])
    } else {
      callback(null, validated.address, validated.family)
    }
  }
}

// ─── Header policy ────────────────────────────────────────────────────────

/**
 * Headers a caller may not supply. Credentials are barred because the
 * *previous* server chooses the next hop, so any credential is one redirect
 * away from being handed to an attacker-chosen host; `host`/`:authority` are
 * barred because overriding them would decouple the Host/SNI the server sees
 * from the hostname this module validated and pinned (contract #6).
 */
const FORBIDDEN_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'host', ':authority']

/**
 * Enforces the header ban at runtime, not just in the type. A JS caller, or a
 * TS caller with `as any`, would otherwise slip straight past the type.
 * Exported for tests.
 */
export function assertHeadersAllowed(headers: Record<string, string> | undefined): void {
  if (!headers) return
  for (const name of Object.keys(headers)) {
    if (FORBIDDEN_HEADERS.includes(name.toLowerCase().trim())) {
      throw new ForbiddenHeaderError(name)
    }
  }
}

// ─── Redirect policy ──────────────────────────────────────────────────────

/**
 * The only statuses treated as redirects. Everything else in 3xx — notably
 * `304 Not Modified`, plus `300`, `305` and `306` — is a terminal response and
 * must NOT be required to carry a `Location` header.
 *
 * 🔴 A naive `status >= 300 && status < 400` check (what #968 shipped) turns a
 *    perfectly normal `304` into an `InvalidRedirectError` because it has no
 *    Location. `304` is what a conditional GET returns, and `305`/`306` are
 *    proxy-related and deprecated — following either would be worse than
 *    returning it to the caller.
 *
 * Because v1 is always a bodyless GET, none of the method/body rules of the
 * Fetch redirect algorithm apply: 303 needs no method downgrade, 307/308 have
 * no body to preserve, and there are no `Content-*` entity headers to strip.
 * That is the whole reason this set can be a flat list.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Exported for tests. */
export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status)
}

// ─── Bounded body read ──────────────────────────────────────────────────

/**
 * undici's `Response.body` is a `ReadableStream<Uint8Array>`; only the reader
 * surface is used so tests can supply a minimal stub.
 */
interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    cancel(): Promise<void>
  }
}

async function readBoundedBytes(body: ByteStream | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    // Checked BEFORE buffering the chunk, so an oversized response is never
    // accumulated in full before being rejected.
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

// ─── Public API ───────────────────────────────────────────────────────────

export interface SafeFetchTextResponse {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  /** Final URL after following redirects. */
  readonly url: string
  readonly headers: Headers
  /** Number of redirects followed to reach this response. */
  readonly hops: number
  /** Decoded body. Always UTF-8; `Content-Type` charset is not honoured. */
  readonly text: string
}

/**
 * Options for {@link safeFetchText}.
 *
 * There is deliberately no `method` and no `body`: v1 is GET-only. See the
 * module doc comment for why that is the contract rather than a limitation.
 */
export interface SafeFetchTextOptions {
  /**
   * Extra request headers. `Authorization`, `Cookie`,
   * `Proxy-Authorization`, `Host` and `:authority` are rejected — see
   * FORBIDDEN_HEADERS.
   */
  headers?: Record<string, string>
  /** Per-hop request timeout in ms. Default: 10 000. */
  timeoutMs?: number
  /** Per-hop DNS resolution timeout in ms. Default: 5 000. */
  dnsTimeoutMs?: number
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
  headers?: Record<string, string>
  timeoutMs: number
  dnsTimeoutMs: number
  maxRedirects: number
  maxResponseBytes: number
  userAgent: string
}

type HopOutcome =
  | { kind: 'redirect'; location: URL }
  | { kind: 'terminal'; response: SafeFetchTextResponse }

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>

/**
 * Validates the URL, pins the validated address to a fresh Agent, and issues
 * the GET. Returns the response together with the Agent, which the caller must
 * close on every path.
 */
async function dispatchPinnedGet(
  url: URL,
  opts: ResolvedOptions,
): Promise<{ res: UndiciResponse; agent: Agent }> {
  // Re-checked on every hop, before any DNS or socket work, because the
  // previous server chose this URL.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DisallowedSchemeError(url.protocol)
  }

  // URL.hostname keeps the brackets on an IPv6 literal; net.isIP() and the
  // classifier both want the bare form.
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const validated = await resolveValidatedAddress(hostname, opts.dnsTimeoutMs)
  // Fresh Agent per hop — load-bearing, see note (b) in the module doc.
  const agent = new Agent({ connect: { lookup: buildPinnedLookup(validated) } })

  try {
    const res = await undiciFetch(url, {
      method: 'GET',
      headers: { 'User-Agent': opts.userAgent, ...opts.headers },
      // Manual: undici must never follow a redirect itself, or the next hop
      // would skip this function's validation and pinning entirely.
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      dispatcher: agent,
    })
    return { res, agent }
  } catch (err) {
    await agent.close().catch(() => {})
    throw err
  }
}

/**
 * One resolve → validate → pin → GET cycle for a single URL. Follows nothing;
 * the caller's loop decides whether to continue.
 */
async function runHop(url: URL, hop: number, opts: ResolvedOptions): Promise<HopOutcome> {
  const { res, agent } = await dispatchPinnedGet(url, opts)

  if (isRedirectStatus(res.status)) {
    const location = res.headers.get('location')
    // Cancel before closing: undici's close() waits on in-flight responses, so
    // an unread body larger than a socket buffer (~64 KiB) stalls the hop until
    // the abort timer fires.
    await res.body?.cancel().catch(() => {})
    await agent.close().catch(() => {})
    if (!location) throw new InvalidRedirectError(res.status, 'missing Location header')
    return { kind: 'redirect', location: new URL(location, url) }
  }

  let bytes: Uint8Array
  try {
    bytes = await readBoundedBytes(res.body as ByteStream | null, opts.maxResponseBytes)
  } finally {
    await agent.close().catch(() => {})
  }

  return {
    kind: 'terminal',
    response: {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      url: url.href,
      headers: res.headers,
      hops: hop,
      text: new TextDecoder().decode(bytes),
    },
  }
}

/**
 * Connection-bound, SSRF-safe GET of a text resource.
 *
 * Resolves and validates every candidate address (fail-closed if any is
 * disallowed), pins the validated address to the actual socket, and follows up
 * to `maxRedirects` redirects — repeating the full resolve/validate/pin cycle
 * on every hop.
 *
 * Throws `BlockedAddressError`, `DisallowedSchemeError`,
 * `TooManyRedirectsError`, `InvalidRedirectError`, `ResponseTooLargeError`,
 * `DnsTimeoutError`, `PinnedHostMismatchError` or `ForbiddenHeaderError` for
 * conditions this module enforces. Network, TLS and timeout errors from the
 * underlying fetch propagate **unchanged**, so callers can keep classifying
 * them exactly as before (e.g. `err.cause.code`, `err.name === 'TimeoutError'`).
 *
 * A non-2xx response is returned, not thrown — including `304` and any other
 * 3xx that is not in the redirect set.
 */
export async function safeFetchText(
  input: string | URL,
  options: SafeFetchTextOptions = {},
): Promise<SafeFetchTextResponse> {
  assertHeadersAllowed(options.headers)

  const opts: ResolvedOptions = {
    headers: options.headers,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    dnsTimeoutMs: options.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
  }

  let current = typeof input === 'string' ? new URL(input) : input
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const outcome = await runHop(current, hop, opts)
    if (outcome.kind === 'terminal') return outcome.response
    // Each hop re-enters runHop(), which re-parses, re-resolves, re-validates
    // and re-pins. Nothing is carried over from the previous hop.
    current = outcome.location
  }
  throw new TooManyRedirectsError(opts.maxRedirects)
}
