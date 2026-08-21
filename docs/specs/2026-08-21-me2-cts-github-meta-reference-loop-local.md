# ME 2.0 CTS GitHub intent reference loop — local governed action

Date: 2026-08-21
Status: local development and tests only

## Correct delivery channel

CTS is a Next.js site delivered from its connected GitHub repository. It does
not use WordPress. A CTS page-query finding must never map to the WordPress Page
Apply action.

The CTS repository stores rendered page metadata in TypeScript data entries.
The existing `page.apply_optimization_request` capability only patches complete
static HTML documents. It is therefore not compatible with CTS and must not be
used as a substitute merely because both providers are GitHub.

## Customer Zero decision

The authorized CTS NZ GSC evidence for 2026-07-23 through 2026-08-20 showed
the exact query `china tours` against 11 URLs. The homepage received 2 clicks
and 195 impressions at average position 14.88; `/china-tours` received 0 clicks
and 32 impressions at position 57.09; `/china-tours-from-new-zealand` received
0 clicks and 42 impressions at position 47.83. These rows demonstrate URL
dispersion; they do not by themselves prove which URL Google should select.

Repository inspection then established that `/china-tours` is an intentional
generic tour hub (42 internal source links and legacy redirects target it),
while `/china-tours-from-new-zealand` is an intentional NZ landing page. The
governed hypothesis is therefore to differentiate their intent, not redirect,
canonicalize or delete the hub. The smallest eligible patch changes only the
generic hub's title, description and H1. URL, canonical, redirects, body copy,
links, tour inventory and the NZ page remain out of scope.

## Governed action

The dedicated action is `page.apply_cts_github_metadata_request` v2. Candidate
identity `seo / clarify_page_query_url_ownership` maps only to this action and
only through the `cts_github_reference_loop` submission boundary. The generic
page caller cannot submit it.

The submission gate is disabled by default. It returns `rollout_disabled`
unless `CTS_GITHUB_METADATA_ACTION_ENABLED=true` is explicitly configured in a
formally authorized environment. This local implementation does not authorize
setting that flag in production.

The action changes exactly one CTS TypeScript data entry. Its authorized fields
are `meta_title`, `meta_description` and `h1`; `content_html` remains permanently
do-not-touch. It creates one isolated branch and one Draft PR. It never merges
or deploys.

## Trusted pipeline

The only complete admission path is
`triggerCtsGithubMetadataReferenceLoop`. It receives an already resolved,
read-only GSC access token plus an explicit page/query selector and proposed
title/description/H1. It does not resolve credentials, call a model, generate copy
or perform GitHub writes. The legacy CTS submission module has no runtime
exports; proof signing and Kernel submission are private functions inside this
trigger, so a caller cannot bypass the authoritative loaders.

1. Before provider reads, the trigger checks the rollout switch and loads CTS
   redlines from tenant-filtered `clients.brand_redline_phrases` plus the active
   `master_briefs.avoid_words`. Missing/error/malformed redlines fail closed.
2. A live GSC page×query read produces an immutable, in-process receipt for the
   exact property/date/country/page/query/metrics row. The trigger fixes the
   property to `sc-domain:ctstours.co.nz` and country to NZ (`nzl`); neither is
   caller-selectable. A foreign or invalid evidence page is rejected before the
   GSC request. Zero exact rows return NOT READY; more than one exact row is
   treated as ambiguous and also returns NOT READY.
3. The Growth Finding statement and Evidence locator are derived from that
   receipt's exact query, page and metrics; the caller cannot substitute a
   different narrative while retaining the trusted receipt. Canonical URL
   identity (scheme, `www`, trailing slash, query and fragment independent)
   prevents the evidence page from being the proposed target itself. Severity
   is deterministic: zero clicks with at least 100 impressions is `high`;
   otherwise it is `medium`.
4. The CTS source loader starts from the CTS tenant-scoped page ledger and
   connected GitHub record, reads the live repository, and binds exact page URL
   → slug → unique `src/lib/data/(seo-pages|blogs)*.ts` entry → blob SHA.
5. The preparation gate validates Growth Finding/Prescription/Verification,
   exact receipt lineage, redlines, the three-field intent diff and a pure source patch.
6. The dedicated submission gate signs and pins the receipt, tenant/source
   binding, full Growth lineage, exact requested action and diff hash into the
   Kernel input and evidence.
7. Kernel policy must return `require_approval`. The trusted source read has
   already occurred, but after the run becomes pending and before human
   approval the capability is not called and GitHub writes are zero.
8. After approval, every capability step re-checks the rollout kill switch.
   Capability preparation re-reads the base blob and rechecks
   its SHA, unique target entry and diff hash. It then creates a deterministic
   owned branch, commits the exact patch and opens a Draft PR carrying the
   Kernel run and authorization decision markers.
9. The commit step persists GitHub's exact commit SHA and content SHA. Final
   verification requires the live branch tip and head blob to match those
   receipts, the PR to change exactly one approved file, the base to remain
   unchanged, and the head file bytes to equal the approved patch. The PR must
   remain open, unmerged and Draft.

The adapter can inspect and patch only the target entry's `title`, its
`description` or `excerpt`, and `h1`. Missing fields, invalid slugs and neighbouring-entry
ambiguity fail closed. Comments, strings and template literals cannot masquerade
as source entries. The adapter itself performs no network, database, model,
environment, clock or Git operation.

## Provider and rollback boundaries

The outward provider is declared non-idempotent and the Kernel attempt ceiling
is one. The capability never retries a write. Rollback requires the persisted
provider commit SHA and, when present, the exact persisted PR number. It only
touches a branch whose live tip still equals that commit receipt and only closes
an unmerged Draft PR whose head/base/body markers match the run and authorization
decision. PR lifecycle is checked before treating a missing branch as harmless,
so a merged/ready PR with an auto-deleted branch still fails closed. A missing
commit/PR receipt, foreign change, ready-for-review PR or merged PR requires
human inspection.

## Local proof and remaining live gate

The live GSC fetch, receipt creation, source load, preparation and submission
must run in one process; the receipt/source/preparation trust brands are not
serializable. Only the signed authorization context crosses into the pending
Kernel run.

Local integration tests may use a real-shaped CTS NZ GSC row and an in-memory
Kernel/fake GitHub adapter. They prove mapping, input pinning, pending approval,
zero post-pending/pre-approval capability writes and Draft-PR-only execution.
They do not count as a live CTS receipt, a real queue entry or a real PR.

## Explicitly not authorized

- no live CTS GitHub read or write in this local authorization;
- no production Kernel queue insertion;
- no production human approval, commit, push, PR, merge, deployment or
  production DB write;
- no WordPress operation for CTS;
- no redirect, canonical, URL, link, body or NZ landing-page change;
- no reuse of the legacy `runCtsMetaPr` outward runner as a Kernel capability.
