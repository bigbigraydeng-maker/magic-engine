# ME Web Intelligence v0.1 — implementation and rollout receipt

Remote fetched at 2026-09-08T15:36:18Z; exact main SHA `1ded986725f1ccd02352bcb346a6e32bc92bf4c7`.
Contract: [#1497](https://github.com/bigbigraydeng-maker/magic-engine/issues/1497), PM GO BUILD comment 5587778033. Risk A. This document supersedes the pre-build audit. Status: PR #1500 merged; production migration and CTS-only pilot explicitly approved and enabled on 2026-09-09 NZ time. Compatibility fixes #1506/#1507 merged and live (bb19965f1a7ad5f132478d5c2080e13a08589d51).

## Scope and reuse

Existing competitor resolver + `clients.competitor_domains` + the client's Industry Baseline cohort remain the identity sources. `competitor_monitoring_metadata` only annotates existing identities; it cannot create a second competitor list. Legacy resolver callers keep their behavior; this flow opts into fail-closed reads. Tiers core/secondary/benchmark/watch combine with active/emerging/archive status and additive source history/tags.

Shared runtime: Apify website adapter, snapshots/evidence/signals, bounded interpretation, client-scoped budget ledger and Inngest workflows. Existing Industry Baselines gets a Web intelligence tab. Industry meaning comes from the existing baseline cohort and configured context; client IDs, URLs, entitlement, FX and schedules are configuration. No CTS name, ID, private facts or travel rules enter shared runtime. Reuses existing Apify, Anthropic, paid-client/admin authorization and Inngest infrastructure. No alternate provider, custom worker or action execution is added.

Website pipeline: reserve → durably claim paid capture → Apify run receipt → validate dataset → immutable snapshot/full evidence → content diff → bounded LLM interpretation with owned evidence citations → threat/opportunity/ignore + recommended action → actual cost settlement. First snapshot is baseline; unchanged snapshots skip LLM. Outputs are recommendations only. Six service-only tables and five restricted RPCs are additive; the migration contains no client/baseline seeds; authorized activation writes are recorded below.

## Controls and limitations

All clients are disabled by default. Environment allowlist, enabled flag and entitlement must all pass. $499/month is a reserved entitlement field, not Stripe billing; billing currency is explicitly selected. Target NZ$30/month pauses non-core work; NZ$50/month rejects new reservations under a per-client database lock. Auckland month boundaries, fresh explicit USD/NZD rate, unknown costs and prior-month unsettled work are checked. Unknown paid requests retain their reservation and block further spending; paid calls are not retried blindly. Actual overages are recorded without truncation and block subsequent runs. Provider budget caps plus worst-case LLM reservation bound dispatched work; this cannot retroactively undo an upstream provider billing anomaly.

Apify version is pinned by configuration. One approved same-domain HTTPS URL per run, one dataset item, bounded content/page/time/charge. Removed/archived competitors cannot run. Evidence text is untrusted data; model has no tools and strict classification/citation schema. A completed paid claim with missing receipt needs operator reconciliation, not replay. If infrastructure retries are exhausted before a status receipt can be persisted, Inngest failure history plus the held run must be inspected; no automatic refund/restart is provided in v0.1.

## Validation evidence

- 247 related Vitest tests across 16 files passed (runtime, adapter, routes, UI and existing integration boundaries).
- 18 isolated real PostgreSQL 17 checks passed using `scripts/test-web-intelligence-db.mjs`: additive migration, separate-connection concurrency, budget stop, replay, unknown-cost and cross-month holds, revocation, snapshot transitions, evidence integrity, non-finite money, cross-client FKs and RLS/RPC denial. Local test DB only.
- Four targeted mutants were killed: rollout allowlist, citation ownership, paid-call claim and SQL hard stop. Source restored after each mutant.
- Focused lint and production build passed. Build used dummy database settings, not production access.
- Full typecheck reports seven errors also reproduced on pristine exact main: four messenger send test `usedAiDraft` omissions and three ops-review test environment typing errors. No new type errors.
- Two independent implementation reviews and an additional security review completed; blocking findings resolved, focused regression tests passed.
- Desktop/mobile UI was rendered from the actual component with explicitly synthetic data; no mobile horizontal overflow or browser errors. These images are not CTS acceptance.

## CTS evidence and remaining gate

CTS uses its existing competitor identities plus its Industry Baseline cohort; no duplicate identity list was seeded. After the PM explicitly approved production database updates and pilot activation, `web_intelligence_v01` was applied. All six tables have RLS enabled and RPC permissions remain restricted. The production allowlist contains CTS only. Existing provider/model/Inngest configuration is reused without exporting credentials. Inngest synchronization returned Successfully registered.

CTS settings: enabled/entitled; reserved membership 499 NZD/month (no billing subscription created), target NZ$30/hard stop NZ$50, USD/NZD 1.706 dated 2026-09-08, collector build 0.3.97, capture cap US$0.10 and NZ$0.02 overhead/run. Only existing `wendywutours.co.nz` is configured for collection: core/active/manual, cts-pilot tag, homepage, 24h interval. Daily due-work evaluation runs at 06:00 Pacific/Auckland. Other clients remain excluded by the production allowlist.

Production baseline requested through Industry Baselines → Web Intelligence:
- request `e7b5e805-e56f-45b5-9814-7ca9708f1f00`, Apify `X60junDpOkJqCAOig`, provider SUCCEEDED and ledger complete.
- snapshot `efb3fd1d-5cab-4b01-9acd-fcdec05ef3f6`, captured 2026-09-08T17:20:00.217352Z, 19,393 characters, SHA256 `66fadcf98e7fbd949dfa822bbfc00a42b8d95d924c2d9e91061e02f7170bc872`.
- provider US$0.0009246625809520484, model US$0, accounted NZ$0.0215774743631041945704 including overhead. Initial baseline correctly skips interpretation.

Two activation-only compatibility fixes were needed: client GUID validation (#1506), and enabling the official Actor's required proxy (#1507). The latter input was validated against official build 0.3.97 (old input HTTP400, corrected input HTTP200). Rejected attempt `9bb6f20f-5992-4c4b-a04f-839cf2bb93a1` created no provider run (verified Actor run listing), so it was marked failed and settled at US$0 provider/model plus NZ$0.02 overhead. No unknown charge was blindly retried.

Second capture `828b0c7a-6f08-42c7-9f30-90c6ab0800ee` / Apify `3TbpMV1i1xp7qa630` also succeeded and produced a real content-change signal. Its model result failed validation/persistence, with the old generic error code; raw response was not retained, so the precise cause is not known. Provider US$0.0060086445602112355 plus model US$0.01974 settled at NZ$0.06392718761972037. A free count of the exact prompt returned 4,660 input tokens; this is inconsistent with a 1,000-output-token truncation given the recorded charge. A valid real LLM classification/recommendation receipt is still required. Never fabricate a change for that claim. The previously accepted claim-time target recheck and normalized-content-limit settlement follow-ups are now implemented and regression-tested. One UI draft-refresh follow-up remains deferred. Keep this pilot single-URL and serial; inspect unresolved runs before adding targets. Disable the client setting to stop new paid work; reconcile already claimed work before releasing held costs.

## Planning estimate (not measured CTS costs)

Illustrative 579 single-page captures/month, 10–50% changed, 2,500 input + 500 output tokens per changed page, USD/NZD 1.70 as an assumption. Published browser crawler estimate US$0.50–5 / 1,000 pages implies US$0.29–2.90 capture usage; Sonnet US$3/15 per million input/output tokens implies US$0.87–4.35 interpretation; configured overhead NZ$0.02/capture adds NZ$11.58. Combined illustrative NZ$13.55–23.91/month. Separate-run overhead, account plans, polling/dataset requests, storage and actual token volume can raise this; real CTS receipts must calibrate the NZ$30 target. Current default reservation at this illustrative FX is NZ$0.615/run, released only against known actual costs.

Sources checked: [Apify crawler](https://apify.com/apify/website-content-crawler), [Apify pricing](https://apify.com/pricing), [Actor run caps](https://docs.apify.com/api/v2/actors-runs-post), [model pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## Next extensions

Hiring: job opening/closing and role mix. People: published leadership changes. Partnership/CSR: official announcements with named parties/date. Reviews: platform IDs, score/count and new-review evidence. Technology: observed stack or tracking changes. Each extends signal kind/extraction over the same snapshots, evidence, budget and recommendation boundary; evaluate Apify first and introduce another provider only with a documented capability gap. None is implemented in v0.1.


## Readability follow-up (2026-09-09, pending release)

Base: origin/main `5f44651f55d99e9958f318b7f96806e2ff0f6f3f`. Existing capability presentation only, risk C. User feedback prioritizes frequently read results over adding new collection directions.

Default view shows conclusions and recommendations; competitor controls and settings are separate views. Ignore items, raw evidence and run diagnostics are collapsed. Failed/pending interpretations remain visible. Sources and capture times remain readable. Future v3 interpretations request concise Simplified Chinese; historical summaries remain unchanged. Failed initial reads have a retry control, and forms reset only after fresh data arrives.

Reuse statement: existing Industry Baselines panel, endpoints, shared competitor identities, permission checks, budget ledger and Inngest flow are reused. No customer-specific logic, new paid calls, schema changes, providers or action execution. Hiring/review/advertising adapters exist elsewhere but are not connected to market signals by this patch; no extra coverage is claimed.

Validation: five UI regressions and 91 related runtime/provider tests pass; focused lint and production build pass. Browser smoke used explicitly synthetic data in the actual component and confirmed result-first layout and collapsed competitor controls. Independent review found no P0/P1; initial-error retry issue fixed. This is local verification, not production acceptance of the new UI.

## Business-surface upgrade (2026-09-09, implementation pending release)

Remote fetched at 2026-09-09T05:24Z; exact main SHA `ee019c25654b691b380ce152d0dc671a036d6a45`. Risk A. Priority under Engineering Quality Gates §11: frequency high / IMPACT high / revenue high → P0.

The Website loop now retains the complete whitespace-normalised Apify text as the immutable snapshot and separately produces a deterministic, versioned business-content projection for comparison and model evidence. Image markup, tracking endpoints, asset-only URLs and adjacent duplicate lines no longer create market signals. Prices, currency, dates, availability, product names, their surrounding order and offer wording remain. A projection or pinned Actor version change starts a new baseline rather than reporting an extractor upgrade as competitor activity. Same-host redirects to a different page, HTTP-200 not-found pages, challenge pages and weak projections fail before evidence is accepted. Known paid capture costs are settled when post-capture target or projection checks reject the result.

The shared L1 runtime defines page roles, versioned projection and business-change evidence. ME Travel L2 supplies Tour/List/Offer URL semantics only when `industry:travel` is present in configuration. CTS-selected URLs, frequency and tags remain L4 configuration; no CTS ID, domain or private fact is in shared code. Apify remains the L3 collector, one approved page per budgeted Inngest task. The current maximum of three URLs per competitor remains unchanged. No action execution is added.

CTS acceptance scope is deliberately three business surfaces rather than a whole-site crawl: the China Tours listing, New Tours listing and one flagship Tour detail page. Public-page inspection confirms these surfaces expose catalogue count, product names, current prices, offers, departure information and availability. Production configuration and paid baseline captures require the release/migration gate; until then this paragraph is a reviewed activation plan, not a production receipt.

Local evidence: 89 focused projection/runtime/provider tests plus the Industry Baselines UI regressions; isolated PostgreSQL 17 verification covers framework-noise suppression, genuine business transitions, projection-version baselines, existing budget controls, client isolation and RLS/RPC denial. Final counts and production receipts will replace this implementation note after release.
