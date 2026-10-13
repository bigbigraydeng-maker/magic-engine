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

## 修订轮（子牙 + 魏征第一轮审查后）

### r6b

```text
Edit ONLY the test file src/lib/social/story-publish/fingerprint-draft.test.ts (attached for editing; fingerprint.ts and types.ts are read-only and already contain computeManifestHash). KEEP every existing export and every existing test unchanged. The implementation already exists (read-only). Its contract:
`export function computeManifestHash(items: StoryItemSpec[], expiresAt: string): string` — builds the array of [storyItemKey(item), computeItemFingerprint(item, expiresAt)] pairs for every item, sorts the pairs by key (plain string comparison, ascending), and returns the lowercase sha256 hex of JSON.stringify(sortedPairs). Throws `new Error('computeManifestHash: duplicate item key')` when two items share the same key. An empty list is allowed and gives a stable hash. Import `storyItemKey` (a value) from './types' next to the existing type import.
Add tests to fingerprint.test.ts: manifest hash is 64 hex; independent of input order; changes when any single item changes; changes when an item is added or removed; changes with a different expiresAt; throws on duplicate key (same item_id and channel); the same item_id on two different channels are two distinct keys (no throw); the input array is not mutated (order preserved after the call).
RULES: edit only the test file. No `any`, no `as unknown as`, no process.env. Do not ask questions.
```

### r7b

```text
Rewrite ONLY the test file src/lib/social/story-publish/authorization-draft.test.ts (attached for editing; authorization.ts, types.ts and fingerprint.ts are read-only; authorization.ts already implements the new contract below). The judge now recompute fingerprints itself from raw material instead of trusting values passed by the caller.
New contract:
```ts
export type StoryAuthState =
  | 'ACTIVE' | 'NONE' | 'WRONG_PACK' | 'WRONG_CLIENT' | 'NOT_ACTIVATED' | 'REVOKED' | 'EXPIRED'
  | 'AUTHORIZER_NOT_ADMIN' | 'AUTHORIZATION_ID_MISMATCH' | 'NO_AUTHORIZED_FINGERPRINT'
  | 'FINGERPRINT_MISMATCH' | 'MANIFEST_MISMATCH'
export function judgeStoryAuthorization(input: {
  authorization: StoryAuthorization | null
  item: StoryItemSpec
  /** the authorization id stored on the item row (null = item never authorised) */
  itemAuthorizationId: string | null
  /** every item of the pack as it is stored right now (all channels), used to recompute the manifest hash */
  packItems: StoryItemSpec[]
  adminEmails: ReadonlySet<string>
  now: Date
}): StoryAuthState
```
Check order, first hit wins: null => NONE; pack_id mismatch => WRONG_PACK; client_id mismatch => WRONG_CLIENT; activated_at missing/unparseable => NOT_ACTIVATED; revoked_at non-null => REVOKED; expires_at unparseable or <= now => EXPIRED; authorizer email (trim, lowercase) not in adminEmails => AUTHORIZER_NOT_ADMIN; itemAuthorizationId !== authorization.id => AUTHORIZATION_ID_MISMATCH; approved = authorization.approved_item_fingerprints[storyItemKey(item)] missing/empty => NO_AUTHORIZED_FINGERPRINT; computeItemFingerprint(item, authorization.expires_at) !== approved => FINGERPRINT_MISMATCH; computeManifestHash(packItems, authorization.expires_at) !== authorization.manifest_hash (wrap in try/catch: a throw such as duplicate key => MANIFEST_MISMATCH) => MANIFEST_MISMATCH; else ACTIVE. The item itself must be among packItems (same key) else MANIFEST_MISMATCH. Use Object.prototype.hasOwnProperty.call for the snapshot lookup (no prototype keys like '__proto__' may match).
Imports: types from './types' (StoryAuthorization, StoryItemSpec, storyItemKey value) and { computeItemFingerprint, computeManifestHash } from './fingerprint'.
Tests: build a real valid fixture inside the test with computeItemFingerprint/computeManifestHash (helper `makeAuthorizedFixture()` returning {authorization, item, packItems, adminEmails, now}); keep the old per-state cases (adapted), and ADD: AUTHORIZATION_ID_MISMATCH; NO_AUTHORIZED_FINGERPRINT (key missing from snapshot, and empty-string value); FINGERPRINT_MISMATCH when any item field changes after authorisation (loop several fields); FINGERPRINT_MISMATCH when only the authorization expires_at changed (renewal without re-authorising: recomputed fingerprint differs from snapshot); MANIFEST_MISMATCH when a sibling item in packItems is changed, added or removed while the item itself is unchanged; MANIFEST_MISMATCH when the item is not in packItems; the old precedence tests; '__proto__' as an item_id never matches a snapshot key; ACTIVE only for the fully valid fixture.
RULES: edit only the test file. No `any`, no `as unknown as`, no process.env. Do not ask questions.
```

### r8

```text
Rewrite src/lib/social/story-publish/gates.ts (attached for editing; the previous version is a good base — keep readStorySwitches, isStoryLiveFor, the helper style, and the rule-group structure). types.ts, authorization.ts, fingerprint.ts are read-only contracts.
CHANGES (all required):
1. StoryGateInput: REMOVE `authState`. ADD `auth: { authorization: StoryAuthorization | null; itemAuthorizationId: string | null; packItems: StoryItemSpec[]; adminEmails: ReadonlySet<string> }` and compute the state INSIDE the gate with `judgeStoryAuthorization({ ...input.auth, item: input.item, now: input.now })` (so a stale cached state can never be passed in). ADD `registeredAccountId: string | null`. CHANGE `existingAttempt` to `{ status: string; updated_at: string; next_retry_at: string | null; retry_count: number } | null` (status is a plain string so an unknown status fails closed). ADD to `config`: `stalePublishingMinutes: number` and `maxRetries: number`.
2. StoryGateDecision SKIP reason_code union gains 'WAITING_RETRY'.
3. NEW first step `checkConfig(input)`: every config number (maxLateMinutes, earlyMinutes, staleClaimMinutes, stalePublishingMinutes, maxWebsiteAgeDays) must satisfy Number.isFinite and >= 0; maxRetries must be a non-negative integer; input.now must be a valid Date (Number.isNaN(now.getTime()) false). Otherwise RECORD BLOCKED 'BAD_CONFIG' retryable false.
4. checkExistingAttempt: (i) status not a member of STORY_ATTEMPT_STATUSES => RECORD BLOCKED 'UNKNOWN_EXISTING_STATUS' false. (ii) terminal status => SKIP ALREADY_TERMINAL. (iii) 'CLAIMED' with updated_at unparseable or older than staleClaimMinutes => RECORD UNKNOWN_OUTCOME 'STALE_CLAIM' false. (iv) 'PUBLISHING' with updated_at unparseable or older than stalePublishingMinutes => RECORD UNKNOWN_OUTCOME 'STALE_PUBLISHING' false. (v) otherwise 'CLAIMED' | 'CONTAINER_CREATED' | 'PUBLISHING' => SKIP IN_PROGRESS. (vi) 'RETRYABLE': retry_count >= maxRetries => RECORD BLOCKED 'FILE_UNREACHABLE' false; next_retry_at null/unparseable or later than now => SKIP WAITING_RETRY; else fall through to normal evaluation. (vii) 'DRY_RUN', 'BLOCKED', 'SKIPPED_NOT_AUTHORIZED' fall through.
5. checkFile: fileCheck 'UNREACHABLE' => RECORD with status 'RETRYABLE' reason 'FILE_UNREACHABLE' retryable true; ANY other value that is not exactly 'OK' (including 'CHANGED' and unexpected runtime values) => RECORD BLOCKED 'FILE_CHANGED' retryable false.
6. checkPrice: 'ERROR' => RECORD BLOCKED 'PRICE_GATE_ERROR' retryable true; ANY other value that is not exactly 'OK' => RECORD BLOCKED 'PRICE_GATE_BLOCKED' retryable false.
7. New rule after checkSource and before checkCircuit: `checkAccount`: registeredAccountId null/empty or !== item.account_id => RECORD BLOCKED 'ACCOUNT_MISMATCH' false.
8. New rule right before checkReplyOwner: `checkReplyCtaDeclared`: if !item.has_reply_cta and /\b(reply|replies|dm us|message us|inbox|comment below)\b/i matches item.text_line => RECORD BLOCKED 'REPLY_CTA_UNDECLARED' false.
9. checkWebsite: validate website_checked_on strictly: it must match /^\d{4}-\d{2}-\d{2}$/ AND round-trip (parse year/month/day, build new Date(Date.UTC(y, m-1, d)), its toISOString().slice(0,10) must equal the original string, so '2026-13-01' and '2026-02-31' are rejected); any failure, NaN age, age > maxWebsiteAgeDays or age < -1 => RECORD BLOCKED 'WEBSITE_CHECK_STALE' true. https check on website_ref stays.
10. Rule order (first hit wins): checkConfig, checkExistingAttempt, checkDue, checkContext, checkAuthorization, checkSource, checkAccount, checkCircuit, checkLateness, checkFile, checkPrice, checkReplyCtaDeclared, checkReplyOwner, checkWebsite, then switches (PUBLISH / DRY_RUN).
Keep file under 450 lines, every function under 50 lines, no `any`, no process.env. Import `judgeStoryAuthorization` from './authorization'; keep exporting what other code may use. Do not ask questions. Only edit gates.ts.
```

### r9

```text
Create src/lib/social/story-publish/gates-draft.test.ts (exists empty): the main test file for the REWRITTEN gates.ts (attached read-only, together with types.ts, authorization.ts, fingerprint.ts and fixture-note.md). Use the attached old-gates.test.ts as the template for structure and keep EVERY test idea from it that is still valid, adapted to the new input shape (no `authState`; use auth fixtures as described in fixture-note.md). Must cover: baseline PUBLISH / DRY_RUN; readStorySwitches and isStoryLiveFor cases; every rule of the old suite (not-due, missed window, client/campaign status, circuit, price OK/BLOCKED/ERROR, reply owner, website age, https website_ref, source missing, existing attempt terminal/in-progress/stale CLAIMED, bad slot); the precedence tests (authorization beats file/price; circuit beats price; terminal existing beats everything; NOT_DUE beats not-authorized; a loop proving no single failing input yields PUBLISH); IG-not-enabled-but-FB-enabled test; the two 'source check ordering' tests. Keep the file under 600 lines. Authorization failure cases to include here: revoked, expired, not activated, admin removed from the admin set => decision RECORD SKIPPED_NOT_AUTHORIZED with the state as reason_code.
RULES: only edit gates-draft.test.ts. No `any`, no `as unknown as`, no process.env. Do not ask questions.
```

### r10

```text
Create src/lib/social/story-publish/gates-hardening-draft.test.ts (exists empty): tests ONLY for the NEW behaviour of the rewritten gates.ts (attached read-only with types.ts, authorization.ts, fingerprint.ts, fixture-note.md). Cover every item below with at least one test; boundary tests must test both sides of the boundary:
1. BAD_CONFIG: NaN, Infinity, -1 for each of maxLateMinutes, earlyMinutes, staleClaimMinutes, stalePublishingMinutes, maxWebsiteAgeDays; maxRetries 1.5 and -1; invalid Date `now` => RECORD BLOCKED 'BAD_CONFIG' and never PUBLISH. Also: with NaN earlyMinutes and a slot a day in the future the result must still not be PUBLISH.
2. website_checked_on '2026-13-01', '2026-02-31', '2026-10-1', '', 'abc' => BLOCKED WEBSITE_CHECK_STALE; boundary: exactly maxWebsiteAgeDays old passes, one day older blocks; one day in the future passes, two days in the future blocks.
3. Fail-closed on unexpected runtime values: fileCheck 'weird' (cast through a small helper that returns the value typed as the union, e.g. `function asFile(v: string): StoryGateInput['fileCheck'] { return v as StoryGateInput['fileCheck'] }`), priceGate 'weird' => BLOCKED FILE_CHANGED / PRICE_GATE_BLOCKED; fileCheck 'UNREACHABLE' => RECORD status 'RETRYABLE' reason FILE_UNREACHABLE retryable true; priceGate 'ERROR' => PRICE_GATE_ERROR retryable true.
4. Unknown existing status 'SOMETHING_NEW' => BLOCKED UNKNOWN_EXISTING_STATUS (never PUBLISH); every status in STORY_ATTEMPT_STATUSES gives a defined decision (loop) and none of the terminal ones can give PUBLISH.
5. PUBLISHING: fresh (updated 5 min ago) => SKIP IN_PROGRESS; updated exactly stalePublishingMinutes ago => still SKIP (boundary) ; 1 ms older => UNKNOWN_OUTCOME STALE_PUBLISHING; unparseable updated_at => UNKNOWN_OUTCOME. CLAIMED boundary the same with staleClaimMinutes. CONTAINER_CREATED any age => SKIP IN_PROGRESS.
6. RETRYABLE: retry_count 3 with maxRetries 3 => BLOCKED FILE_UNREACHABLE retryable false; next_retry_at in the future or null or garbage => SKIP WAITING_RETRY; next_retry_at equal to now => falls through to normal evaluation (PUBLISH when all green); retry_count 2 allowed.
7. ACCOUNT_MISMATCH: registeredAccountId null, '' and a different id => BLOCKED ACCOUNT_MISMATCH; ordering: an unauthorised item with a mismatching account reports SKIPPED_NOT_AUTHORIZED first.
8. REPLY_CTA_UNDECLARED: text_line 'Reply for details' with has_reply_cta false => BLOCKED; with has_reply_cta true and replyOwnerPresent true => PUBLISH; 'Replying' alone does not match? (the regex uses word boundaries: 'reply' matches 'Reply for details' and 'replies', but 'Replying' should NOT match — assert that); 'DM us' matches.
9. Authorization freshness: the gate computes the auth state itself: changing the item text after authorisation (item in auth.packItems and item differ) => SKIPPED_NOT_AUTHORIZED reason 'FINGERPRINT_MISMATCH'; authorization expires_at changed (renewal) => FINGERPRINT_MISMATCH; sibling changed => MANIFEST_MISMATCH; itemAuthorizationId null => AUTHORIZATION_ID_MISMATCH.
10. DRY_RUN existing attempt falls through: existing DRY_RUN + live switches => PUBLISH; existing BLOCKED / SKIPPED_NOT_AUTHORIZED rows fall through as well.
RULES: only edit gates-hardening-draft.test.ts. No `any`; the only allowed cast is the tiny typed helper described in item 3. No process.env. Keep under 650 lines. Do not ask questions.
```

### r11

```text
Rewrite src/lib/social/story-publish/pack-ingest.ts (attached for editing; the previous version is a good base — keep its structure, helpers and reason-code style). types.ts is a read-only contract. Required changes:
PORTS (update the interfaces and their doc comments):
- `readFile(relativePath)`: document that a real implementation MUST resolve the real path (realpath) and refuse anything that is a symlink or resolves outside the pack folder, and MUST enforce a byte cap itself.
- `probe(bytes, kind)` now returns `{ width: number; height: number; durationSec: number | null; format: 'png' | 'jpeg' | 'mp4' | 'unknown' }`.
- `putIfAbsent(objectPath, bytes, contentType)` now returns `{ publicUrl: string; created: boolean; existingSha256: string | null }` (existingSha256 = lowercase hex sha256 of the object ALREADY stored at that path when created is false, else null).
INPUT: add `publicBaseUrl: string` (must start with 'https://'; normalise by ensuring a single trailing '/'; a bad value throws `new Error('ingestStoryAssets: invalid publicBaseUrl')`). Add optional `maxImageBytes` (default 10 * 1024 * 1024) and `maxVideoBytes` (default 100 * 1024 * 1024). `clientId` and `packId` must match the UUID regex /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i else throw. `maxVideoSeconds` must be a finite number > 0 else throw. A bad clientSlug still throws.
PER-ENTRY RULES (cheap checks first, I/O last; a failing entry is pushed to `rejected` with a stable reason_code and processing continues):
 1. 'BAD_ITEM_ID': item_id must match the UUID regex. 'DUPLICATE_ITEM' for repeated (item_id, channel).
 2. 'NO_ACCOUNT': accountIds[channel] must match /^\d{5,25}$/.
 3. 'BAD_FIELDS': slot_at parseable by Date.parse; text_line non-empty after trim and <= 200 chars; source_record_ids non-empty array of non-empty trimmed strings; website_ref starts with 'https://'; website_checked_on a REAL calendar date (matches /^\d{4}-\d{2}-\d{2}$/ and round-trips through Date.UTC + toISOString().slice(0,10)).
 4. 'BAD_PATH': file empty; starts with '/'; contains '\\', NUL, '%', ':' or a Windows drive prefix; any path segment is '', '.' or '..' (so './x.png', 'a//b.png', 'a/./b.png', '../x.png' are all rejected).
 5. 'BAD_EXTENSION' (case-insensitive ext): .png/.jpg/.jpeg for image, .mp4 for video.
 6. 'READ_FAILED', 'EMPTY_FILE', then 'FILE_TOO_LARGE' when bytes.length exceeds the cap for the kind (checked BEFORE probe).
 7. 'PROBE_FAILED'; 'FORMAT_MISMATCH' when probe.format is not the format implied by the extension (png->'png', jpg/jpeg->'jpeg', mp4->'mp4'; 'unknown' never matches); 'BAD_ASPECT' unless width*16 === height*9 and width >= 540; for video 'BAD_DURATION' unless durationSec is a finite number > 0 and <= maxVideoSeconds.
 8. sha256 (node:crypto). objectPath = `story-assets/${clientSlug}/${packId}/${sha256}.${ext}` (jpeg normalised to jpg). putIfAbsent failure => 'UPLOAD_FAILED'. publicUrl must equal `${publicBaseUrl}${objectPath}` exactly else 'URL_NOT_EXPECTED'. When created is false: existingSha256 null => 'CANNOT_VERIFY_EXISTING'; existingSha256 !== sha256 => 'OBJECT_CONTENT_MISMATCH'.
On success push the StoryItemSpec as before (media_url = publicUrl). Never log or return file bytes. Every function under 50 lines (split into helpers: validateFields, validatePath, extensionFor, checkMedia, uploadAsset, ...). File under 500 lines. No `any`, no process.env, no real I/O. Do not ask questions. Only edit pack-ingest.ts.
```

### r12

```text
Create src/lib/social/story-publish/pack-ingest-draft.test.ts (exists empty): full test file for the REWRITTEN pack-ingest.ts (attached read-only with types.ts). Use the attached old-ingest.test.ts as the structural template and keep every still-valid test idea, adapted to the new contracts (ports: probe returns format; putIfAbsent returns existingSha256; new input publicBaseUrl; UUID ids; digit-only account ids). Define a `makePorts()` helper with vi.fn-based fakes and a `validEntry()` helper. publicBaseUrl in tests: 'https://cdn.example.com/public/'. Tests (each asserts reason codes via `rejected` and that later good entries still succeed where relevant):
- happy path png and mp4 (sha256 computed in the test with createHash; objectPath `story-assets/<slug>/<packId>/<sha>.png`; media_url equals publicBaseUrl + objectPath; item fields copied; jpeg => '.jpg').
- BAD_ITEM_ID (non-UUID, id containing ':'), DUPLICATE_ITEM, NO_ACCOUNT ('', 'abc', '1234', digits of length 26), BAD_FIELDS (bad slot_at, empty text_line, 201-char text_line, empty source_record_ids, a blank source id, http website_ref, website_checked_on '2026-13-01' and '2026-02-31').
- BAD_PATH for each of: '', '/etc/x.png', '../x.png', 'a/../../x.png', 'a\\b.png', './x.png', 'a//b.png', 'a/./b.png', 'x%2e%2e.png', 'C:x.png', 'a:b.png', 'x\0.png'; assert readFile never called for them.
- BAD_EXTENSION ('x.gif', 'x.png' for kind video, 'x.mp4' for kind image, uppercase '.PNG' accepted).
- READ_FAILED, EMPTY_FILE, FILE_TOO_LARGE (image 10 MiB + 1 byte rejected, exactly 10 MiB accepted; video custom maxVideoBytes), probe not called for too-large files.
- PROBE_FAILED, FORMAT_MISMATCH (png bytes probed as 'jpeg'; 'unknown'), BAD_ASPECT (1080x1920 ok; 1080x1921, 540x960 ok, 270x480 rejected for width < 540), BAD_DURATION (null, 0, -1, NaN, 16 for default max 15; 15 accepted; custom maxVideoSeconds 30).
- UPLOAD_FAILED, URL_NOT_EXPECTED (publicUrl from another host, and same host different path), created=false with matching existingSha256 succeeds, created=false with existingSha256 null => CANNOT_VERIFY_EXISTING, created=false with a different hash => OBJECT_CONTENT_MISMATCH; putIfAbsent receives the content-addressed path, the same bytes and the right contentType.
- throws: bad clientSlug, non-UUID clientId, non-UUID packId, publicBaseUrl 'http://x/', maxVideoSeconds 0 / NaN / Infinity is allowed? (Infinity is NOT finite => throws).
- one bad entry never stops the next good one; ingest never returns or logs bytes (items have no bytes property).
Keep the file under 750 lines. RULES: only edit that file. No `any`, no `as unknown as`, no process.env, no real I/O. Do not ask questions.
```

### 测试夹具说明

```text
FIXTURE PATTERN to use in BOTH new gate test files (copy exactly, then adapt names):
- NOW = new Date('2026-10-12T09:00:00.000Z'); EXPIRES = '2026-10-19T09:00:00.000Z'.
- baseItem(overrides) as in the old test (slot_at = NOW iso, account_id '55566677788' (digits), website_checked_on '2026-10-12', source_record_ids ['rec-1'], has_reply_cta false, text_line 'Hello', client_id 'client-1', pack_id 'pack-1', item_id 'item-1', channel 'facebook_story').
- makeAuth(items: StoryItemSpec[]): builds a real StoryAuthorization: { id: 'auth-1', pack_id: 'pack-1', client_id: 'client-1', authorized_by_email: 'pm@example.com', authorized_by_user_id: 'user-1', authorized_at: '2026-10-11T09:00:00.000Z', activated_at: '2026-10-11T09:01:00.000Z', expires_at: EXPIRES, revoked_at: null, manifest_hash: computeManifestHash(items, EXPIRES), approved_item_fingerprints: Object.fromEntries(items.map(i => [storyItemKey(i), computeItemFingerprint(i, EXPIRES)])) }.
- baseInput(overrides): item = baseItem(), auth = { authorization: makeAuth([item]), itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }, registeredAccountId '55566677788', switches LIVE {live true, clientIds ['client-1'], channels ['facebook_story']}, clientStatus 'active', campaignStatus 'active', circuit {false,false}, fileCheck 'OK', priceGate 'OK', replyOwnerPresent true, existingAttempt null, config { maxLateMinutes: 30, earlyMinutes: 30, staleClaimMinutes: 15, stalePublishingMinutes: 10, maxWebsiteAgeDays: 7, maxRetries: 3 }.
- To flip an authorization failure, change auth (e.g. revoked_at set, activated_at null, adminEmails empty set) — never pass a precomputed state.
Imports in the draft test files (they live next to the sources before being moved): './gates', './types', './authorization', './fingerprint'.
```

## 第二刀 b（授权服务）DeepSeek 指令存档

### r1

```text
Create src/lib/social/story-publish/in-memory-store.ts (exists empty) and the test draft src/lib/social/story-publish/in-memory-store-draft.test.ts (exists empty). Read the attached store.ts (the StoryStore port) and types.ts (read-only).
in-memory-store.ts exports `class InMemoryStoryStore implements StoryStore` — a faithful in-memory model used by tests and the dry-run rehearsal. It must behave like the SQL tables (docs: the real database enforces the same rules):
- Constructor takes no arguments; internal Maps/arrays only. Seed helpers (public methods): `seedItems(items: StoredStoryItem[])`, `seedAccounts(clientId: string, accounts: RegisteredStoryAccounts)`, `seedReplyDuty(clientId: string, dutyDate: string)`, `seedAssetUsage(mediaSha256: string, usage: 'UNUSED' | 'USED')`, `seedAttempts(attempts: StoryAttemptView[], packId: string)`; plus read helpers `allAuthorizations(): StoryAuthorization[]` and `allItems(): StoredStoryItem[]` returning copies.
- getPackItems(packId, clientId): items with that pack_id AND client_id, sorted by slot_at ascending then item_id then channel; return deep copies (mutating the result must not change the store).
- getLiveAuthorization(packId, clientId): the grant with that pack_id/client_id and revoked_at === null (at most one); copy or null.
- insertAuthorization(row): when a live grant already exists for that pack_id => { ok: false, error: 'ALREADY_AUTHORIZED' }; otherwise assigns a new id with `randomUUID` from 'node:crypto', stores it with activated_at null and revoked_at null, returns { ok: true, authorization } (copy). The stored row keeps request_id (extra field kept internally in a parallel Map<string,string> request id by auth id; StoryAuthorization has no request_id field).
- activateAuthorization(authId, clientId): null when unknown, wrong client or revoked; else stamps activated_at = new Date().toISOString() once (idempotent: keeps the first stamp) and returns a copy.
- revokeAuthorization({authId, packId, clientId, byEmail, reason, now}): only matches an unrevoked grant with that id, pack and client; stamps revoked_at = now.toISOString(); returns a copy or null. Record byEmail/reason in a parallel Map for inspection via `revocationOf(authId)`.
- linkItemsToAuthorization({authId, items}): for each listed (item_id, channel) that exists sets authorization_id = authId; throws Error('unknown item') when one does not exist (and changes nothing in that case: validate all first).
- recordOpen(record): idempotent on (item_id, channel, opened_by_user_id, opened_fingerprint); throws Error('unknown item') when the item does not exist.
- listOpens(packId): opens of items of that pack, copies.
- listAttempts(packId): copies of seeded attempts for the pack.
- getRegisteredAccounts(clientId): seeded accounts copy or null. hasReplyOwner(clientId, dutyDate): true iff seeded. getAssetUsage(sha): seeded value, otherwise 'UNKNOWN'.
Import types: `import type { ... } from './store'` and `from './types'`. No `any`, no process.env, no timers. File under 400 lines, functions under 50 lines.
Test file (vitest; import './in-memory-store', './store', './types'): cover every rule above, including copy semantics (mutating a returned item/authorization does not change the store), ALREADY_AUTHORIZED, a second insert after revoke succeeds, activate idempotence, activate after revoke returns null, revoke wrong pack/client returns null and second revoke returns null, link validates all items before changing any, recordOpen idempotence and unknown item, sort order, client isolation (same pack id but different client returns nothing), asset usage default UNKNOWN. Build an item fixture helper with all StoryItemSpec fields (incl. contains_price and names_place).
RULES: only edit those two files. Do not ask questions.
```

### r2

```text
Create src/lib/social/story-publish/evaluate.ts (exists empty) and test draft src/lib/social/story-publish/evaluate-draft.test.ts (exists empty). Read-only context attached: types.ts, store.ts, service-ports.ts, gates.ts, authorization.ts, fingerprint.ts, in-memory-store.ts (use InMemoryStoryStore in tests).
evaluate.ts exports ONE function:
```ts
export interface EvaluatedStoryItem {
  item: StoredStoryItem
  /** Gate dry-run outcome simulated AT the item's slot time with the would-be grant. */
  decision: StoryGateDecision
  problems: string[]            // [] when decision.action === 'DRY_RUN'; else [reason_code]
  requiresOpen: boolean
  openedByActor: boolean
  alreadyAttempted: StoryAttemptStatus | null
}
export interface EvaluatedStoryPack {
  items: EvaluatedStoryItem[]
  grant: StoryAuthorization            // the provisional grant (id 'provisional', activated_at = now ISO, revoked_at null)
  manifestHash: string
  approvedFingerprints: Record<string, string>
  expiresAt: string                    // ISO
}
export async function evaluateStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  now: Date
  expiresInDays: number              // integer 1..14, caller validates
}): Promise<EvaluatedStoryPack>
```
Behaviour:
1. items = await ports.store.getPackItems(packId, clientId) (may be empty => return empty items with a grant built from []).
2. expiresAt = new Date(now.getTime() + expiresInDays*86_400_000).toISOString(). approvedFingerprints = for each item `[storyItemKey(item), computeItemFingerprint(item, expiresAt)]`; manifestHash = computeManifestHash(items, expiresAt) — if computeManifestHash throws (duplicate key) let it propagate.
3. grant = { id:'provisional', pack_id: packId, client_id: clientId, authorized_by_email: actor.email.trim().toLowerCase(), authorized_by_user_id: actor.id, authorized_at: now.toISOString(), activated_at: now.toISOString(), expires_at: expiresAt, revoked_at: null, manifest_hash, approved_item_fingerprints }.
4. accounts = await store.getRegisteredAccounts(clientId); opens = await store.listOpens(packId); attempts = await store.listAttempts(packId).
5. For each item (in stored order) compute the gate dry-run: call `decideStoryPublish` with: now = new Date(item.slot_at) (an unreadable slot => use `now` so the gate itself reports BAD_SLOT); item; auth = { authorization: grant, itemAuthorizationId: 'provisional', packItems: items (the stored items, they extend StoryItemSpec), adminEmails: ports.adminEmails }; switches = { live:false, clientIds:[], channels:[] } (so a fully green item returns DRY_RUN); clientStatus = accounts?.client_status ?? null; campaignStatus = 'active' (stories are not tied to a campaign yet; keep a short comment saying so); circuit = { itemPaused: item.paused_at !== null, packChannelPaused: false }; fileCheck = await ports.checkFile(item); assetUsage = await store.getAssetUsage(item.media_sha256); priceGate = item.contains_price ? await ports.checkPrice(item) : 'OK'; replyOwnerPresent = nzDateOf(item.slot_at) === null ? false : await store.hasReplyOwner(clientId, nzDateOf(item.slot_at) as string) — write it without a cast (use a local const and a null check); registeredAccountId = channel facebook_story ? accounts?.facebook_page_id ?? null : accounts?.instagram_user_id ?? null; existingAttempt = null; config = ports.config.
   Each port call may throw: let a throwing checkFile / checkPrice be caught per item and mapped to 'UNREACHABLE' / 'ERROR' (fail closed); a throwing store call propagates.
6. problems = decision.action === 'DRY_RUN' ? [] : [decision.action === 'RECORD' ? decision.reason_code : decision.reason_code] (SKIP and RECORD both carry reason_code; a PUBLISH decision cannot happen with live:false but if it did treat it as problem ['UNEXPECTED_PUBLISH']).
7. requiresOpen = itemRequiresOpen(item). openedByActor = opens.some(o => o.item_id===item.item_id && o.channel===item.channel && o.opened_by_user_id===actor.id && o.opened_fingerprint === computeContentFingerprint(item)). alreadyAttempted = status of the attempt for that (item_id, channel) or null; when alreadyAttempted is non-null ALSO add the problem 'ALREADY_ATTEMPTED' to problems.
Keep functions under 50 lines (split into helpers such as gateDryRun, buildGrant). No `any`, no process.env. Only edit evaluate.ts.
Test file (vitest, draft path): seed an InMemoryStoryStore with a green item (account ids digits, website_checked_on within 7 days of slot, reply cta false) plus accounts {facebook_page_id matching item.account_id, instagram_user_id, client_status 'active'}, asset usage 'UNUSED'; ports: adminEmails new Set(['pm@example.com']), checkFile async 'OK', checkPrice async 'OK', sendEvent vi.fn, newId, config { maxLateMinutes: 30, earlyMinutes: 30, staleClaimMinutes: 15, stalePublishingMinutes: 10, maxWebsiteAgeDays: 7, maxRetries: 3 }. Tests: green item => problems [] and decision DRY_RUN; each of these makes exactly that item's problems non-empty with the right reason code: checkFile 'CHANGED' (FILE_CHANGED), 'UNREACHABLE' (RETRYABLE record with FILE_UNREACHABLE), checkFile throwing (FILE_UNREACHABLE), price item with checkPrice 'BLOCKED' / 'ERROR' / throwing, asset usage 'USED' / unknown on facebook but fine on instagram, account mismatch, client status 'paused', slot after expiry (EXPIRED reported as SKIPPED_NOT_AUTHORIZED reason 'EXPIRED'), website check older than 7 days before the slot, reply cta true with no duty row (NO_REPLY_OWNER) and with a duty row for the NZ date of the slot (fine), paused item, existing attempt (ALREADY_ATTEMPTED plus alreadyAttempted set), empty source ids; opens: requiresOpen true for price / place / video items and false for a plain image; openedByActor true only for the same user and the current content fingerprint (open recorded for an older fingerprint or another user => false); manifestHash/approvedFingerprints match computeManifestHash / computeItemFingerprint for the same expiry; expiresAt = now + days; the grant is not written anywhere (store.allAuthorizations() empty); empty pack => no items.
RULES: only edit those two files. No `as unknown as`. Do not ask questions.
```

### r3

```text
Create src/lib/social/story-publish/preview.ts (exists empty) and test draft src/lib/social/story-publish/preview-draft.test.ts (exists empty). Read-only context: types.ts, store.ts, service-ports.ts, evaluate.ts, fingerprint.ts, in-memory-store.ts, and evaluate-test-template.ts (copy its fixtures/ports style).
preview.ts exports:
```ts
export type StoryServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

/** Only a global administrator (exact admin email, account not limited to one client) may act. */
export function requireGlobalAdmin(ports: Pick<StoryServicePorts, 'adminEmails'>, actor: StoryActor): StoryServiceResult<true>
// => { ok:false, status:403, error:'GLOBAL_ADMIN_REQUIRED' } unless actor.allowedClientId === null and actor.email trimmed+lowercased is in adminEmails.

export async function buildStoryPackPreview(input: {
  ports: StoryServicePorts; packId: string; clientId: string; actor: StoryActor; now: Date; expiresInDays?: number
}): Promise<StoryServiceResult<StoryPackPreview>>
// requireGlobalAdmin first; expiresInDays default 7; must be an integer 1..14 else { ok:false, status:400, error:'BAD_EXPIRY' }; evaluateStoryPack; empty pack => { ok:false, status:404, error:'PACK_NOT_FOUND' }; map each EvaluatedStoryItem to StoryPreviewItem (fields copied from item; requires_open <- requiresOpen; opened_by_me <- openedByActor; problems; already_attempted <- alreadyAttempted); counts: total, requires_open (count of requiresOpen), opened (count of requiresOpen AND openedByActor), with_problems (problems.length > 0); blocking = unique problem codes across items plus 'ITEMS_NOT_OPENED' when some requiresOpen item is not openedByActor; can_authorize = blocking.length === 0.

export async function recordStoryItemOpen(input: {
  ports: StoryServicePorts; packId: string; clientId: string; actor: StoryActor; itemId: string; channel: StoryChannel; now: Date
}): Promise<StoryServiceResult<{ fingerprint: string }>>
// requireGlobalAdmin; find the item among ports.store.getPackItems(packId, clientId) (404 'ITEM_NOT_FOUND' when missing); fingerprint = computeContentFingerprint(item) computed by the SERVER; await ports.store.recordOpen({ item_id, channel, opened_by_user_id: actor.id, opened_fingerprint: fingerprint, opened_at: now.toISOString() }); return { ok:true, value:{ fingerprint } }.
```
Keep each function under 50 lines. No `any`, no process.env. Only edit preview.ts.
Test (vitest draft; fixtures as in the template): non-admin email => 403 for both functions; admin whose allowedClientId is 'client-x' => 403; expiry validation (0, 15, 1.5, NaN => 400 BAD_EXPIRY; 1, 14 ok); empty pack 404; green pack => can_authorize true with counts; a price item not opened => blocking contains 'ITEMS_NOT_OPENED' and can_authorize false; after recordStoryItemOpen by the SAME actor it becomes opened_by_me true and can_authorize true; an open recorded by another user does not count; after the item's content changes in the store (re-seed with different text_line) the open no longer counts; recordStoryItemOpen stores the server-computed fingerprint (compare with computeContentFingerprint), unknown item 404, calling it twice is idempotent (one record in listOpens); a problem item (checkFile 'CHANGED') appears with problems ['FILE_CHANGED'] and blocking includes it.
RULES: only edit those two files. No `as unknown as`. Do not ask questions.
```

### r4

```text
Create src/lib/social/story-publish/authorize.ts (exists empty) and test draft src/lib/social/story-publish/authorize-draft.test.ts (exists empty). Read-only context: types.ts, store.ts, service-ports.ts, evaluate.ts, preview.ts, fingerprint.ts, in-memory-store.ts, preview-test-template.ts (copy its fixtures/ports).
authorize.ts exports:
```ts
export type AuthorizeOutcome =
  | { mode: 'PREVIEW'; preview: StoryPackPreview }
  | { mode: 'AUTHORIZED'; authorization_id: string; request_id: string; expires_at: string; item_count: number; provider_impact: 'NONE' }

export async function authorizeStoryPack(input: {
  ports: StoryServicePorts; packId: string; clientId: string; actor: StoryActor
  confirm: boolean; expiresInDays?: number; now: Date
}): Promise<StoryServiceResult<AuthorizeOutcome> & { rollback?: 'OK' | 'FAILED'; details?: unknown }>
```
Import StoryServiceResult and requireGlobalAdmin and buildStoryPackPreview from './preview'; evaluateStoryPack from './evaluate'; STORY_EVENTS, storyItemKey from './types'.
Behaviour, in this exact order (every refusal returns { ok:false, status, error } and writes NOTHING unless noted):
1. requireGlobalAdmin => 403.
2. expiresInDays default 7, integer 1..14 else 400 BAD_EXPIRY.
3. preview = buildStoryPackPreview(...). Not ok => return that failure (404 PACK_NOT_FOUND etc.). When confirm !== true => { ok:true, value:{ mode:'PREVIEW', preview } } (no writes).
4. When preview.blocking contains 'ITEMS_NOT_OPENED' => 409 ITEMS_NOT_OPENED with details = the item ids (and channels) that must be opened but were not. Any other blocking code => 422 PACK_NOT_AUTHORIZABLE with details = per-item problems [{item_id, channel, problems}].
5. Re-evaluate for the write: `evaluated = await evaluateStoryPack(...)` (same arguments) — its approvedFingerprints, manifestHash and expiresAt are what get stored.
6. Existing live grant: `live = await store.getLiveAuthorization(packId, clientId)`. When live !== null: it may be superseded ONLY if it has expired (expires_at unreadable or <= now) OR it never armed (activated_at null) and authorized_at is more than 5 minutes old; supersede = store.revokeAuthorization({ authId: live.id, packId, clientId, byEmail: 'system:superseded', reason: 'superseded by a new authorisation', now }) and a best-effort (try/catch, never blocks) ports.sendEvent for STORY_EVENTS.packRevoked with id `${live.id}:superseded`. Otherwise 409 ALREADY_AUTHORIZED (hint in details: revoke the current authorisation first).
7. requestId = ports.newId(). inserted = await store.insertAuthorization({ request_id: requestId, pack_id, client_id, authorized_by_email: actor.email trimmed lowercased, authorized_by_user_id: actor.id, authorized_at: now ISO, expires_at: evaluated.expiresAt, manifest_hash: evaluated.manifestHash, approved_item_fingerprints: evaluated.approvedFingerprints }); !ok => 409 ALREADY_AUTHORIZED.
8. From here ANY failure revokes THIS grant by id (byEmail 'system:authorize-failed') and reports rollback 'OK' | 'FAILED' (FAILED when the revoke itself throws or returns null while the grant is still live); the failure result has status 500 and the matching error: send event STORY_EVENTS.packAuthorized (id requestId; data: request_id, client_id, pack_id, item_count, expires_at, authorized_by_email, authorized_by_user_id, authorization: 'AUTHORIZED', provider_impact: 'NONE', mode: 'DRY_RUN', created_at) failing => 'AUTHORIZATION_EVENT_NOT_SENT'; then store.activateAuthorization throwing => 'AUTHORIZATION_NOT_ACTIVATED'; returning null => 409 'AUTHORIZATION_REVOKED_DURING_ARMING' (no rollback needed, report rollback 'OK'); then store.linkItemsToAuthorization (all items of the pack) throwing => 'ITEMS_NOT_LINKED'.
9. Final verification (catches edits between evaluation and linking): re-read items with store.getPackItems and recompute computeItemFingerprint(item, evaluated.expiresAt) for each; when the set of keys or any fingerprint differs from evaluated.approvedFingerprints, or computeManifestHash differs => rollback and 409 'PACK_CHANGED_DURING_AUTHORIZATION'.
10. Success: { ok:true, value:{ mode:'AUTHORIZED', authorization_id, request_id, expires_at, item_count, provider_impact:'NONE' } }.

```ts
export async function revokeStoryPack(input: {
  ports: StoryServicePorts; packId: string; clientId: string; actor: StoryActor; reason: string; now: Date
}): Promise<StoryServiceResult<{ authorization_id: string; in_flight: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>; note: string }>>
```
requireGlobalAdmin; reason must be a non-empty string of at most 300 chars after trim else 400 BAD_REASON; live = getLiveAuthorization else 404 NOTHING_TO_REVOKE; revoked = store.revokeAuthorization({authId, packId, clientId, byEmail, reason, now}); null => 404 NOTHING_TO_REVOKE; best-effort event STORY_EVENTS.packRevoked (id `${live.id}:revoked`; data: client_id, pack_id, authorization_id, revoked_by_email, reason, authorization: 'REVOKED', provider_impact: 'NONE') — an event failure does NOT undo the revoke; in_flight = attempts of the pack whose status is CLAIMED, RETRYABLE, CONTAINER_CREATED, PUBLISHING, PUBLISHED_UNVERIFIED or UNKNOWN_OUTCOME; note = 'Revoking stops anything not yet sent. Stories already published are NOT removed: delete them by hand in Facebook / Instagram.'
Functions under 50 lines each (split into helpers: rollbackGrant, supersedeIfStale, armGrant, verifyUnchanged, ...). No `any`, no process.env. Only edit authorize.ts.
Test (vitest draft): ports with vi.fn sendEvent and a deterministic newId; admin = 'pm@example.com'; a green pack of 3 items (two facebook, one video needing open). Tests: 403 for non-admin; confirm false => PREVIEW and store.allAuthorizations() empty and sendEvent not called; blocked by unopened item => 409 ITEMS_NOT_OPENED listing it and nothing written; blocked by a gate problem (checkFile 'CHANGED') => 422 with details; success after recordStoryItemOpen: one grant exists, activated, items linked (store.allItems() authorization_id set), event sent once with id = request id and provider_impact 'NONE', approved fingerprints and manifest hash stored equal computeItemFingerprint/computeManifestHash for the stored expiry; second authorise => 409 ALREADY_AUTHORIZED; supersede expired grant (seed via store.insertAuthorization with an old expires_at then activate) works and revokes the old one; an un-armed grant older than 5 minutes is superseded, a younger one is not; sendEvent rejecting => 500 AUTHORIZATION_EVENT_NOT_SENT with rollback 'OK' and the grant revoked; activate throwing (wrap the store in a Proxy-free subclass or spread a store with overridden method — implement by `Object.assign(store, { activateAuthorization: async () => { throw new Error('db') } })`) => 500 AUTHORIZATION_NOT_ACTIVATED rollback OK; activate returning null => 409 AUTHORIZATION_REVOKED_DURING_ARMING; linking throwing => 500 ITEMS_NOT_LINKED rollback OK; rollback itself failing (revoke throws) => rollback 'FAILED'; item changed between evaluation and verification (override getPackItems to return a modified item on the second call) => 409 PACK_CHANGED_DURING_AUTHORIZATION with rollback OK and the grant revoked; revoke: 403 non-admin, BAD_REASON (empty / 301 chars), NOTHING_TO_REVOKE, success revokes and returns in_flight list (seed attempts), event failure does not undo the revoke, second revoke => 404.
RULES: only edit those two files. No `as unknown as`. Do not ask questions.
```

### r5

```text
Create src/lib/social/story-publish/supabase-store.ts (exists empty). Read-only context: store.ts (the port to implement), types.ts, in-memory-store.ts (behavioural reference: the Supabase version must behave identically), and the SQL file story-sql.sql (the real tables).
Export `export class SupabaseStoryStore implements StoryStore` with `constructor(private readonly db: SupabaseClient)` (type import `import type { SupabaseClient } from '@supabase/supabase-js'`). Tables: story_pack_items, story_pack_auth, story_pack_item_opens, story_publish_attempts, story_reply_duty, story_asset_usage, clients. Rules:
- Every database error is THROWN (`if (error) throw error`); never swallow. The only meaningful non-throw error is a unique violation (code '23505') on insertAuthorization => { ok: false, error: 'ALREADY_AUTHORIZED' }.
- Timestamps come back from Postgres as strings like '2026-10-12T09:00:00+00:00': normalise EVERY timestamptz you map (slot_at, authorized_at, activated_at, expires_at, revoked_at, paused_at, opened_at) with `new Date(value).toISOString()`; null stays null. `website_checked_on` (date) stays the 'YYYY-MM-DD' string.
- getPackItems(packId, clientId): select('*') from story_pack_items eq pack_id, eq client_id, order by slot_at, item_id, channel (three .order calls); map rows to StoredStoryItem (all StoryItemSpec fields + authorization_id + paused_at); source_record_ids is a text[] (array in JSON).
- getLiveAuthorization(packId, clientId): from story_pack_auth eq pack_id eq client_id is revoked_at null maybeSingle; map to StoryAuthorization (id, pack_id, client_id, authorized_by_email, authorized_by_user_id, authorized_at, activated_at, expires_at, revoked_at, manifest_hash, approved_item_fingerprints as Record<string,string>).
- insertAuthorization(row): insert { request_id, client_id, pack_id, authorized_by_email, authorized_by_user_id, authorized_at, expires_at, manifest_hash, approved_item_fingerprints } .select('*').single(); activated_at stays null.
- activateAuthorization(authId, clientId): update { activated_at: now ISO } where id, client_id, revoked_at is null AND activated_at is null, select, maybeSingle; if a row came back return it mapped; otherwise read the row by id+client: when it exists, is not revoked and has activated_at already => return it mapped (idempotent); else null.
- revokeAuthorization({authId, packId, clientId, byEmail, reason, now}): update { revoked_at: now ISO, revoked_by_email, revoked_reason } where id, pack_id, client_id, revoked_at is null; select; maybeSingle; mapped or null.
- linkItemsToAuthorization({authId, items}): for each item update story_pack_items set authorization_id = authId where item_id and channel; each update must `.select('item_id')` and throw `new Error('unknown item')` when it affected no row (run sequentially; a failure stops and throws).
- recordOpen(record): upsert into story_pack_item_opens { item_id, channel, opened_by_user_id, opened_fingerprint, opened_at } with `{ onConflict: 'item_id,channel,opened_by_user_id,opened_fingerprint', ignoreDuplicates: true }`; an unknown item surfaces as the foreign-key error and is thrown.
- listOpens(packId): first select item_id from story_pack_items where pack_id; when none return []; then select from story_pack_item_opens `.in('item_id', ids)`; map to StoryOpenRecord (opened_at normalised).
- listAttempts(packId): select item_id, channel, status from story_publish_attempts where pack_id.
- getRegisteredAccounts(clientId): select facebook_page_id, client_status from clients where id maybeSingle; null when no row. `instagram_user_id` is ALWAYS null for now (the clients table has no Instagram user id column yet): write a comment saying so — an Instagram story therefore cannot be authorised until a registered Instagram account id exists.
- hasReplyOwner(clientId, dutyDate): select id from story_reply_duty where client_id and duty_date limit 1; true when a row exists.
- getAssetUsage(sha): select used_in from story_asset_usage where media_sha256; no rows => 'UNKNOWN'; any rows => 'USED' (the table only records used files; 'UNUSED' is returned by NOTHING here: say in a comment that an absent row means unknown, never unused).
Define small row types (interfaces) for what you read and map with them — no `any`, no `as unknown as`: for the Supabase result use `data as ItemRow[] | null`. Keep every function under 50 lines (helpers: mapItem, mapAuth, iso). File under 450 lines. Do not ask questions. Only edit supabase-store.ts.
```

### r6

```text
Create the test draft src/lib/social/story-publish/supabase-store-integration-draft.test.ts (exists empty). It is an INTEGRATION test that talks to a real Postgres through PostgREST, so it must be skipped unless two env vars are set. Read-only context: supabase-store.ts, store.ts, types.ts, service-ports.ts, authorize.ts, preview.ts, fingerprint.ts, story-sql.sql, authorize-test-template.ts (fixtures style).
Structure:
```ts
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
const REST_URL = process.env.STORY_REST_URL
const REST_KEY = process.env.STORY_REST_KEY
describe.skipIf(!REST_URL || !REST_KEY)('SupabaseStoryStore against a real database', () => { ... })
```
(Reading process.env in a TEST file is fine.) Create the client with `createClient(REST_URL as string-narrowed..., REST_KEY, { auth: { persistSession: false, autoRefreshToken: false } })` — narrow the env values without casts by early `if (!REST_URL || !REST_KEY) return` is not possible inside describe.skipIf, so read them via a helper `function env(name: string): string { const v = process.env[name]; if (!v) throw new Error(name + ' missing'); return v }` called inside beforeAll.
Use a fresh `clientId = randomUUID()` and `packId = randomUUID()` per test file run (so reruns never collide). Seed through the raw client: insert a clients row {id: clientId, facebook_page_id: '1234567890', client_status: 'active'}; insert story_pack_items rows for three items (two facebook images; one facebook video with media_kind 'video'), each with valid fields satisfying the SQL CHECKs: media_url 'https://cdn.example.com/x.jpg', media_sha256 64 hex, text_line, account_id '1234567890', source_record_ids ['fact-1'], website_ref 'https://example.com/p', website_checked_on '2026-10-12', slot_at in the future relative to NOW used by the services — use a FIXED `NOW = new Date('2026-10-12T00:00:00.000Z')` and slots '2026-10-12T20:00:00+13:00'-style instants a few hours later than NOW, has_reply_cta false.
Ports: store = new SupabaseStoryStore(db); adminEmails Set(['pm@example.com']); checkFile async 'OK'; checkPrice async 'OK'; sendEvent vi.fn(async () => {}); newId randomUUID; config { maxLateMinutes: 30, earlyMinutes: 30, staleClaimMinutes: 15, stalePublishingMinutes: 10, maxWebsiteAgeDays: 7, maxRetries: 3 }. Actor { id: randomUUID(), email: 'pm@example.com', allowedClientId: null }. Seed asset usage rows? NOT needed: facebook items need `getAssetUsage` 'UNUSED' to be authorisable, but the real store never returns UNUSED (absent row = UNKNOWN) — so test that: authorising the facebook pack is refused with PACK_NOT_AUTHORIZABLE and every item's problems contain 'ASSET_USAGE_UNKNOWN'. Then make the facebook authorisable by overriding ONLY getAssetUsage on the store instance: `Object.assign(store, { getAssetUsage: async () => 'UNUSED' as const })` (document why: the usage recorder ships later), and continue.
Tests, in order inside one describe with shared state (use `it` blocks that depend on earlier ones — it is an end-to-end rehearsal, say so in a comment):
1. read paths: getPackItems returns 3 items sorted, timestamps are canonical ISO strings (end with 'Z'), website_checked_on is 'YYYY-MM-DD'; getRegisteredAccounts => { facebook_page_id: '1234567890', instagram_user_id: null, client_status: 'active' }; hasReplyOwner false, then insert a story_reply_duty row for the NZ date of an item slot and it becomes true; getAssetUsage unknown => 'UNKNOWN', after inserting a story_asset_usage row => 'USED'.
2. preview: buildStoryPackPreview fails closed on the real store as described (asset usage unknown) — can_authorize false.
3. after the override: preview shows the video item requires_open and not opened; authorizeStoryPack(confirm true) => 409 ITEMS_NOT_OPENED and NO row in story_pack_auth for the pack.
4. recordStoryItemOpen for the video item; calling it twice leaves exactly ONE row in story_pack_item_opens.
5. authorizeStoryPack(confirm true) => AUTHORIZED; read back from the real tables: one story_pack_auth row for the pack with activated_at not null, revoked_at null, manifest_hash 64 hex, approved_item_fingerprints with 3 keys; all 3 story_pack_items have authorization_id = that id; sendEvent called once with name 'story.pack.authorized' and provider_impact 'NONE'.
6. database protections through the raw client (each must come back as an error): update story_pack_items.text_line of an authorised item; update story_pack_auth.manifest_hash; update story_pack_auth.expires_at; set story_pack_items.authorization_id to null; delete from story_pack_auth. Assert `error` is non-null for each and the stored values are unchanged.
7. second authorize => 409 ALREADY_AUTHORIZED (service) and a raw insert of a second live grant for the same pack => unique violation error.
8. revokeStoryPack => ok, row revoked_at set, in_flight []; after revoke the content lock is released (updating text_line of an item now succeeds) and a second revoke => 404; a raw update that tries to clear revoked_at => error.
9. cleanup in afterAll is NOT possible for story tables (delete is blocked by triggers): leave the rows (unique random ids), and delete only the clients row (best effort, ignore errors).
RULES: edit only the draft test file. No `any`, no `as unknown as`. Keep under 650 lines. Do not ask questions.
```

### r7

```text
Create src/lib/social/story-publish/file-check.ts (exists empty) and test draft src/lib/social/story-publish/file-check-draft.test.ts (exists empty). Read-only: types.ts.
file-check.ts exports:
```ts
export async function checkMediaFile(
  item: Pick<StoryItemSpec, 'media_url' | 'media_sha256'>,
  options: { fetcher?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<'OK' | 'CHANGED' | 'UNREACHABLE'>
```
Re-downloads the media behind `media_url` and compares its sha256 with `media_sha256`.
- media_url that does not parse or is not https => 'UNREACHABLE' (never fetched).
- Call `fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })` (default timeoutMs 20000, default maxBytes 100 * 1024 * 1024; default fetcher is global `fetch` resolved at call time).
- fetch throws, or response not ok => 'UNREACHABLE'.
- When the `content-length` header is a number larger than maxBytes => 'UNREACHABLE' without reading the body. Read the body with arrayBuffer(); a failure => 'UNREACHABLE'; byteLength > maxBytes or 0 => 'UNREACHABLE'.
- sha256 hex (node:crypto createHash) equal to item.media_sha256 (compare lowercase) => 'OK', otherwise 'CHANGED'.
- Never throw; never put the URL in any error (there are no errors returned).
Test: OK; CHANGED (different bytes); upper-case recorded hash still OK; http url, 'not a url', empty => UNREACHABLE and fetcher never called; fetch throws; 404; content-length too big => UNREACHABLE and body never read (track with a Response whose arrayBuffer is a vi.fn); empty body; options.timeoutMs passed as an AbortSignal (assert init.signal is an AbortSignal) and redirect 'error'; the default fetcher is resolved at call time (spy on globalThis.fetch).
RULES: edit only those two files. No `any`, no `as unknown as`, no process.env. Under 120 lines for the implementation. Do not ask questions.
```

### r8

```text
Create the vitest draft src/lib/social/story-publish/routes-draft.test.ts (exists empty): tests for the four Story pack routes (read-only attached copies: route-preview.ts, route-open.ts, route-authorize.ts, route-revoke.ts; plus route-support.ts, ports.ts, types.ts, service-ports.ts, in-memory-store.ts, authorize-test-template.ts for fixtures). The real route files live at `src/app/api/clients/[id]/story-packs/[packId]/{preview,open,authorize,revoke}/route.ts`; from the draft file's location import them with these relative paths (the draft is moved later; use EXACTLY these strings so a sed can fix the prefix):
  import { GET as previewGET } from 'ROUTES/preview/route'
  import { POST as openPOST } from 'ROUTES/open/route'
  import { POST as authorizePOST } from 'ROUTES/authorize/route'
  import { POST as revokePOST } from 'ROUTES/revoke/route'
Mocks at the top (vi.mock is hoisted; use vi.hoisted for shared state):
  vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
  vi.mock('@/lib/social/story-publish/ports', () => ({ createStoryServicePorts: vi.fn() }))
In beforeEach set createStoryServicePorts to return ports built over a fresh InMemoryStoryStore (green seeded pack as in authorize-test-template.ts: a facebook image item plus the account/asset-usage seeding, adminEmails Set(['pm@example.com']), checkFile 'OK', sendEvent vi.fn, deterministic newId, the gate config). CLIENT_ID and PACK_ID must be valid UUIDs; the seeded items use those ids. requireDashboardClientAccess mock returns { ok: true, user: { id: <uuid>, email: 'pm@example.com' }, role: 'admin', tier: 'admin', allowedClientId: null } by default (type the user loosely with a small helper returning the object; no `as unknown as` — build the mock value with `mockResolvedValue({ ok: true as const, user: {...} as User ... })` is NOT allowed; instead declare `const adminAccess = { ok: true, user: { id, email }, role: 'admin', tier: 'admin', allowedClientId: null }` and pass `vi.mocked(requireDashboardClientAccess).mockResolvedValue(adminAccess as Awaited<ReturnType<typeof requireDashboardClientAccess>>)` — a single `as` to the declared return type is fine).
Build NextRequest objects with `new NextRequest('http://localhost/x', { method, body: JSON.stringify(body), headers: {'content-type':'application/json'} })`; route handlers take (req, { params: { id, packId } }).
Tests:
- every route: 400 BAD_ID for a non-UUID client id or pack id (access mock not called); access failure passes through its status and error (401 / 403 / 402); a non-admin signed-in user (email 'someone@example.com', role 'client-viewer') => 403 GLOBAL_ADMIN_REQUIRED; a limited admin (allowedClientId = 'other') => 403.
- preview GET: 200 { success:true, pack_id, items:[...], can_authorize, counts, blocking } for the green pack; `?expires_in_days=0` => 400 BAD_EXPIRY; `?expires_in_days=abc` => 400 BAD_EXPIRY; unknown pack => 404 PACK_NOT_FOUND.
- open POST: 200 { success:true, fingerprint } and one record in the store; body with extra keys => 400 INVALID_OPEN_COMMAND; non-uuid item_id => 400; unknown channel => 400; unknown item => 404 ITEM_NOT_FOUND.
- authorize POST: empty body => PREVIEW mode (200, mode 'PREVIEW'), nothing written (store.allAuthorizations() empty) and sendEvent not called; { confirm: true } => 200 mode 'AUTHORIZED', provider_impact 'NONE', one activated grant, one event; second call => 409 ALREADY_AUTHORIZED; { confirm: 'yes' } => 400 INVALID_AUTHORIZE_COMMAND; { expires_in_days: 15 } => 400; extra keys => 400.
- revoke POST: missing / empty / 301-char reason => 400 INVALID_REVOKE_COMMAND; success after authorize => 200 with note containing 'NOT removed'; second revoke => 404 NOTHING_TO_REVOKE.
- unexpected failure: make the in-memory store's getPackItems throw new Error('secret-db-detail') for one test => 500 { success:false, error:'INTERNAL_ERROR' } and the response body never contains 'secret-db-detail'.
RULES: only edit that draft file. Keep under 600 lines. No `any`. Do not ask questions.
```

### 审查后修订轮

#### r9

```text
Edit BOTH src/lib/social/story-publish/in-memory-store.ts and src/lib/social/story-publish/supabase-store.ts (attached for editing; store.ts and types.ts are read-only: the StoryStore port changed). Make exactly these changes and nothing else:
1. `linkItemsToAuthorization(input: { authId: string; packId: string; clientId: string; items: Array<{ item_id: string; channel: StoryChannel }> })` — now scoped. In-memory: every listed (item_id, channel) must exist AND have pack_id === packId AND client_id === clientId, otherwise throw Error('unknown item') before changing anything (validate all first). Supabase: add `.eq('pack_id', input.packId).eq('client_id', input.clientId)` to each update (an update that touches no row still throws Error('unknown item')).
2. NEW port method `getActivePauses(packId: string, clientId: string): Promise<StoryPauseMark[]>` (type StoryPauseMark is exported from store.ts: { channel: StoryChannel | null; item_id: string | null }). In-memory: add public seed helper `seedPause(packId: string, clientId: string, mark: StoryPauseMark, lifted = false)` storing marks; getActivePauses returns copies of the NOT lifted marks for that pack and client. Supabase: select channel, item_id from story_pack_pauses where pack_id and client_id and lifted_at is null (`.is('lifted_at', null)`); throw on error; map rows to StoryPauseMark (channel and item_id may be null).
Keep all existing behaviour. Update imports (StoryPauseMark from './store'). No `any`, no `as unknown as`, no process.env. Do not ask questions.
```

#### r10

```text
Edit BOTH src/lib/social/story-publish/evaluate.ts and src/lib/social/story-publish/preview.ts (attached for editing; store.ts, types.ts, service-ports.ts, fingerprint.ts, in-memory-store.ts, gates.ts are read-only context). Make exactly these changes:
evaluate.ts
 1. `EvaluatedStoryPack` gains `contentHash: string` = `computeContentManifestHash(items)` (import it from './fingerprint').
 2. ALREADY_ATTEMPTED: only these attempt statuses count: CLAIMED, RETRYABLE, CONTAINER_CREATED, PUBLISHING, PUBLISHED_UNVERIFIED, PUBLISHED, FAILED_FINAL, UNKNOWN_OUTCOME, MISSED_WINDOW (define `const ATTEMPT_BLOCKS_AUTHORIZATION: ReadonlySet<StoryAttemptStatus>`). DRY_RUN, BLOCKED and SKIPPED_NOT_AUTHORIZED do NOT make a problem and `alreadyAttempted` stays null for them (the field keeps meaning "a sent or in-flight attempt exists").
 3. Open evidence has a lifetime: an open record only counts when its `opened_at` parses and is not older than STORY_OPEN_VALIDITY_MS before `now` and not more than 60 seconds in the future (import STORY_OPEN_VALIDITY_MS from './service-ports').
 4. Slot in the past: when the item's slot_at parses and is earlier than `now`, add the problem 'SLOT_IN_PAST' (in addition to whatever the gate said; do not duplicate it).
 5. Circuit marks: call `ports.store.getActivePauses(packId, clientId)` once per evaluation; for each item `itemPaused = item.paused_at !== null || marks.some(m => m.item_id === item.item_id && (m.channel === null || m.channel === item.channel))` and `packChannelPaused = marks.some(m => m.item_id === null && (m.channel === null || m.channel === item.channel))`; pass both into the gate's `circuit`. (gateDryRun/evaluateItem need the marks as an input.)
preview.ts
 6. `StoryPackPreview` now has `content_hash`: set it from the evaluation's contentHash.
 7. `buildStoryPackPreview` must be under 50 lines: extract helpers (validateExpiry, buildCounts, ...).
Keep every function under 50 lines, no `any`, no `as unknown as`, no process.env. Do not ask questions.
```

#### r11

```text
Rewrite src/lib/social/story-publish/authorize.ts (attached for editing; keep what is not mentioned). Read-only context: types.ts, store.ts, service-ports.ts, evaluate.ts, preview.ts, fingerprint.ts. The goals: a different, safer ORDER of the write steps, a preview-bound confirmation, and every function under 50 lines (split into small helpers; today authorizeStoryPack is ~165 lines and armGrant 56).
authorizeStoryPack input gains `expectedContentHash?: string`. The outcome type for AUTHORIZED gains `note: string` = 'Recorded only. The automatic publisher is not running yet.'
NEW ORDER (every refusal writes nothing unless noted):
 1. requireGlobalAdmin => 403. expiresInDays 1..14 else 400 BAD_EXPIRY.
 2. preview = buildStoryPackPreview(...). Not ok => return it. confirm !== true => PREVIEW (no writes).
 3. confirm === true: expectedContentHash must be a 64-char lowercase hex string else 400 CONTENT_HASH_REQUIRED; it must equal preview.content_hash else 409 PACK_CHANGED_SINCE_PREVIEW. Then preview.blocking: ITEMS_NOT_OPENED => 409 (details = the unopened items); any other => 422 PACK_NOT_AUTHORIZABLE (details = per-item problems).
 4. evaluated = evaluateStoryPack(...) again; REPEAT the same three checks on it: evaluated.contentHash must equal preview.content_hash (else 409 PACK_CHANGED_SINCE_PREVIEW), no item requiresOpen && !openedByActor (409 ITEMS_NOT_OPENED), no item with problems (422 PACK_NOT_AUTHORIZABLE).
 5. A live grant: supersede only when expired, or never armed and older than 5 minutes (as today); the 'superseded' packRevoked event (id `${live.id}:superseded`) is sent ONLY when store.revokeAuthorization returned a non-null row; otherwise 409 ALREADY_AUTHORIZED.
 6. insertAuthorization (inactive) — ALREADY_AUTHORIZED => 409.
 7. From here ANY failure rolls back this grant by id (revoke with byEmail 'system:authorize-failed'), reports rollback 'OK' | 'FAILED', status 500 and the matching error, in this order:
    a. linkItemsToAuthorization({ authId, packId, clientId, items }) throws => 'ITEMS_NOT_LINKED'.
    b. verifyUnchanged (re-read the pack; every item's computeItemFingerprint(item, expiresAt) must equal evaluated.approvedFingerprints, same key set, manifest hash equal) false => 409 'PACK_CHANGED_DURING_AUTHORIZATION' with the rollback result.
    c. send the packAuthorized event (id = requestId; data as today plus `mode: 'DRY_RUN'`) — throws => 'AUTHORIZATION_EVENT_NOT_SENT'.
    d. activateAuthorization throws => 'AUTHORIZATION_NOT_ACTIVATED'; returns null => 409 'AUTHORIZATION_REVOKED_DURING_ARMING' (rollback 'OK').
    When a rollback happens AFTER the authorized event was sent (step d), also send a best-effort packRevoked event (id `${authId}:rollback`) so nothing downstream keeps believing the pack is authorised.
 8. Success: { mode:'AUTHORIZED', authorization_id, request_id, expires_at, item_count, provider_impact:'NONE', note }.
 9. Swallowed best-effort events must at least log: `console.error('[story-authorize] event not sent', eventName)` (event NAME only, never the error object or data).
revokeStoryPack: same checks as today with these changes: reading attempts after the revoke is wrapped in try/catch — on failure return ok with `in_flight: []`, `already_sent: []` and `attempts_known: false` (the revoke itself already succeeded; never turn it into a 500); the result splits statuses: `in_flight` = CLAIMED, RETRYABLE, CONTAINER_CREATED, PUBLISHING, UNKNOWN_OUTCOME; `already_sent` = PUBLISHED_UNVERIFIED, PUBLISHED; add `attempts_known: boolean` (true normally). The note stays.
Keep exports AuthorizeOutcome, AuthorizeResult, authorizeStoryPack, revokeStoryPack. No `any`, no process.env. Do not ask questions. Only edit authorize.ts.
```

#### r12

```text
Fix pass on src/lib/social/story-publish/authorize.ts (attached for editing; types.ts, store.ts, service-ports.ts, evaluate.ts, preview.ts, fingerprint.ts read-only). Keep ALL behaviour except the three corrections below.
1. TYPES: `StoryServiceResult` has no `details`/`rollback`. Define locally `export type AuthorizeFailure = { ok: false; status: number; error: string; details?: unknown; rollback?: 'OK' | 'FAILED' }` and make every internal check function (checkEvaluated, checkPreview, checkContentHash, insertGrant, clearLiveGrant, ...) return `{ ok: true; value: T } | AuthorizeFailure` instead of StoryServiceResult<T>. The file must type-check with no errors.
2. ORDER: in authorizeStoryPack the verification that the pack is unchanged (`verifyUnchanged`) must run RIGHT AFTER the items are linked and BEFORE the packAuthorized event is sent. The required write order is: insert (inactive) -> link items -> verifyUnchanged -> send packAuthorized event -> activate. A failure in link (ITEMS_NOT_LINKED, 500), in verify (409 PACK_CHANGED_DURING_AUTHORIZATION) or in the event (AUTHORIZATION_EVENT_NOT_SENT, 500) rolls the grant back WITHOUT sending a packRevoked event (the authorised event was not sent); a failure in activate (AUTHORIZATION_NOT_ACTIVATED) rolls back AND sends the best-effort packRevoked event (id `${authId}:rollback`); activate returning null => 409 AUTHORIZATION_REVOKED_DURING_ARMING with rollback 'OK'. Today verifyUnchanged runs at the very end, after arming: move it.
3. FUNCTION LENGTH (hard limit 50 lines per function, count from the signature line to the closing brace): authorizeStoryPack (121 lines today), armGrant (68) and revokeStoryPack (70) are too long. Split them, for example: authorizeStoryPack = admin/expiry/preview/confirm checks (helper `confirmChecks`) + `writeGrant`; split armGrant into `linkItemsOrRollback`, `verifyOrRollback`, `sendAuthorizedEventOrRollback`, `activateOrRollback`, each returning `{ ok: true } | AuthorizeFailure`; revokeStoryPack = `readRevokeInput` + the revoke + `summariseAttempts`. After editing, count the lines of every function yourself and make sure none exceeds 50.
No `any`, no process.env. Do not ask questions. Only edit authorize.ts.
```

#### r13

```text
Edit the test file src/lib/social/story-publish/evaluate-draft.test.ts (attached for editing; read-only context: evaluate.ts, types.ts, store.ts, service-ports.ts, fingerprint.ts, in-memory-store.ts). KEEP every existing test unchanged (fix an existing test only if the NEW behaviour below makes it wrong, and say why in a comment) and ADD tests for the new evaluate.ts behaviour:
1. Attempt statuses: rows with status DRY_RUN, BLOCKED, SKIPPED_NOT_AUTHORIZED do NOT add a problem and leave alreadyAttempted null; each of CLAIMED, RETRYABLE, CONTAINER_CREATED, PUBLISHING, PUBLISHED_UNVERIFIED, PUBLISHED, FAILED_FINAL, UNKNOWN_OUTCOME, MISSED_WINDOW adds the problem 'ALREADY_ATTEMPTED' and sets alreadyAttempted to that status (loop over them with store.seedAttempts).
2. Open evidence lifetime (STORY_OPEN_VALIDITY_MS = 24h from './service-ports'): for a price item (contains_price true) an open recorded with opened_at = now - 23h and the current content fingerprint counts (openedByActor true); now - 25h does not; now + 2 minutes (future) does not; now + 30 seconds still counts. Record them with store.recordOpen using computeContentFingerprint.
3. SLOT_IN_PAST: an item whose slot_at is 1 minute before `now` gets the problem 'SLOT_IN_PAST' (and still reports whatever the gate said); slot exactly equal to now does not.
4. Circuit marks via store.seedPause(packId, clientId, mark): { channel: null, item_id: null } pauses every item (problems contain 'CIRCUIT_PAUSED'); { channel: 'facebook_story', item_id: null } pauses facebook items but not instagram items; { channel: 'facebook_story', item_id: '<that item>' } pauses only that item; a lifted mark (seedPause(..., true)) changes nothing; item.paused_at set also pauses.
5. contentHash: equals computeContentManifestHash of the stored items; changes when an item's text_line changes; is the same for expiresInDays 1 and 14 while manifestHash differs between them.
Keep imports tidy; no `any`, no `as unknown as`. Under 800 lines total. Only edit that draft file. Do not ask questions.
```
