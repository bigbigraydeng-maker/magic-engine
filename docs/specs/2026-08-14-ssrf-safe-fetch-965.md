# SSRF-safe fetch prerequisite — threat model and design (#965)

Date: 2026-08-14  
Status: Draft prerequisite; no crawler/sitemap feature adoption in this change

## Scope

Build one reusable text-fetch primitive for attacker-controlled HTTP(S) URLs.
This PR adopts it only in prospecting to prove backward-compatible caller error
mapping. The crawler and CMS guards remain follow-up consumers; PR #963 is not
modified or copied.

## Threat model

The attacker controls the starting URL, DNS answers, redirect locations, and
response bytes. They may use unusual IPv4/IPv6 spellings, return a mixed DNS
answer set, change DNS between validation and connection, redirect to an
internal service, stall DNS/headers/body, or stream an unbounded body.

Protected assets include loopback and private services, link-local and cloud
metadata endpoints, carrier/internal networks, local sockets reachable by the
runtime, and application memory/worker availability.

Security invariants:

1. Only `http:` and `https:` URLs without embedded credentials are accepted.
2. IP classification is parsed and CIDR-based. Only `ipaddr.js` range
   `unicast` is allowed; malformed, reserved, private, loopback, link-local,
   multicast, documentation, benchmark and transition ranges fail closed.
3. IPv4-mapped IPv6 is normalized before classification. This includes compact
   hexadecimal forms such as `::ffff:7f00:1`; deprecated IPv4-compatible
   `::/96` forms are blocked as a CIDR.
4. Every DNS answer is validated. One blocked answer blocks the whole hop.
5. DNS is performed once per hop. The chosen validated address is supplied to
   the socket connector through a pinned `lookup`; the transport cannot perform
   an independent DNS lookup.
6. The Undici `Client` origin remains the original URL origin and caller-supplied
   `Host`/`:authority` overrides are stripped. Therefore HTTP Host, TLS SNI and
   certificate verification remain bound to the hostname, while only the
   socket address is pinned.
7. Redirects are manual and finite. Each target repeats URL parsing, DNS set
   validation and connection pinning with a new client.
8. DNS, connect, headers and body have per-hop timeouts; response bytes have a
   hard maximum. Clients are closed after every hop.

## Design choice

- `ipaddr.js@2.5.0`: small, maintained parser with explicit IPv4/IPv6 CIDR
  range tables and mapped-address normalization. This replaces hand-written
  string-prefix checks.
- `undici@6.28.0`: its `Client` + `buildConnector({ lookup })` gives a direct,
  testable connection-binding point. Version 6 keeps Node 18.17+ compatibility,
  matching Next 14's floor; the repository's transitive Undici 7 is not used as
  an undeclared production dependency.
- A client factory and resolver are dependency-injected for unit tests. Tests
  never open a real socket.

Rejected alternatives:

- Validate then call global `fetch`: vulnerable to DNS rebinding/TOCTOU because
  the fetch performs its own resolution.
- Connect to the IP URL: breaks hostname-based Host routing, TLS SNI and normal
  certificate verification.
- Continue expanding string-prefix rules: too easy to miss CIDRs, compressed
  IPv6 forms and mapped addresses.

## Caller error contract

`SafeFetchError` exposes stable internal codes. Prospecting maps them back to
its existing external strings: `blocked_private_address`,
`non_http_redirect`, `redirect_without_location_<status>`,
`too_many_redirects`, `timeout`, existing network codes, `http_<status>`, or
`fetch_failed`. Its `https_ok` tri-state semantics are unchanged.

## Verification boundary

Unit tests prove classification, all-answer fail-closed behavior, exact pin
delivery to the client factory, pinned lookup behavior, hostname-origin
preservation, one-resolution rebinding resistance, and per-redirect revalidation.
The tests mock DNS and transport; they do not claim a live-network or production
crawl. Three mutation probes separately remove classification, pin delivery,
and redirect-target use; each targeted test must fail.
