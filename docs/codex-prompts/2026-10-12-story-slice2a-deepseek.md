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
