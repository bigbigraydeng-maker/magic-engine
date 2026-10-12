# Story 自动发布 · 刀二 a · DeepSeek 指令存档（风险级 A；零联网、零真发、建表 SQL 只写不执行）

- 契约文件 `src/lib/social/story-publish/types.ts` 由 Claude 会话手写（A 级核心契约）；其余文件由 DeepSeek 按下列指令分轮写出，Claude 逐轮审 diff、跑测试、做变异抽查。
- 权威设计稿：docs/specs/2026-10-12-story-auto-publish-design.md（§4、§5、§10）。

## 第 1 轮

```text
Create src/lib/social/story-publish/fingerprint.ts (exists empty) and the test draft src/lib/social/story-publish/fingerprint-draft.test.ts (exists empty). Read the attached types.ts (read-only contract).
fingerprint.ts exports:
- `export function canonicalFingerprintInput(item: StoryItemSpec, expiresAt: string): string` — returns JSON.stringify of an object with EXACTLY these keys in this fixed order: item_id, pack_id, client_id, channel, slot_at, media_kind, media_url, media_sha256, text_line, account_id, source_record_ids (a sorted copy; never mutate the input array), website_ref, website_checked_on, has_reply_cta, expires_at (= expiresAt). Build the object literal in that order; do not iterate Object.keys of the input.
- `export function computeItemFingerprint(item: StoryItemSpec, expiresAt: string): string` — sha256 hex (lowercase, 64 chars) of canonicalFingerprintInput via `import { createHash } from 'node:crypto'`.
Imports: `import type { StoryItemSpec } from './types'`.
Test (vitest, import './fingerprint' and type from './types'): a base fixture item with fake values (client_id '00000000-0000-0000-0000-000000000001', etc.). Assert: output is 64 lowercase hex; same item twice => same hash; object built with keys in a different order => same hash; changing EACH of the 15 StoryItemSpec fields (one at a time, produce a modified copy: strings get a suffix 'x', booleans flipped, media_kind/channel switched to the other allowed value, source_record_ids gets one more entry) => different hash for each (loop over a table of mutations and assert every hash is distinct from the base); source_record_ids order-insensitive (['a','b'] vs ['b','a'] same hash) but content-sensitive; different expiresAt => different hash; the input item is not mutated (deep equal to a clone after the call).
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env, English comments. Do not ask questions.
```

## 第 2 轮

```text
Create src/lib/social/story-publish/authorization.ts (exists empty) and test draft src/lib/social/story-publish/authorization-draft.test.ts (exists empty). Read the attached types.ts (contract).
authorization.ts exports:
```ts
export type StoryAuthState =
  | 'ACTIVE' | 'NONE' | 'WRONG_PACK' | 'WRONG_CLIENT' | 'NOT_ACTIVATED' | 'REVOKED' | 'EXPIRED'
  | 'AUTHORIZER_NOT_ADMIN' | 'NO_AUTHORIZED_FINGERPRINT' | 'FINGERPRINT_MISMATCH'
export function judgeStoryAuthorization(input: {
  authorization: StoryAuthorization | null
  item: StoryItemSpec
  /** fingerprint stored on the item row when the PM authorised it (null = none) */
  authorizedFingerprint: string | null
  /** fingerprint recomputed right now from the current item */
  currentFingerprint: string
  /** lowercase admin emails */
  adminEmails: ReadonlySet<string>
  now: Date
}): StoryAuthState
```
Check order (first hit wins, fail-closed): authorization null => 'NONE'; authorization.pack_id !== item.pack_id => 'WRONG_PACK'; authorization.client_id !== item.client_id => 'WRONG_CLIENT'; activated_at null or not a valid date => 'NOT_ACTIVATED'; revoked_at non-null => 'REVOKED'; expires_at not a valid date OR expires_at <= now => 'EXPIRED'; authorized_by_email lowercased+trimmed not in adminEmails => 'AUTHORIZER_NOT_ADMIN'; authorizedFingerprint null or empty => 'NO_AUTHORIZED_FINGERPRINT'; authorizedFingerprint !== currentFingerprint => 'FINGERPRINT_MISMATCH'; else 'ACTIVE'. Use Date.parse and Number.isNaN. Import types with `import type { StoryAuthorization, StoryItemSpec } from './types'`.
Test (vitest): base fixtures; one test per state producing it; plus: precedence tests (revoked AND expired => 'REVOKED'; not activated AND revoked => 'NOT_ACTIVATED'; wrong pack AND revoked => 'WRONG_PACK'); admin email compare is case-insensitive and trims; unparseable expires_at => 'EXPIRED'; expires_at exactly equal to now => 'EXPIRED'; one millisecond before expiry => 'ACTIVE'; only the fully valid case returns 'ACTIVE'.
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env, English comments. Do not ask questions.
```

## 第 3 轮

```text
Create src/lib/social/story-publish/gates.ts (exists empty) and test draft src/lib/social/story-publish/gates-draft.test.ts (exists empty). Read the attached types.ts and authorization.ts (contracts) and the attached daily-plan-auto-publish-decide.ts (read-only style template: readAutoPublishSwitches / isLiveFor).
gates.ts exports (pure; no process.env, no network, no DB):
1. `readStorySwitches(env: { STORY_AUTO_PUBLISH_LIVE?: string; STORY_AUTO_PUBLISH_CLIENTS?: string; STORY_AUTO_PUBLISH_CHANNELS?: string }): StorySwitches` — live is true ONLY for the exact string 'true'; clients = comma list, trimmed, lowercased, non-empty; channels = comma list, trimmed, lowercased, keeping only values that are members of STORY_CHANNELS (unknown values dropped).
2. `isStoryLiveFor(switches: StorySwitches, clientId: string, channel: StoryChannel): boolean` — live && clientIds includes lowercased clientId && channels includes channel.
3. Types and function:
```ts
export interface StoryGateInput {
  now: Date
  item: StoryItemSpec
  authState: StoryAuthState                    // already computed by judgeStoryAuthorization
  switches: StorySwitches
  clientStatus: string | null                   // must be 'active'
  campaignStatus: string | null                 // must be 'active'
  circuit: { itemPaused: boolean; packChannelPaused: boolean }
  fileCheck: 'OK' | 'CHANGED' | 'UNREACHABLE'
  priceGate: 'OK' | 'BLOCKED' | 'ERROR'
  replyOwnerPresent: boolean
  existingAttempt: { status: StoryAttemptStatus; updated_at: string } | null
  config: { maxLateMinutes: number; earlyMinutes: number; staleClaimMinutes: number; maxWebsiteAgeDays: number }
}
export type StoryGateDecision =
  | { action: 'PUBLISH' }
  | { action: 'DRY_RUN' }
  | { action: 'SKIP'; reason_code: 'ALREADY_TERMINAL' | 'IN_PROGRESS' | 'NOT_DUE' }
  | { action: 'RECORD'; status: StoryAttemptStatus; reason_code: string; retryable: boolean }
export function decideStoryPublish(input: StoryGateInput): StoryGateDecision
```
Decision order, FIRST HIT WINS (fail-closed; implement as a flat sequence of early returns, in a main function plus small helper functions so every function stays under 50 lines):
 a. existingAttempt non-null: if its status is in STORY_TERMINAL_STATUSES => SKIP ALREADY_TERMINAL. If status is 'CLAIMED' and Date.parse(updated_at) is more than staleClaimMinutes before now (or unparseable) => RECORD UNKNOWN_OUTCOME reason 'STALE_CLAIM' retryable false. If status is 'CLAIMED', 'CONTAINER_CREATED' or 'PUBLISHING' otherwise => SKIP IN_PROGRESS. (Other existing statuses such as DRY_RUN, BLOCKED, SKIPPED_NOT_AUTHORIZED do not stop re-evaluation.)
 b. now is earlier than slot_at minus earlyMinutes (or slot_at unparseable => treat as 'NOT_DUE' skip? NO: unparseable slot_at => RECORD BLOCKED 'BAD_SLOT' retryable false) => SKIP NOT_DUE.
 c. clientStatus !== 'active' => RECORD BLOCKED 'CLIENT_NOT_ACTIVE' retryable false; campaignStatus !== 'active' => RECORD BLOCKED 'CAMPAIGN_NOT_ACTIVE' retryable false.
 d. authState !== 'ACTIVE' => RECORD SKIPPED_NOT_AUTHORIZED reason_code = the authState string, retryable false.
 e. circuit.itemPaused or circuit.packChannelPaused => RECORD BLOCKED 'CIRCUIT_PAUSED' retryable false.
 f. now is more than maxLateMinutes after slot_at => RECORD MISSED_WINDOW 'SLOT_PASSED' retryable false.
 g. fileCheck 'CHANGED' => RECORD BLOCKED 'FILE_CHANGED' retryable false; 'UNREACHABLE' => RECORD BLOCKED 'FILE_UNREACHABLE' retryable true.
 h. priceGate 'BLOCKED' => RECORD BLOCKED 'PRICE_GATE_BLOCKED' retryable false; 'ERROR' => RECORD BLOCKED 'PRICE_GATE_ERROR' retryable true.
 i. item.has_reply_cta && !replyOwnerPresent => RECORD BLOCKED 'NO_REPLY_OWNER' retryable true.
 j. website_ref must start with 'https://' and website_checked_on must match /^\d{4}-\d{2}-\d{2}$/ and be within maxWebsiteAgeDays days before now's UTC date (not in the future by more than 1 day); otherwise RECORD BLOCKED 'WEBSITE_CHECK_STALE' retryable true.
 k. source_record_ids empty => RECORD BLOCKED 'SOURCE_MISSING' retryable false (place this check right after (d) and before (e)).
 l. otherwise: isStoryLiveFor(...) ? { action: 'PUBLISH' } : { action: 'DRY_RUN' }.
Imports: `import type { ... } from './types'`, `import { STORY_CHANNELS, STORY_TERMINAL_STATUSES } from './types'`, `import type { StoryAuthState } from './authorization'`.
Test (vitest): a baseline "everything fine" input that yields PUBLISH when switches are live for the client+channel and DRY_RUN otherwise; one test per rule above (each flipping exactly one input from the baseline); precedence tests: (1) authState 'REVOKED' AND fileCheck 'CHANGED' => SKIPPED_NOT_AUTHORIZED; (2) circuit paused AND price BLOCKED => CIRCUIT_PAUSED; (3) terminal existing attempt beats everything; (4) NOT_DUE beats not-authorized; (5) never returns PUBLISH unless ALL gates are green: loop over each failing input individually and assert action !== 'PUBLISH'; (6) readStorySwitches: 'TRUE','1',' true','yes',undefined all => live false; 'true' => live true; clients trimmed/lowercased; unknown channels dropped; (7) isStoryLiveFor false when channel not in list, client not in list, or live false; (8) instagram_story not enabled while facebook_story is => IG item gets DRY_RUN and FB item gets PUBLISH.
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env, English comments. Do not ask questions.
```

## 第 4 轮

```text
Create src/lib/social/story-publish/receipts.ts (exists empty) and test draft src/lib/social/story-publish/receipts-draft.test.ts (exists empty). Read the attached types.ts (contract, `StoryReceipt`, `StoryAttemptStatus`).
receipts.ts exports:
```ts
export function providerImpactFor(status: StoryAttemptStatus): 'NONE' | 'STORY_PUBLISHED'   // 'STORY_PUBLISHED' only for 'PUBLISHED_UNVERIFIED' and 'PUBLISHED'; everything else 'NONE'
export function buildStoryReceipt(input: {
  requestId: string
  item: Pick<StoryItemSpec, 'client_id' | 'pack_id' | 'item_id' | 'channel'>
  status: StoryAttemptStatus
  reasonCode: string | null
  providerReceipt: string | null
  authorizationId: string | null
  authorizationState: string
  contentHash: string
  mode: 'DRY_RUN' | 'LIVE'
  now: Date
}): StoryReceipt
```
Invariants (throw `new Error(...)` with a clear message when violated; the receipt must never lie):
- status 'PUBLISHED' or 'PUBLISHED_UNVERIFIED' requires providerReceipt to be a non-empty string after trim; otherwise throw (a provider receipt is never invented).
- any other status requires providerReceipt === null; otherwise throw (including CONTAINER_CREATED: a container id is not a publish receipt).
- status 'DRY_RUN' requires mode 'DRY_RUN'; a mode 'DRY_RUN' receipt may NOT have status PUBLISHED/PUBLISHED_UNVERIFIED (throw).
- contentHash must match /^[0-9a-f]{64}$/ and requestId / item ids must be non-empty; otherwise throw.
Result: all StoryReceipt fields; provider_impact = providerImpactFor(status); cost_usd = 0; created_at = now.toISOString(); reason_code = reasonCode; provider_receipt = trimmed providerReceipt or null.
Imports: `import type { StoryAttemptStatus, StoryItemSpec, StoryReceipt } from './types'`.
Test (vitest, import './receipts' and './types'): every status value in STORY_ATTEMPT_STATUSES builds a valid receipt with the right providerReceipt rule (loop); provider_impact STORY_PUBLISHED only for the two published statuses (assert for all 11 statuses); each invariant violation throws; created_at is ISO of now; cost_usd 0; trims the provider receipt.
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env, English comments. Do not ask questions.
```

## 第 5 轮

```text
Create src/lib/social/story-publish/pack-ingest.ts (exists empty) and test draft src/lib/social/story-publish/pack-ingest-draft.test.ts (exists empty). Read the attached types.ts (contract) and the attached storage.ts (read-only: how existing storage publishes files; we do NOT call it — all I/O goes through injected ports).
pack-ingest.ts exports:
```ts
export interface StoryAssetPorts {
  readFile(relativePath: string): Promise<Uint8Array>
  probe(bytes: Uint8Array, kind: StoryMediaKind): Promise<{ width: number; height: number; durationSec: number | null }>
  /** Content-addressed upload; MUST NOT overwrite an existing object. created=false when it already existed. */
  putIfAbsent(objectPath: string, bytes: Uint8Array, contentType: string): Promise<{ publicUrl: string; created: boolean }>
}
export interface StoryManifestEntry {
  item_id: string
  channel: StoryChannel
  /** Path relative to the pack folder, e.g. '2026-10-13_01_tale.png' */
  file: string
  slot_at: string
  media_kind: StoryMediaKind
  text_line: string
  source_record_ids: string[]
  website_ref: string
  website_checked_on: string
  has_reply_cta: boolean
}
export interface StoryIngestRejection { item_id: string; channel: StoryChannel; reason_code: string }
export async function ingestStoryAssets(input: {
  clientId: string
  /** lowercase slug used in the storage path, e.g. 'acme-tours' (must match /^[a-z0-9][a-z0-9-]{1,40}$/) */
  clientSlug: string
  packId: string
  /** account id per channel (Facebook Page id / Instagram user id) */
  accountIds: Record<StoryChannel, string>
  entries: StoryManifestEntry[]
  ports: StoryAssetPorts
  maxVideoSeconds?: number // default 15
}): Promise<{ items: StoryItemSpec[]; rejected: StoryIngestRejection[] }>
```
Rules per entry (a failing entry is pushed to `rejected` with a stable reason_code and processing continues with the next entry; never throw for a single bad entry; a bad clientSlug throws):
1. file must be a relative path: reject 'BAD_PATH' if empty, starts with '/', contains '..' segment, contains '\\', or contains a NUL char.
2. extension (lowercase) must be .png .jpg .jpeg for kind 'image' or .mp4 for kind 'video'; otherwise reject 'BAD_EXTENSION'.
3. readFile failure => 'READ_FAILED'. Empty bytes => 'EMPTY_FILE'.
4. probe failure => 'PROBE_FAILED'. Aspect must be exactly 9:16 (width * 16 === height * 9) and width >= 540, else 'BAD_ASPECT'. For video durationSec must be non-null and <= maxVideoSeconds (default 15) else 'BAD_DURATION'.
5. sha256 lowercase hex of bytes via node:crypto. objectPath = `story-assets/${clientSlug}/${packId}/${sha256}.${ext}` where ext is png/jpg/mp4 (jpeg normalised to jpg). contentType image/png, image/jpeg or video/mp4.
6. putIfAbsent failure => 'UPLOAD_FAILED'; publicUrl must start with 'https://' else 'URL_NOT_HTTPS'.
7. accountIds[channel] must be a non-empty string else reject 'NO_ACCOUNT'.
8. Also reject 'DUPLICATE_ITEM' when the same (item_id, channel) appears twice (keep the first).
On success push a StoryItemSpec { item_id, pack_id: packId, client_id: clientId, channel, slot_at, media_kind, media_url: publicUrl, media_sha256: sha256, text_line, account_id: accountIds[channel], source_record_ids, website_ref, website_checked_on, has_reply_cta }. Never log or return file bytes. Keep each function under 50 lines (split into small helpers: validatePath, extensionFor, buildObjectPath, ...).
Test (vitest, fake ports, no real I/O): happy path (png and mp4) producing correct media_sha256 (compute expected with createHash in the test), objectPath, and fields; each rejection reason above; a bad entry does not stop the next good entry; duplicate handling; clientSlug invalid throws; putIfAbsent receives the content-addressed path and the same bytes; created=false (already uploaded) still succeeds; jpeg => '.jpg' path; path traversal attempts ('../x.png', 'a/../../x.png', '/etc/x.png') never reach readFile (assert readFile not called).
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env, no real network or filesystem. English comments. Do not ask questions.
```
