# Unified media intake (local implementation)

## Status 2026-11-04 (moved into the main repo)

Until 2026-11-04 these files existed only as uncommitted files in a local checkout (`magic-engine-media-storage`, branch `codex/media-library-storage`). They are now copied here unchanged, except that the tests import `test` from `vitest` instead of `node:test` (so `npm test` collects them) and the ffprobe-based test skips where `ffprobe` is absent. Run: `npx vitest run scripts/media-library`.

Owner: 马良 (`docs/agents/60-maliang.md`, 素材库 section). Facts checked on 2026-11-04:
- `99_Catalog/asset-records` holds 500 records (Magic Lab Class 165, logistics 91, nz-finance-professional 122, nz-ktv-entertainment 122). All are `rights_status: pending`, `location_status: pending` and `eligible_for_automatic_selection: false`, so none of them can be selected yet. CTS and industry travel have 0 records there.
- No code on `main` reads `asset-records` or the `me-media-*` buckets. The factory worker reads its own local mirror (`scripts/factory-worker/tools/sync-studio-mirror.mjs`), and the ME dashboard reads the `client_assets` table.
- No automatic intake is running. The plist `~/Library/LaunchAgents/com.magiclab.media-intake-local.plist` still exists (it points at the old checkout and only at `00_Inbox/industry-travel`), but launchd has not loaded it: `launchctl print gui/$(id -u)/com.magiclab.media-intake-local` reports "Could not find service". Its last output log entry is from 2026-10-15. Its error log stops on 2026-10-22, and the lines before that were repeated `Intake scan failed`. Registration currently happens only when someone runs `manage.mjs import` by hand.
- `scan` / `watch` / `watch-local` rewrite the Dropbox-wide index `99_Catalog/inventory.json` (a backup is kept as `inventory.json.before-intake-sync.json`), so do not run them casually.
- The ffprobe-based test in `automation.test.mjs` is skipped where `ffprobe` is not installed, and vitest still reports the run as passed.
- `00_Inbox/enterprise-cts` contains mostly finished CTS videos (Panorama v7, Shanghai & Beyond v3) and two staff photos, not raw footage. Watching that folder therefore stays off until a folder-to-scope mapping exists: `discover()` labels bare files `unclassified`, and `mergeCatalog()` throws on an ownership conflict with existing `enterprise` index entries.
- Before the review/selection step is built, align the source vocabulary (`own`/`stock`/`i2v`) with `src/lib/assets/provenance.ts`, which already defines the one used by `client_assets`. Do not add a third vocabulary.

## History (October 2026, from the original checkout)

The paragraphs below are the original log. Test counts and verification statements in them describe October runs, not the 2026-11-04 copy.

Source requests and Dropbox files share a local receipt registry. Stock downloading uses `acquire.mjs`; existing acquired assets use their collection sidecars. Bare files are discovered, technically tagged and quarantined as references until provenance/permission metadata exists. Facebook public posts without explicit reuse evidence are reference-only and are not downloaded or sent for vision analysis. Authorised Facebook originals can be placed in Dropbox with an authorization sidecar; Facebook scraping is not implemented.

The 30-second scanner ignores recently written files, rejects symlink escapes, measures actual streams, hashes bytes, and records `tagging_pending` before dispatching one opaque job-ID event. Inngest executes sampled-frame OpenAI tagging with concurrency1 and two retries. Job status and provider observations are persisted locally. Source location and model location suggestions remain separate; neither copyright nor geographic approval is inferred. Final selection stays false.

OpenAI credentials are loaded by reference from the existing ME env file; no keys are copied into Dropbox. The model default follows existing ME usage (`gpt-4o-mini`), not a claim of the newest model. Provider calls cap at10 attempts per UTC day per configured state directory. Quota/auth failure creates a provider-blocked receipt; no automatic repeat spending. Stale claims after process crash require inspection.

Commands, from this checkout:

```sh
node scripts/media-library/acquire.mjs <batch-dir> <source-request.json>
node scripts/media-library/automation-cli.mjs scan <inbox> <local-state> <existing-env>
node scripts/media-library/automation-cli.mjs serve <inbox> <local-state> <existing-env>
node scripts/media-library/automation-cli.mjs watch <inbox> <local-state> <existing-env>
```

For local Inngest use `INNGEST_DEV=1`; run the official Dev Server against `http://127.0.0.1:8391/api/inngest`. `MEDIA_INTAKE_DRY_RUN=1` disables provider calls and writes only `dry_run_complete`; those results are never usable content labels.

Source request fields: `scope`, `company` where applicable, `source` (stock/own/i2v), `source_url`, `download_url` (verified public original), `author_or_rightsholder`, `license_evidence`, `source_group`, `provenance`; for Facebook additionally `authorized_for_reuse:true` and `authorization_evidence`. Public-original host allowlist prevents arbitrary URL fetching; redirects are refused. Local source adapters do not automatically search for material or approve a source licence.

Verified 2026-10-14: 18 local tests passed. Direct OpenAI and the existing Cloudflare gateway both returned 429/credit_balance_exhausted; no recognised labels were produced. The earlier local Inngest smoke processed four real files in dry-run mode with zero model calls. Its temporary receiver and Dev Server are stopped.

The user LaunchAgent `com.magiclab.media-intake-local` now runs `watch-local` every 30 seconds against `00_Inbox/industry-travel`. It registers technical/source status and synchronizes the existing `99_Catalog/inventory.json`; it dispatches no Inngest events and makes no model calls. A newly created neutral 64px test image was independently observed in the main index as reference_only, eligibility false. It is a verification fixture, not usable CTS footage. Existing 26 receipts synced without duplicates; the fixture adds one reference record. The original index backup is retained. Legacy CSV export is unchanged.

This listener runs only while this Mac is awake and the Dropbox folder is available. Other inbox roots are not yet watched. Provider quota restoration and a successful real vision trial are prerequisites for activating AI execution. Cloud Inngest registration, automatic source-search/acquisition scheduling and private-runtime upload remain outstanding. No campaign is scheduled or published.

Local acquisition/discovery/JSON catalogue now support WEBM originals from the same trusted hosts. A real CC BY4.0 Commons train clip was downloaded, probed and decoded successfully and classified as video in the main index. Visual review found landscape active picture with blurred portrait padding; quality hold recorded in its source sidecar. Private-runtime supported formats remain unchanged. Listener restarted and verified running; 18 existing tests passed.

Local intake also accepts OGV video originals; real Wuxi Yanqiao Metro CC BY-SA4.0 original downloaded and fully decoded (1920x1080,33.483175s), correctly indexed as video. Runtime upload formats unchanged. Listener restarted; existing18 tests pass. Original Xinshi2020 photo detected by source URL and skipped; distinct Taiping Bridge2015 photo acquired and visually tagged.
