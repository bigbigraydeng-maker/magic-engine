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
 *      cloud-metadata address, IPv4 or IPv6, including both IPv4-mapped
 *      (`::ffff:0:0/96`) and IPv4-compatible (`::/96`) IPv6 forms, using
 *      CIDR-correct classification (not string prefixes). See
 *      `classifyAddress()` — the two embedded-IPv4 forms need different
 *      handling and only one of them is covered by the range table.
 *   2. The address that was validated is *provably* the address the socket
 *      connects to — no second, unvalidated DNS resolution can happen between
 *      the check and the connect (see "Connection binding" below).
 *   3. If a hostname resolves to multiple addresses and even one is
 *      disallowed, the whole request is rejected (fail closed) — a client
 *      that only checks "the first answer" can be bypassed by putting the
 *      allowed address first and the attack address second.
 *   4. Only the five statuses `fetch` itself treats as redirects (301, 302,
 *      303, 307, 308) are followed — a 304 Not Modified or other 3xx has no
 *      Location and must reach the caller as a normal terminal response, not
 *      an error. Every redirect hop is a brand-new untrusted URL and re-runs
 *      the exact same validation + binding; a public URL redirecting to a
 *      private one cannot bypass the guard, and the hop count is capped.
 *      Because the *previous* server chooses the next hop, credential headers
 *      (Authorization / Cookie / Proxy-Authorization) are dropped when a hop
 *      leaves the origin; 303 (except when the method is already GET/HEAD)
 *      and 301/302-on-POST downgrade to a bodyless GET, stripping the
 *      now-stale body-description headers (Content-Type et al.) along with
 *      it — matching platform `fetch`, which this module has to reimplement
 *      because it owns the redirect loop.
 *   5. Only http/https are ever dialed — file:, data:, gopher:, ftp:, etc.
 *      are rejected before any network activity, on every hop.
 *   6. Host header, TLS SNI, and certificate verification use the original
 *      hostname — never the resolved IP — so this only pins *where the
 *      socket connects*, not what the server sees or how the cert is checked.
 *   7. Response size, DNS time, and per-hop request time are all bounded, so a
 *      hostile or oversized response can't exhaust memory or hang the caller.
 *      Note the request timeout is *per hop*, so a redirect chain's worst case
 *      is (maxRedirects + 1) x timeoutMs; a redirect body is cancelled before
 *      its Agent closes so a 3xx with a large unread body cannot stall a hop.
 *
 * ── Connection binding ──────────────────────────────────────────────────
 * `resolveValidatedAddress()` resolves every candidate address for a hop's
 * hostname and validates all of them up front (#1/#3 above). `buildPinnedLookup()`
 * then wraps that single, already-validated address in a `net.LookupFunction`
 * that returns that literal address without ever calling `dns` again (it
 * refuses outright if asked for a *different* hostname than the one that was
 * validated). That function is passed as `connect.lookup` to a fresh undici
 * `Agent` used only for this one hop.
 * Undici's connector forwards `connect` options straight through to
 * `net.connect`/`tls.connect` alongside `host: hostname` (see
 * node_modules/undici/lib/core/connect.js) — Node calls `lookup` exactly once
 * to turn that hostname into a socket address and dials whatever it returns,
 * with no other resolution step. Because our `lookup` is a constant, there is
 * no live DNS call left for a rebinding attacker's second answer to land in.
 * `servername`/Host are derived by undici from the request URL as normal (#6)
 * — pinning only touches the low-level connect address.
 *
 * Two load-bearing details, both verified empirically against undici 6.28 on
 * Node 24 rather than assumed from the docs:
 *
 *   a) **A fresh Agent per hop is required, not a tidiness choice.** With a
 *      keep-alive Agent reused across requests, an established socket is
 *      reused and `connect.lookup` is *not called at all* for the reused
 *      request — so sharing one Agent across redirect hops would let hop 2
 *      ride hop 1's connection, skipping the whole
 *      resolve→validate→pin cycle. (Cross-*host* reuse would additionally try
 *      to dial host B at host A's pinned address; the pinned lookup's
 *      hostname check turns that into a loud failure rather than a silent
 *      bypass, but it cannot see a reused socket at all — no lookup happens.)
 *      Do not hoist this Agent for performance.
 *
 *   b) **The lookup function surviving `Agent`'s option handling is an
 *      implicit contract.** `util.deepClone` is `JSON.parse(JSON.stringify())`
 *      (lib/core/util.js), which destroys functions; it is only safe here
 *      because the Agent constructor destructures `connect` *out* of `options`
 *      before cloning and re-attaches it with a shallow spread
 *      (lib/dispatcher/agent.js). If a future undici version folds `connect`
 *      into the deepClone, pinning would silently stop being applied — the
 *      un-mocked integration test is what would catch that.
 *
 * ── Dependency / dispatcher choice ──────────────────────────────────────
 * IP classification: `ipaddr.js` (zero deps, MIT, ~30M weekly downloads) —
 * `ipaddr.process()` canonicalizes IPv4-*mapped* IPv6 to a plain IPv4 object
 * before classification (handles `::ffff:7f00:1` for free, no regex), and
 * `.range()` is driven by a maintained CIDR table (includes the full
 * `fe80::/10`, `100.64.0.0/10` CGNAT, `fc00::/7`, NAT64, 6to4, Teredo,
 * deprecated/site-local, discard-only, and RFC reserved ranges) instead of
 * hand-rolled prefixes. This module trusts only the `'unicast'` bucket
 * (allow-list, not a block-list that has to enumerate every dangerous
 * category by name). The one gap the table does *not* cover is IPv4-compatible
 * `::/96`, which `classifyAddress()` rejects explicitly — see its comment.
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

/** A pinned lookup was invoked for a hostname it was not validated against. */
export class PinnedHostMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`pinned address was validated for "${expected}" but lookup asked for "${actual}"`)
    this.name = 'PinnedHostMismatchError'
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
 * CGNAT, unspecified, multicast, uniqueLocal, NAT64, 6to4, Teredo,
 * reserved/benchmarking/documentation ranges, …) is rejected without having
 * to name each category. Exported for tests.
 *
 * Two things this handles that the range table alone does not:
 *
 *   1. **IPv4-mapped** IPv6 (`::ffff:0:0/96`) — `ipaddr.process()` unwraps it
 *      to a real IPv4 object first, so `::ffff:7f00:1` and
 *      `::ffff:127.0.0.1` both land on `127.0.0.0/8`.
 *   2. **IPv4-compatible** IPv6 (`::/96`, e.g. `::7f00:1` == `::127.0.0.1`)
 *      — `process()` does NOT unwrap this and ipaddr.js has no `::/96` entry,
 *      so `::7f00:1` and `::a9fe:a9fe` (cloud metadata) would otherwise
 *      classify as plain `unicast`. Verified against ipaddr.js 2.5.0's
 *      SpecialRanges table. This form is deprecated by RFC 4291 §2.5.5.1 and
 *      has no legitimate use, so the whole `::/96` block is rejected — which
 *      also covers `::` and `::1` a second way.
 *
 * Fails closed on unparseable input: `ipaddr.process()` throws a bare Error
 * for malformed addresses, and this function is exported as a reusable
 * classifier, so a caller doing `instanceof BlockedAddressError` error
 * mapping must not be able to see a classification failure as "allowed".
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

export class DnsTimeoutError extends Error {
  constructor(public readonly hostname: string, public readonly timeoutMs: number) {
    super(`DNS resolution for "${hostname}" exceeded ${timeoutMs}ms`)
    this.name = 'DnsTimeoutError'
  }
}

/** Default ceiling on how long we wait for DNS. See resolveValidatedAddress. */
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
 * waiting. Without this an attacker's authoritative nameserver that simply
 * never answers would stall the request for the resolver's whole retry
 * budget — time that sits entirely outside the per-hop fetch timeout.
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
 * A net.LookupFunction that ignores the `hostname` it is called with and
 * always hands back the single, already-validated address — see the module
 * doc comment's "Connection binding" section. Exported for tests: this
 * function must never touch `dns` again, by construction.
 *
 * 🔴 `options.all` is NOT ignorable, even though the address is fixed. Node
 *    tells the lookup which result shape it expects, and returning the wrong
 *    one is a hard `ERR_INVALID_IP_ADDRESS` (no connection at all):
 *      - `all: true`  → callback(null, [{ address, family }])
 *      - otherwise    → callback(null, address, family)
 *    Node >= 20 defaults `autoSelectFamily` to true and undici 6 does not
 *    override it, so the happy-eyeballs path calls this with
 *    `{ hints: 1024, all: true }` — i.e. the array branch is the one that
 *    actually runs in production. Verified empirically against undici 6.28 on
 *    Node 24; see the un-mocked 127.0.0.1 integration test that covers both
 *    branches. Do not "simplify" this back to a single callback shape, and do
 *    not force `autoSelectFamily: false` to dodge it — that would also
 *    disable legitimate IPv6→IPv4 fallback.
 *
 *    Exactly one address is returned on purpose. Node dials each address a
 *    lookup returns, in order, so a multi-address return would only be safe
 *    if every entry were validated; keeping it to the single validated
 *    address makes that impossible to get wrong.
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

type HopOutcome =
  | { kind: 'redirect'; location: URL; status: number }
  | { kind: 'terminal'; response: SafeFetchResponse }

/**
 * The only statuses `fetch` (and this module) treats as a redirect to follow.
 * 300 (Multiple Choices) and 306 (unused) are not on this list, and — this is
 * the case that actually bites — neither is 304 (Not Modified): a caller
 * doing a conditional GET with If-None-Match/If-Modified-Since gets a bare
 * 304 with no Location header. Treating it as a redirect turned a normal,
 * successful "not modified" response into a thrown InvalidRedirectError.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Headers that must never survive a cross-origin redirect. The redirect
 * target is chosen by the *previous* server, so forwarding credentials to it
 * hands them to whoever controls that hop — the platform `fetch` strips these
 * on cross-origin redirects and, because this module implements the redirect
 * loop itself, it has to do the same rather than inherit the protection.
 */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization']

/**
 * Headers that describe a request body. Once a redirect downgrades a request
 * to a bodyless GET, forwarding these makes the next hop see a Content-Type
 * (or Content-Length, etc.) for a request that carries no body at all —
 * platform `fetch` drops them on the same downgrade, so this reimplementation
 * has to as well.
 */
const CONTENT_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']

/** Same scheme+host+port. Credentials may only be re-sent within one origin. */
function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host
}

function stripHeaders(
  headers: Record<string, string> | undefined,
  blocked: readonly string[],
): Record<string, string> | undefined {
  if (!headers) return headers
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!blocked.includes(k.toLowerCase())) out[k] = v
  }
  return out
}

/**
 * Applies the standard method/body rewrite for a redirect, matching the fetch
 * spec (https://fetch.spec.whatwg.org/#http-redirect-fetch) so callers get no
 * surprises versus platform `fetch`:
 *   - 303 becomes GET and drops the body, *unless* the original method was
 *     already GET or HEAD — a HEAD request must stay HEAD, not silently turn
 *     into a GET that downloads a body the caller never asked for;
 *   - 301/302 turn POST into GET and drop the body (other methods on
 *     301/302, e.g. PUT/DELETE, are preserved per spec);
 *   - 307/308 always preserve both method and body.
 * Whenever the method+body is downgraded, headers that describe the
 * now-nonexistent body (Content-Type et al.) are stripped so the next hop
 * doesn't see stale metadata for a body that no longer exists. Credentials
 * are separately dropped whenever the hop leaves the origin — both rules can
 * apply to the same hop.
 */
function optionsForRedirect(opts: ResolvedOptions, status: number, from: URL, to: URL): ResolvedOptions {
  const method = (opts.method ?? 'GET').toUpperCase()
  const downgrade =
    (status === 303 && method !== 'GET' && method !== 'HEAD') ||
    ((status === 301 || status === 302) && method === 'POST')
  const crossOrigin = !isSameOrigin(from, to)

  let headers = opts.headers
  if (downgrade) headers = stripHeaders(headers, CONTENT_HEADERS)
  if (crossOrigin) headers = stripHeaders(headers, CREDENTIAL_HEADERS)

  return {
    ...opts,
    method: downgrade ? 'GET' : opts.method,
    body: downgrade ? null : opts.body,
    headers,
  }
}

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

  if (REDIRECT_STATUSES.has(res.status)) {
    const location = res.headers.get('location')
    // 🔴 Cancel the redirect body BEFORE closing the Agent. A 3xx may carry a
    //    body, and undici's close() waits for in-flight responses to finish:
    //    with an unread body over ~64 KiB (one socket buffer) close() hangs
    //    until AbortSignal burns the socket, so each hop costs a full
    //    timeoutMs. A chain of 3xx-with-large-body then stalls one request for
    //    (maxRedirects+1) x timeoutMs while holding a socket per hop — an
    //    amplification vector for anything crawling attacker-supplied URLs.
    await res.body?.cancel().catch(() => {})
    await agent.close().catch(() => {})
    if (!location) throw new InvalidRedirectError(res.status, 'missing Location header')
    return { kind: 'redirect', location: new URL(location, url), status: res.status }
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
  let hopOpts: ResolvedOptions = resolvedOpts
  for (let hop = 0; hop <= resolvedOpts.maxRedirects; hop++) {
    const outcome = await runHop(current, hop, hopOpts)
    if (outcome.kind === 'terminal') return outcome.response
    hopOpts = optionsForRedirect(hopOpts, outcome.status, current, outcome.location)
    current = outcome.location
  }
  throw new TooManyRedirectsError(resolvedOpts.maxRedirects)
}
