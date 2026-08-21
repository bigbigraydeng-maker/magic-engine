# ME 2.0 WordPress Page Apply v2 — local authorization freeze

Date: 2026-08-21
Status: local development and test authorization only

## Authorized scope

Build and test a governed SEO page-query-ownership candidate and an existing-page
WordPress apply capability. This freeze does not authorize a production write,
deployment, commit, push, pull request, or human approval of a live action run.

## Governed identity

- Candidate identity: `seo / apply_wordpress_page_metadata`
- Action key: `page.apply_wordpress_optimization_request`
- Action version: `1`
- Purpose: `growth`

This identity is separate from `geo / optimize_page_answerability` and from the
GitHub Draft-PR action `page.apply_optimization_request`.

This is a provider-generic WordPress capability. CTS is explicitly not an
eligible target: CTS is a Next.js site delivered through its GitHub repository,
so CTS evidence must enter a separately governed GitHub/code-repository action.

## Input and authorization boundary

The action accepts only a validation-passed Page Optimization request whose
client, page-ledger row, WordPress connection, exact post/page, and snapshot
version are bound before Kernel submission. The evidence receipt shown for
approval must be the same value pinned into both Kernel evidence and action input.

Every run requires human approval. Approval is pinned to the complete canonical
input hash. The authorization context is also part of the action's idempotency
identity, so a changed evidence/lineage basis cannot silently reuse an older run.
No caller flag can substitute for Kernel authorization.
The specialized submission gate HMAC-signs the complete authorization context
with a dedicated `REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY`. The capability verifies
that proof after the pending run is rehydrated, so a caller cannot submit a
self-consistent but fabricated context directly to Kernel. This key must be at
least 32 bytes and must not be reused as the CMS credential-encryption key.

## Provider contract

- Existing published WordPress `post` or `page` only.
- Yoast write readiness must already be verified.
- v2 permits `meta_title` and `meta_description` only.
- `content_html` is rejected until complete-content rollback is proven safe.
- Before `apply`, the capability re-reads the exact target and rejects URL,
  identity, version-token, field-value, do-not-touch, or diff-hash drift.
- Provider idempotency is unsupported; max attempts is one.
- Every apply and rollback write must use the Magic Engine WordPress plugin's
  compare-and-set endpoint. The endpoint atomically checks `expected_modified`
  and applies the approved partial update in one provider-side critical section.
- Core WordPress REST has no equivalent compare-and-set guarantee. If the plugin
  capability probe fails, execution fails closed; there is no native REST fallback.
- POST writes are never retried after an ambiguous network or 5xx response.
- The local plugin reference implementation lives under
  `integrations/wordpress/magic-engine-page-apply/`. It requires InnoDB for both
  posts and postmeta, locks the exact post row, and exposes only the two governed
  Yoast meta keys. This task does not authorize installing that plugin.

## Verification and rollback

After apply, the capability re-reads the exact post and verifies identity, URL,
approved meta values, and the provider's returned modified token. The rollback
handler uses the same plugin compare-and-set endpoint to restore the pinned before snapshot.
It restores only when the live page is either already at the before state or
exactly at the approved after state and its modified token still equals the apply
receipt; third-party drift and same-value third-party saves are never overwritten.
If an apply response is lost before its output is persisted, rollback first performs
a read-only check: a proven before state is a no-op; every other state is recorded as
`apply_outcome_unknown` and requires human review. It never guesses and writes.

The registry label `provider_native` means the Kernel may dispatch this capability
rollback through the provider-side Magic Engine WordPress plugin path. It does
not mean core WordPress supplies an idempotency key.

## Explicitly out of scope

- No automatic approval.
- No live Customer Zero queue insertion in this local task.
- No WordPress write, preview, publish, deployment, or production database write.
- No changes to the existing GitHub Draft-PR action.
