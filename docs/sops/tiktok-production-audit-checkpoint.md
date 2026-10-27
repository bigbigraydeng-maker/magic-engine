# TikTok production application audit

> 负责 agent：苏东坡（`sudongpo`）｜ 档案：[`docs/agents/14-sudongpo.md`](../agents/14-sudongpo.md) ｜ 索引：[agents 索引](../agents/README.md)

Scope: complete client-authorized TikTok application launch, without new product features. Root Codex is the sole writer. A-level publishing/security correction; reuse existing consent, tenant access, task persistence and recovery. No new queue/workflow or schema: this changes one existing synchronous publishing adapter; existing order/snapshot provider receipts remain authoritative.

## Required correction
Official Content Sharing Guidelines require PULL_FROM_URL for server-held media. Restrict original source to the fixed Supabase public content-factory bucket and current client's rendered paths. Copy reviewed bytes into a non-overwriting SHA-addressed tiktok-publish/client/hash.mp4 object, recheck actual SHA, and initialize with that immutable URL. PULL init can already start delivery; persistence failure remains uncertain and cannot reinitialize. The provider ID is logged without secrets if receipt persistence fails.

## Verification
30 new/adapter-focused tests pass; 27 additional focused checks pass after URL-origin drift and receipt-loss retry regression; expanded171 tests across17 files pass, including recovery/claim/ledger regression. Scoped ESLint and diff-check pass. Three critical origin/client/hash mutation probes were killed. Impeccable before57 /after57 /new0: existing styling findings deferred per scope. Real Supabase Storage test used a1-second synthetic fixture: source/copy hashes match, public URL200 without redirect, repeated copy returns409 and cannot overwrite. No provider request or post. Receipt in task outputs: me-tiktok-app-20261014-review/pull-source-live-test.json.
Production TikTok prefix tiktok-publish/ verified via official signature file; Sandbox verification also passed. Full provider pull/upload demonstration not yet run.

## Review materials
Public privacy page gains a factual optional TikTok connection section, scopes/profile/credential handling, user-approved media transmission and revocation/deletion-request explanation. General Discovery stays public-source only. Homepage Terms link becomes directly visible. No automatic-retention promise or new collection scope. External clients are the intended operators per user's confirmed product purpose; actual client-scoped authorization is supported by the existing access guard.

## Next required gate
Independent review, commit/PR/technical CI, test deployment and actual Sandbox PULL demonstration, production deploy; finalize video and application form. Production app is still Draft and has not been submitted. Portal automatic video.upload is unused by OAuth and will be removed if the portal permits; no inbox-upload feature will be added.

## Bounded review evidence
Existing intent-before-init is enforced by orders route POST (save sending before publishToTikTok; any tiktok_publish blocks repeat) and lecture-publish.ts (claim sending before adapter; non-pending without receipt refuses init; sweep excludes uncertain sending). Added regression simulates all receipt writes failing after successful claim, then repeats POST and observes409 with one provider call. Token encryption is implemented in platform-oauth/connection-store.ts and cms/crypto.ts (AES-256-GCM), with tiktok/token.ts refreshing encrypted fields. Public Terms endpoint exists. Final public URL must equal the configured origin and exact publish path, otherwise fail closed.
