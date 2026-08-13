import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'
import { buildConnector, Client } from 'undici'

const IPV4_COMPATIBLE_CIDR = ipaddr.parseCIDR('::/96')

export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'blocked_address'
  | 'dns_failed'
  | 'request_failed'
  | 'redirect_without_location'
  | 'too_many_redirects'
  | 'response_too_large'
  | 'timeout'

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode
  readonly url: string
  readonly status?: number
  override readonly cause?: unknown

  constructor(code: SafeFetchErrorCode, url: string, options?: { status?: number; cause?: unknown }) {
    super(`${code}: ${url}`)
    this.name = 'SafeFetchError'
    this.code = code
    this.url = url
    this.status = options?.status
    this.cause = options?.cause
  }
}

export interface SafeFetchTextOptions {
  readonly headers?: Readonly<Record<string, string>>
  /** Per-hop DNS, connection, headers and body timeout. */
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly maxRedirects: number
}

export interface SafeFetchTextResult {
  readonly ok: boolean
  readonly status: number
  readonly finalUrl: string
  readonly text: string
}

interface BoundResponseBody {
  text(): Promise<string>
  destroy(error?: Error): void
}

interface BoundResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: BoundResponseBody
}

interface BoundClient {
  request(options: {
    readonly path: string
    readonly headers?: Readonly<Record<string, string>>
    readonly signal: AbortSignal
  }): Promise<BoundResponse>
  close(): Promise<void>
}

export type BoundClientFactory = (
  origin: string,
  pinned: ResolvedAddress,
  limits: Pick<SafeFetchTextOptions, 'timeoutMs' | 'maxResponseBytes'>,
) => BoundClient

export interface SafeFetchDependencies {
  readonly resolveHost?: ResolveHost
  readonly createBoundClient?: BoundClientFactory
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function normaliseAddress(address: string): ResolvedAddress {
  const parsed = ipaddr.process(stripIpv6Brackets(address))
  return { address: parsed.toString(), family: parsed.kind() === 'ipv4' ? 4 : 6 }
}

/** Fail closed: only ipaddr.js's global unicast category is fetchable. */
export function isPublicIpAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(stripIpv6Brackets(address))
    if (parsed.kind() === 'ipv6' && parsed.match(IPV4_COMPATIBLE_CIDR)) return false
    return ipaddr.process(stripIpv6Brackets(address)).range() === 'unicast'
  } catch {
    return false
  }
}

async function defaultResolveHost(hostname: string): Promise<readonly ResolvedAddress[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  )
}

export function createPinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback): void => {
    if (typeof options === 'object' && options.all) {
      const allCallback = callback as (
        error: NodeJS.ErrnoException | null,
        addresses: LookupAddress[],
      ) => void
      allCallback(null, [pinned])
      return
    }
    const oneCallback = callback as (
      error: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void
    oneCallback(null, pinned.address, pinned.family)
  }
}

function defaultCreateBoundClient(
  origin: string,
  pinned: ResolvedAddress,
  limits: Pick<SafeFetchTextOptions, 'timeoutMs' | 'maxResponseBytes'>,
): BoundClient {
  // The Client origin remains the original hostname. Only socket lookup is
  // pinned, so HTTP Host, TLS SNI and certificate verification stay hostname-bound.
  const client = new Client(origin, {
    connect: buildConnector({ lookup: createPinnedLookup(pinned), timeout: limits.timeoutMs }),
    headersTimeout: limits.timeoutMs,
    bodyTimeout: limits.timeoutMs,
    maxResponseSize: limits.maxResponseBytes,
    pipelining: 0,
    autoSelectFamily: false,
  })
  return {
    async request(options): Promise<BoundResponse> {
      const response = await client.request({ ...options, method: 'GET' })
      return { statusCode: response.statusCode, headers: response.headers, body: response.body }
    },
    close: () => client.close(),
  }
}

function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (cause) {
    throw new SafeFetchError('invalid_url', rawUrl, { cause })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeFetchError('unsupported_scheme', rawUrl)
  }
  if (parsed.username || parsed.password) throw new SafeFetchError('invalid_url', rawUrl)
  return parsed
}

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SafeFetchError('timeout', url)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function resolveAndValidate(
  url: URL,
  resolveHost: ResolveHost,
  timeoutMs: number,
): Promise<ResolvedAddress> {
  const literal = stripIpv6Brackets(url.hostname)
  if (ipaddr.isValid(literal)) {
    if (!isPublicIpAddress(literal)) throw new SafeFetchError('blocked_address', url.href)
    return normaliseAddress(literal)
  }
  let records: readonly ResolvedAddress[]
  try {
    records = await timeoutAfter(resolveHost(url.hostname), timeoutMs, url.href)
  } catch (cause) {
    if (cause instanceof SafeFetchError) throw cause
    throw new SafeFetchError('dns_failed', url.href, { cause })
  }
  if (records.length === 0) throw new SafeFetchError('dns_failed', url.href)
  if (records.some(({ address }) => !isPublicIpAddress(address))) {
    throw new SafeFetchError('blocked_address', url.href)
  }
  return normaliseAddress(records[0].address)
}

function firstHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : value?.[0]
}

function sanitiseHeaders(headers?: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const lower = name.toLowerCase()
    return lower !== 'host' && lower !== ':authority'
  }))
}

function mapRequestError(url: string, cause: unknown): SafeFetchError {
  if (cause instanceof SafeFetchError) return cause
  const error = cause as { name?: string; code?: string }
  const timeoutCodes = ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || timeoutCodes.includes(error.code ?? '')) {
    return new SafeFetchError('timeout', url, { cause })
  }
  if (error.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE') {
    return new SafeFetchError('response_too_large', url, { cause })
  }
  return new SafeFetchError('request_failed', url, { cause })
}

async function requestHop(
  parsed: URL,
  options: SafeFetchTextOptions,
  resolveHost: ResolveHost,
  createBoundClient: BoundClientFactory,
): Promise<{ response: BoundResponse; client: BoundClient }> {
  const pinned = await resolveAndValidate(parsed, resolveHost, options.timeoutMs)
  const client = createBoundClient(parsed.origin, pinned, options)
  try {
    const response = await client.request({
      path: `${parsed.pathname}${parsed.search}`,
      headers: sanitiseHeaders(options.headers),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    return { response, client }
  } catch (cause) {
    await client.close().catch(() => undefined)
    throw mapRequestError(parsed.href, cause)
  }
}

function nextRedirectUrl(response: BoundResponse, parsed: URL, startUrl: string, hop: number, max: number): string {
  const location = firstHeader(response.headers, 'location')
  if (!location) {
    throw new SafeFetchError('redirect_without_location', parsed.href, { status: response.statusCode })
  }
  if (hop === max) throw new SafeFetchError('too_many_redirects', startUrl)
  try {
    return new URL(location, parsed).href
  } catch (cause) {
    throw new SafeFetchError('invalid_url', location, { cause })
  }
}

async function consumeResponse(response: BoundResponse, client: BoundClient, parsed: URL): Promise<SafeFetchTextResult> {
  const ok = response.statusCode >= 200 && response.statusCode < 300
  try {
    const text = ok ? await response.body.text() : ''
    if (!ok) response.body.destroy()
    return { ok, status: response.statusCode, finalUrl: parsed.href, text }
  } catch (cause) {
    throw mapRequestError(parsed.href, cause)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function safeFetchText(
  startUrl: string,
  options: SafeFetchTextOptions,
  dependencies: SafeFetchDependencies = {},
): Promise<SafeFetchTextResult> {
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost
  const createBoundClient = dependencies.createBoundClient ?? defaultCreateBoundClient
  let currentUrl = startUrl
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const parsed = parseHttpUrl(currentUrl)
    const { response, client } = await requestHop(parsed, options, resolveHost, createBoundClient)
    if (response.statusCode < 300 || response.statusCode >= 400) {
      return consumeResponse(response, client, parsed)
    }
    response.body.destroy()
    await client.close().catch(() => undefined)
    currentUrl = nextRedirectUrl(response, parsed, startUrl, hop, options.maxRedirects)
  }
  throw new SafeFetchError('too_many_redirects', startUrl)
}
