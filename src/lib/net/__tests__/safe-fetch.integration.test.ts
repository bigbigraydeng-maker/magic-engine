/**
 * safe-fetch — real-socket integration tests. **undici is NOT mocked here.**
 *
 * Why this file exists, in one sentence: the sibling unit suite mocks
 * `undici.Agent` and `undici.fetch`, so it verifies the *options object* we
 * hand to undici and nothing about whether undici and Node actually accept
 * it — and a version of `buildPinnedLookup()` that returned the wrong
 * callback shape passed all of those tests while failing 100% of real
 * connections with ERR_INVALID_IP_ADDRESS.
 *
 * These tests dial **loopback listeners created in-process** (127.0.0.1 on an
 * ephemeral port). No external/internet host is contacted and nothing is
 * fetched from production. Hostnames end in `.invalid`, which RFC 2606
 * guarantees can never resolve — so a request that *succeeds* is itself proof
 * that the pinned lookup, not DNS, supplied the connect address.
 *
 * ── A structural limit worth stating plainly ─────────────────────────────
 * `safeFetch()` cannot be driven end-to-end to a local listener, and that is
 * not a gap in the tests — it is the module working. `safeFetch()` resolves
 * the hostname itself and refuses any loopback/private result, so:
 *   - a `.invalid` host fails at the DNS step (ENOTFOUND, before pinning);
 *   - a host that really resolves to 127.0.0.1 is correctly *blocked*.
 * Binding a listener to an address that classifies as public would need root.
 * So the coverage is split deliberately:
 *   - here: the *mechanism* over real sockets — pinned lookup + real undici
 *     Agent + real TCP/TLS (callback shape, option survival, Host/SNI/cert),
 *     and the premise behind the redirect-body fix (that an uncancelled 3xx
 *     body really does hang `Agent.close()` and cancelling really does fix it);
 *   - the unit suite: that `safeFetch()` itself performs those steps
 *     (cancels the redirect body before closing, wires the abort signal, …).
 * Neither half is sufficient alone; the earlier callback-shape bug slipped
 * through precisely because only the mocked half existed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'
import { safeFetch, buildPinnedLookup } from '../safe-fetch'

interface SeenRequest {
  host?: string
  remoteAddress?: string
  url?: string
  method?: string
  headers: http.IncomingHttpHeaders
  body: string
}

const servers: Array<http.Server | https.Server> = []
const agents: Agent[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(agents.splice(0).map(a => a.close().catch(() => {})))
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** An Agent pinned to loopback for `hostname`, exactly as runHop() builds one. */
function pinnedAgent(hostname: string, extraConnect: Record<string, unknown> = {}): Agent {
  const agent = new Agent({
    connect: {
      lookup: buildPinnedLookup({ address: '127.0.0.1', family: 4, hostname }),
      ...extraConnect,
    },
  })
  agents.push(agent)
  return agent
}

async function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, hitCount: number) => void
): Promise<{ port: number; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      seen.push({
        host: req.headers.host,
        remoteAddress: req.socket.remoteAddress,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      })
      handler(req, res, seen.length)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, seen }
}

/**
 * Self-signed cert for a given CN/SAN via the openssl binary. Returns null
 * when openssl is unavailable so the TLS tests skip rather than fail on a
 * host without it.
 */
function makeSelfSignedCert(commonName: string): { key: string; cert: string } | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'safe-fetch-tls-'))
    tempDirs.push(dir)
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-subj', `/CN=${commonName}`,
        '-addext', `subjectAltName=DNS:${commonName}`,
      ],
      { stdio: 'ignore' }
    )
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
  } catch {
    return null
  }
}

// ─── The pinned lookup over a real socket ─────────────────────────────────

describe('pinned lookup drives a real socket', () => {
  it('connects to the pinned address for a hostname that can never resolve', async () => {
    // `.invalid` can never resolve (RFC 2606). If any real DNS resolution
    // happened in the connect path this would fail with ENOTFOUND — success
    // proves the pinned address is what the socket used, AND that the
    // callback shape is one Node actually accepts. This is the test that
    // fails if buildPinnedLookup() regresses to the single-address form.
    const { port, seen } = await startHttpServer((_req, res) => res.end('PINNED_OK'))
    const host = 'pinned-host-xyz.invalid'

    const res = await undiciFetch(`http://${host}:${port}/probe`, { dispatcher: pinnedAgent(host) })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('PINNED_OK')
    expect(seen).toHaveLength(1)
    // Contract #6: the server sees the ORIGINAL hostname, not 127.0.0.1 …
    expect(seen[0].host).toBe(`${host}:${port}`)
    // … while the socket really did land on the pinned address.
    expect(seen[0].remoteAddress).toBe('127.0.0.1')
  })

  it('works on both the happy-eyeballs and single-address callback paths', async () => {
    // autoSelectFamily defaults to true (the all:true path). Forcing it off
    // exercises the single-address path. Both must connect; returning the
    // wrong shape for either is a hard ERR_INVALID_IP_ADDRESS.
    const { port } = await startHttpServer((_req, res) => res.end('BOTH_OK'))
    const host = 'pinned-host-xyz.invalid'

    for (const extra of [{}, { autoSelectFamily: false }]) {
      const res = await undiciFetch(`http://${host}:${port}/`, { dispatcher: pinnedAgent(host, extra) })
      expect(await res.text(), JSON.stringify(extra)).toBe('BOTH_OK')
    }
  })

  it('survives undici Agent option handling (its deepClone would destroy a function)', async () => {
    // undici's util.deepClone is JSON-based; the lookup only survives because
    // Agent destructures `connect` out before cloning. If a future undici
    // folds `connect` into the clone, pinning silently stops applying — this
    // asserts the mechanism directly so the cause is unambiguous.
    const { port, seen } = await startHttpServer((_req, res) => res.end('AGENT_OK'))
    const host = 'probe-deepclone-xyz.invalid'
    const inner = buildPinnedLookup({ address: '127.0.0.1', family: 4, hostname: host })
    let called = 0
    const spy: typeof inner = (hostname, options, callback) => {
      called += 1
      return inner(hostname, options, callback)
    }
    const agent = new Agent({ connect: { lookup: spy } })
    agents.push(agent)

    const res = await undiciFetch(`http://${host}:${port}/`, { dispatcher: agent })

    expect(await res.text()).toBe('AGENT_OK')
    expect(called).toBeGreaterThan(0) // the function survived and actually ran
    expect(seen[0].remoteAddress).toBe('127.0.0.1')
  })

  it('rejects a hostname the pin was not validated for (defence in depth)', async () => {
    const { port, seen } = await startHttpServer((_req, res) => res.end('SHOULD_NOT_REACH'))
    // Pin validated for host A, but the request asks for host B.
    const agent = pinnedAgent('validated-host-xyz.invalid')
    const err = await undiciFetch(`http://other-host-xyz.invalid:${port}/`, { dispatcher: agent }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(seen).toHaveLength(0)
  })
})

// ─── The premise behind the redirect-body fix ─────────────────────────────

describe('Agent.close() and unread 3xx bodies (premise for the redirect-body cancel)', () => {
  const BIG = 'x'.repeat(200_000) // > one socket buffer (~64 KiB)

  async function serve3xxWithBigBody() {
    const { port } = await startHttpServer((_req, res) => {
      res.writeHead(302, { location: '/next', 'content-type': 'text/plain' })
      res.end(BIG)
    })
    return port
  }

  it('hangs when a large redirect body is left unread — this is the bug', async () => {
    const port = await serve3xxWithBigBody()
    const host = 'redirect-host-xyz.invalid'
    const agent = new Agent({
      connect: { lookup: buildPinnedLookup({ address: '127.0.0.1', family: 4, hostname: host }) },
    })
    const res = await undiciFetch(`http://${host}:${port}/start`, { dispatcher: agent, redirect: 'manual' })
    expect(res.status).toBe(302)

    // Deliberately do NOT cancel res.body, then race close() against a timer.
    const outcome = await Promise.race([
      agent.close().then(() => 'closed' as const),
      new Promise<'timed-out'>(r => setTimeout(() => r('timed-out'), 1_000)),
    ])
    expect(outcome).toBe('timed-out')

    await agent.destroy() // don't leak the stuck socket
  })

  it('closes promptly once the redirect body is cancelled — this is the fix', async () => {
    const port = await serve3xxWithBigBody()
    const host = 'redirect-host-xyz.invalid'
    const agent = new Agent({
      connect: { lookup: buildPinnedLookup({ address: '127.0.0.1', family: 4, hostname: host }) },
    })
    const res = await undiciFetch(`http://${host}:${port}/start`, { dispatcher: agent, redirect: 'manual' })
    expect(res.status).toBe(302)

    // Exactly what runHop() now does before closing the Agent.
    await res.body?.cancel().catch(() => {})

    const outcome = await Promise.race([
      agent.close().then(() => 'closed' as const),
      new Promise<'timed-out'>(r => setTimeout(() => r('timed-out'), 1_000)),
    ])
    expect(outcome).toBe('closed')
  })
})

// ─── safeFetch's refusals, end to end over real sockets ───────────────────

describe('safeFetch refusals (real sockets, no mocks)', () => {
  it('refuses a loopback literal even though a listener is right there', async () => {
    const { port, seen } = await startHttpServer((_req, res) => res.end('SHOULD_NOT_REACH'))
    const err = await safeFetch(`http://127.0.0.1:${port}/`).catch(e => e)
    expect(err).toMatchObject({ name: 'BlockedAddressError' })
    expect(seen).toHaveLength(0)
  })

  it('refuses an IPv4-compatible IPv6 literal (::/96), which the range table calls unicast', async () => {
    const err = await safeFetch('http://[::7f00:1]/').catch(e => e)
    expect(err).toMatchObject({ name: 'BlockedAddressError' })
  })

  it('refuses an IPv4-mapped IPv6 literal in canonical hex form', async () => {
    const err = await safeFetch('http://[::ffff:7f00:1]/').catch(e => e)
    expect(err).toMatchObject({ name: 'BlockedAddressError' })
  })

  it('refuses the cloud-metadata address', async () => {
    const err = await safeFetch('http://169.254.169.254/latest/meta-data').catch(e => e)
    expect(err).toMatchObject({ name: 'BlockedAddressError' })
  })

  it('refuses a non-http(s) scheme', async () => {
    const err = await safeFetch('ftp://example.invalid/file').catch(e => e)
    expect(err).toMatchObject({ name: 'DisallowedSchemeError' })
  })
})

// ─── TLS: contract #6 ─────────────────────────────────────────────────────

describe('TLS SNI and certificate verification (contract #6)', () => {
  const tls = makeSelfSignedCert('tls-pinned-xyz.invalid')

  async function startTlsServer(): Promise<{
    port: number
    sni: Array<string | undefined>
    hosts: Array<string | undefined>
  }> {
    const sni: Array<string | undefined> = []
    const hosts: Array<string | undefined> = []
    const server = https.createServer({ key: tls!.key, cert: tls!.cert }, (req, res) => {
      sni.push((req.socket as net.Socket & { servername?: string }).servername)
      hosts.push(req.headers.host)
      res.end('TLS_OK')
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { port: (server.address() as AddressInfo).port, sni, hosts }
  }

  it.skipIf(!tls)('presents the original hostname as SNI and Host while connecting to the pinned IP', async () => {
    const { port, sni, hosts } = await startTlsServer()
    const host = 'tls-pinned-xyz.invalid'
    const res = await undiciFetch(`https://${host}:${port}/`, {
      dispatcher: pinnedAgent(host, { ca: [tls!.cert] }),
    })

    expect(await res.text()).toBe('TLS_OK')
    expect(sni).toEqual([host])
    expect(hosts).toEqual([`${host}:${port}`])
  })

  it.skipIf(!tls)('anchors certificate verification to the URL hostname, not the pinned IP', async () => {
    const { port } = await startTlsServer()
    // Same listener, same trusted CA, same pinned address — only the requested
    // hostname differs, and it is not in the cert's SAN. If verification were
    // done against 127.0.0.1, or skipped, this would succeed.
    const host = 'wrong-name-xyz.invalid'
    const err = await undiciFetch(`https://${host}:${port}/`, {
      dispatcher: pinnedAgent(host, { ca: [tls!.cert] }),
    }).catch(e => e)
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it.skipIf(!tls)('still rejects an untrusted certificate — pinning does not disable verification', async () => {
    const { port } = await startTlsServer()
    const host = 'tls-pinned-xyz.invalid'
    const err = await undiciFetch(`https://${host}:${port}/`, { dispatcher: pinnedAgent(host) }).catch(e => e)
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
  })
})
