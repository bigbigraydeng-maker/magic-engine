# Magic Engine — Entity Definition v1 factual alignment (for #1049)

**Scope**: mechanical alignment of public-facing entity claims to #1049 Entity Definition v1. **No SEO / positioning / measurement / connector / deployment work.**

**Companion PRs**: #1043 (T0 main receipt · Draft) · #1051 (GEO 18/18 · Draft) · #1055 (measurement wiring · Draft, other window) · #1056 (Phase 1B tech SEO · Draft).

**Parent**: #1041 T0 Freeze Gate · **Source of truth**: #1049 Entity Definition v1 (frozen 2026-08-18 by PM).

---

## 1. Frozen facts from #1049 (source of truth for this PR)

| Field | Value |
|---|---|
| Public brand | Magic Engine |
| Product type | digital marketing product |
| Legal entity | Magic Engine AI Technology Limited |
| Jurisdiction | New Zealand |
| Public address | **not public** |
| Founder | Ray Deng |
| Founder title | Founder |
| Primary market | Australia + New Zealand |
| Canonical description | "Magic Engine helps English- and Chinese-speaking teams across Australia and New Zealand improve SEO, GEO, training, and launch-ready execution in one place—turning diagnosis into visible work." |
| Magic Lab | `proposed_future_holding_brand` — **not registered**, **not currently the legal parent/owner**; do not claim otherwise in public |

## 2. Overlap with #1056 (exact)

| File | #1056 change | This PR change | Line conflict? | Coordination |
|---|---|---|---|---|
| `website/about.html` | Adds `<script type="application/ld+json">` block in `<head>` (~L17) with `Organization: {name,url,email,areaServed}` | Body: replaces 3-line entity block with new entity line; adds a lead `<p>` carrying the frozen canonical description below `<h1>` | ❌ different lines / different sections | Whichever merges second **rebases** and keeps the `Organization` JSON-LD as the union: `{name, legalName, url, email, founder, areaServed}` (from this PR) rather than #1056's smaller set. |
| `website/cn/about.html` | Adds hreflang `x-default` in `<head>` | Body: entity-block replaced | ❌ different lines | Trivial rebase |
| `website/discover.html`, `website/features.html` | Head: hreflang + JSON-LD block | Footer entity line replaced | ❌ different sections | Trivial rebase |
| `website/cn/discover.html`, `website/cn/features.html` | Head: hreflang | Footer entity line replaced | ❌ different sections | Trivial rebase |
| `website/sitemap.xml` | lastmod updates on 4 URLs | untouched | ❌ | none |

**Recommended merge order**: Entity Alignment PR → #1056 (rebase). Reason: entity facts must precede any technical SEO work that would otherwise ship with the wrong footer/JSON-LD to production. Both PRs remain Draft until PM confirms.

**Entity Alignment PR explicitly does not touch**: `#1055` branch, `website/google-tag.js`, `scripts/phase1a/**`, any GA4/GSC/measurement/snapshot/connector code path, any `docs/marketing/me-phase1a-*` doc.

## 3. Public-facing changes (allowed by PM directive)

### 3.1 Homepage header + footer + JSON-LD (`website/index.html`)

- **Removed** `<span class="me-sub">by Magic Lab / 由 Magic Lab 出品</span>` under the logo (was line 55).
- **Removed** `"parentOrganization": { "@type": "Organization", "name": "Magic Lab" }` from the `Organization` JSON-LD.
- **Added** to the `Organization` JSON-LD (top-level fields only, no `address`, no `foundingLocation`):
  - `"legalName": "Magic Engine AI Technology Limited"`
  - `"founder": { "@type": "Person", "name": "Ray Deng", "jobTitle": "Founder" }`
  - `"email": "raydeng@magicengine.com.au"` (previously only in `contactPoint.email`; hoisting matches Schema.org Organization pattern)
- Footer `© 2026 Magic Engine by Magic Lab · Australia & New Zealand` → `© 2026 Magic Engine AI Technology Limited · Australia & New Zealand` (via bulk sed across 6 EN + 1 CN pages).

### 3.2 Footer entity line — all pages (single-line bulk replace)

All footer occurrences of `ABC Plus Home Pty Limited · ABN 45 674 442 445 · 98 Beatrice Ave, Ascot, Brisbane QLD 4007, Australia · raydeng@magicengine.com.au` → `Magic Engine AI Technology Limited · New Zealand · raydeng@magicengine.com.au`.

Applied across EN pages (`ai-search.html`, `ai-training.html`, `terms.html`, `privacy.html`, `about.html`, `geo.html`, `index.html`, `ai-search-faq.html`, `ai-marketing-smes.html`, `training.html`, `ads.html`, `features.html`, `discover.html`, `ai-search-snippets.html`, `cn.html`) and CN pages (`cn/about.html`, `cn/ads.html`, `cn/ai-automation.html`, `cn/ai-search-faq.html`, `cn/ai-marketing-smes.html`, `cn/ai-search-snippets.html`, `cn/ai-training.html`, `cn/ai-search.html`, `cn/discover.html`, `cn/index.html`, `cn/features.html`, `cn/geo.html`, `cn/training.html`, `cn/privacy.html`, `cn/terms.html`).

### 3.3 About page body — canonical description added

`website/about.html`: a new `<p class="lead">` inserted directly under the `<h1>About Magic Engine</h1>` carrying the frozen #1049 canonical description verbatim. Existing "Who we are" copy at L72-77 is **untouched** (PM §B.9: "不要顺带重写其他 positioning").

`website/cn/about.html`: PM approved a CN canonical description on 2026-08-19 (see §9.6). This is now applied as a plain-text `<p class="lead">` under `<h1>关于 Magic Engine</h1>` — the CN About page uses no `data-en`/`data-zh` attributes anywhere, so it follows the page's own convention.

The `data-zh` attribute on `website/about.html`'s lead paragraph, which round 1 temporarily populated with the EN string, now carries the same PM-frozen CN string. `data-en` and the rendered EN text are unchanged. See §9.6 for the clause-by-clause EN/CN semantic-equivalence check.

### 3.4 About page entity block (about.html + cn/about.html)

3-line block `ABC Plus Home Pty Limited · ABN … <br> 98 Beatrice Ave … <br> raydeng@…` → 3-line block `Magic Engine AI Technology Limited <br> New Zealand <br> raydeng@magicengine.com.au`.

### 3.5 `llms.txt` — Legal entity section appended

```
## Legal entity

Magic Engine is operated by Magic Engine AI Technology Limited, a company registered in New Zealand. Magic Engine serves customers across Australia and New Zealand. Founder: Ray Deng.
```

Consistent with the About page canonical description and the index Organization JSON-LD.

## 4. Terms + Privacy (minimum entity-name diff; legal review required)

`website/terms.html`, `website/cn/terms.html`, `website/privacy.html`, `website/cn/privacy.html`:

- **Only change**: entity name replacement inside body copy: `ABC Plus Home Pty Limited` → `Magic Engine AI Technology Limited` (2 occurrences in each Terms, 1 in each Privacy).
- Entity block in body-footer replaced (per §3.4).
- Public physical address removed.
- **HTML comment marker inserted immediately inside `<head>`**:
  ```html
  <!-- LEGAL REVIEW REQUIRED BEFORE MERGE: operating-entity name updated per #1049 Entity Definition v1 to Magic Engine AI Technology Limited (New Zealand). Governing law, jurisdiction clause, New Zealand Privacy Act 2020 vs Australian Privacy Principles applicability, Australian Consumer Law reference, cross-border data disclosure, and NZ Company Number / NZBN display remain UNTOUCHED and require legal counsel review before this file is merged. See PR body for the exact diff. -->
  ```

**This PR explicitly does not touch, and this PR must not be interpreted as legally reviewing:**
- Governing law
- Jurisdiction clause
- New Zealand Privacy Act 2020 vs Australian Privacy Principles applicability boundary
- Australian Consumer Law reference
- Cross-border data disclosure sections
- NZ Company Number / NZBN display requirements
- Historical web-publication review — see §9.5 item 6
- Terms/Privacy versioning/effective-date semantics

**PR checklist blocker**: these 4 files (EN + CN Terms + Privacy) **must not merge without legal counsel sign-off**. Even if the rest of the PR is approved, these four remain blocked.

## 5. Internal docs alignment (agent-facing facts)

Added Entity clarification callouts / notes at the top of each file, without rewriting historical body copy:

- `CLAUDE.md:12` — project positioning statement now names Magic Engine AI Technology Limited (NZ) as operator; Magic Lab explicitly flagged as `proposed_future_holding_brand`, unregistered, not current legal parent.
- `docs/PRODUCT.md` — new Entity clarification callout in the intro block. Historical "Magic Lab 旗下 / Magic Lab 在 2026 年的旗舰产品 / Magic Lab 团队" wording preserved verbatim (per PM: "不要修改历史 receipt 中的原始事实") but marked as internal-only working name that agents must not use in customer-facing outputs.
- `docs/ARCHITECTURE.md:0` — Entity clarification callout added above §0 战略定位; historical wording preserved.
- `docs/ROADMAP.md` — Entity clarification note added to intro; existing "Magic Lab Academy" and "Magic Lab Class" line-item mentions preserved as `internal working name; not a registered parent entity`.

**No history rewritten**. Existing `docs/history/CHANGELOG.md` and `docs/marketing/me-organic-growth-t0-baseline-*.md` (PR #1043) untouched — those are frozen receipts. Any correction to those goes as an additive clarification, not a rewrite.

## 5a. `ABC Plus Home Pty Limited` — factual record

**ABC Plus Home Pty Limited is a separate company also owned by Ray Deng. It has not been renamed to
Magic Engine or Magic Engine AI Technology Limited and is not the current operator, parent, or legal
predecessor of the Magic Engine product. It has no current role in Magic Engine operations. No
corporate handover, rename, contract migration, or business transfer is part of this entity-alignment work.**

中文记录：

> ABC Plus Home Pty Limited 是 Ray Deng 持有的另一家独立公司。该公司未更名为 Magic Engine 或
> Magic Engine AI Technology Limited，不是 Magic Engine 当前运营方、母公司或法律前身，目前不参与
> Magic Engine 业务。本次实体对齐不涉及公司交接、更名、合同迁移或业务转让。

Why it appeared on Magic Engine's public pages: the static Terms / Privacy / About / footers on
`magicengine.com.au` at one point named `ABC Plus Home Pty Limited · ABN 45 674 442 445 · 98 Beatrice
Ave, Ascot, Brisbane QLD 4007, Australia` as if it were Magic Engine's operating entity. That naming
was factually wrong — the two companies are not the same, and neither is the successor to the other.
This PR removes those strings from Magic Engine's public surface. It does not touch, transfer, or
otherwise affect ABC Plus Home Pty Limited itself.

Nothing in this PR should be read as implying:

- that ABC Plus Home Pty Limited was ever Magic Engine's operator, parent, predecessor, or a party
  to any Magic Engine customer contract;
- that a corporate rename, business transfer, contract migration, or handover has occurred, is
  planned, or is a legal requirement created by this PR;
- that ABC Plus Home Pty Limited needs to be named anywhere on Magic Engine's site or contracts
  going forward.

Those are open legal / factual questions for counsel to answer against the actual publication and
acceptance record (§9.5 item 6). This PR states only what is verifiable in the repo: `ABC Plus Home
Pty Limited` should not have been in Magic Engine's public copy, and it has been removed.

## 6. Test results (§E)

| # | Test | Result |
|---|---|---|
| E.1a | `ABC Plus Home Pty Limited` in `website/**` | 0 occurrences |

**Two independent gates** — round 3 clarification: the **stale-entity scan** greps `website/**` (and, from round 2 onward, `src/**`) for exact strings that name the wrong entity — most notably `ABC Plus Home Pty Limited` and its Brisbane street address, which were previously (and incorrectly) used as if they identified Magic Engine's operating entity (see §5a for the correct status of that company). The **legal-review gate** is a separate checklist that must be signed off by counsel before Terms/Privacy merge (§9.5). Neither gate substitutes for the other; passing one does not weaken the other. Round 1 tried to keep the two visually decoupled by rewording the historical entity reference inside a LEGAL REVIEW HTML comment — that comment was itself the wrong instrument and has been removed in round 3 (see §10.1). The stale-entity scan checks the exact strings; the legal-review checklist is verified independently in the PR body and this document, not by grep.
| E.1b | `ABN 45 674 442 445` in `website/**` | 0 occurrences |
| E.1c | `Magic Engine by Magic Lab` in `website/**` | 0 occurrences |
| E.1d | `parentOrganization` in `website/**` | 0 occurrences |
| E.1e | Legal-entity Brisbane address (`Beatrice Ave` / `Ascot QLD 4007` / `98 Beatrice`) | 0 occurrences |
| E.1f | `by Magic Lab` / `由 Magic Lab` anywhere in `website/**` | 0 occurrences |
| E.2 | EN + CN pages entity line consistency | Single canonical line: `Magic Engine AI Technology Limited · New Zealand · raydeng@magicengine.com.au` |
| E.3 | JSON-LD blocks parse via `json.loads` | **25/25 valid, 0 failed** |
| E.4 | Public **street/postal address** on the public site (JSON-LD `address` / `PostalAddress` node, or `<address>` used as a physical address) | **0 occurrences** |
| E.4a | Any JSON-LD `PostalAddress` node in `website/**` | **0 occurrences** |
| E.4b | `<address>` HTML element in `website/**` | **0 occurrences** |
| E.4c | `<address>` HTML element in `src/app/**` used for anything other than a physical street/postal address | 2 occurrences (`src/app/about/page.tsx`, `src/app/privacy/page.tsx`) — both now contain the operator name and the single line `New Zealand` (jurisdiction), not a street address. `<address>` is the correct HTML element for contact information in general (`href="mailto:..."` blocks), so it is retained; removing it purely to satisfy a mis-worded audit assertion would be wrong |
| E.5 | HTML structural sanity (all files parseable by python `html.parser`) | Passed (see §7 note) |
| E.6 | `llms.txt` Legal entity section consistent with About + JSON-LD | Yes — all three name `Magic Engine AI Technology Limited` + `New Zealand` + `Ray Deng · Founder` |
| E.7 | Exact overlap with #1056 | See §2 table — no line conflict, semantic coordination needed on `about.html` Organization JSON-LD union |

Non-Brisbane mentions retained (correctly — these are customer testimonials / market mentions, not legal-entity claims): `Café owner · Brisbane QLD` in customer quotes, `Auckland + Brisbane Chinese market` in ads targeting copy.

## 7. Notes

- `website/about.html` uses `data-en` / `data-zh` for i18n. The About lead paragraph's `data-zh` now carries the PM-frozen CN canonical description (§9.6) — it is no longer a placeholder.
- `website/cn/about.html` uses no `data-en`/`data-zh` attributes anywhere; the PM-frozen CN canonical description is inserted as plain text under `<h1>`, mirroring that page's own convention.
- No changes to `website/robots.txt`, `website/sitemap.xml`, `website/app.js`, `website/google-tag.js`, `website/meta-pixel.js`, `scripts/**`.
- **Revised 2026-08-19 (round 2)**: `src/**` IS now in scope — see §9. The round-1 scan was limited to `website/**` and therefore missed the Next.js app's own public entity pages, which carried the same wrong facts.

## 9. Round 2 (2026-08-19) — app-layer entity surfaces + main refresh

Round 1 (commit `ed098cf9`) scanned and fixed **`website/**` only**. A whole-repo scan in round 2 found the
Next.js app serves its own public entity pages that round 1 never touched, still claiming the old facts.

### 9.1 Branch refreshed onto latest main

`git merge origin/main` (no rebase, per repo git rules). Main tip `1d66c7f3`; #1055 merge `330e4a5e` confirmed as
an ancestor of main before any work started. Merge was clean — **0 conflicts**. Main had touched none of the
`website/**` HTML in between; its only overlap with this branch's file set was `CLAUDE.md`, `docs/ROADMAP.md`
and `website/google-tag.js` (the last is #1055 territory and remains untouched here).

### 9.2 Public app pages corrected

| File | Wrong claim (before) | Now |
|---|---|---|
| `src/app/about/page.tsx` | `Magic Lab — operator of Magic Engine`; `98 Beatrice Terrace, Ascot, Brisbane, Queensland, Australia`; footer `© Magic Lab` | `Magic Engine AI Technology Limited — operator of Magic Engine`; `New Zealand`; footer `© Magic Engine AI Technology Limited` |
| `src/app/contact/page.tsx` | Brisbane street address; footer `© Magic Lab` | `New Zealand`; footer entity corrected |
| `src/app/privacy/page.tsx` | Contact block `Magic Lab` + Brisbane street address | Entity name + `New Zealand`; **`LEGAL REVIEW REQUIRED BEFORE MERGE` marker added at file head** |
| `src/app/terms/page.tsx` | `operated by Magic Lab`, `owned by Magic Lab`, `Magic Lab shall not be liable` (3 occurrences) | Entity name in all 3; **`LEGAL REVIEW REQUIRED BEFORE MERGE` marker added at file head** |
| `src/app/layout.tsx` | `authors` / `creator` / `publisher` metadata all `Magic Lab` — emitted on **every** app page | All three now `Magic Engine AI Technology Limited` |
| `src/app/authorisation/page.tsx` | `Magic Engine is built and operated by Magic Lab, which is the name you will see on invoices…`; footer `© Magic Lab` | Entity name in both. This is the platform-facing authorisation/anti-phishing disclosure — the invoice name it promises must match the real operating entity |
| `src/app/page.tsx` | Homepage footer `© Magic Lab. All rights reserved.` | `© Magic Engine AI Technology Limited. All rights reserved.` |
| `README.md` | `Magic Lab 2026 旗舰产品` in the repo subtitle | Subtitle de-parented; Magic Lab explicitly marked `proposed_future_holding_brand, unregistered, not current legal parent` |

`src/app/terms/page.tsx` §9 Governing Law (`the laws of New South Wales, Australia`) is **deliberately untouched** —
an NZ-incorporated operator with an NSW governing-law clause is exactly the kind of question this PR is not
allowed to answer. It is a **legal blocker**, listed in §9.5.

### 9.3 Canonical internal marker normalised

The exact machine-readable label `proposed_future_holding_brand, unregistered, not current legal parent` now appears in
`CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md` — round 1 had the meaning in prose
but not one consistent greppable token.

### 9.4 `Magic Lab` occurrences deliberately RETAINED (not entity claims)

Left alone on purpose; flagged here so a future scan does not read silence as an oversight:

- `src/app/unauthorized/page.tsx`, `src/components/auth/FeatureLockGate.tsx`, `src/lib/auth/client-access.ts`,
  `src/lib/mtc/charge.ts`, `src/lib/messaging/adapters/messenger.ts`, `src/app/api/**` error strings — internal
  support/team copy shown to authenticated users ("contact the Magic Lab team"), not a legal-entity or ownership claim.
- `public/decks/magic-lab-class-membership/**` — Magic Lab Class is a separate brand/product surface, out of scope for
  the Magic Engine entity layer.
- `src/lib/diagnostic/scheduled-run.ts` + tests, `supabase/migrations/**` — `Magic Lab` there is a **client record name**
  in the database. Factual; renaming it would corrupt data references.
- `website/**` "Brisbane" hits — customer testimonials (`Café owner · Brisbane QLD`) and ads-targeting copy
  (`Auckland + Brisbane Chinese market`, `areaServed` on `cn/ads.html`). Market/service-area facts, not the entity address.

### 9.5 Legal blockers (unchanged + newly surfaced)

Must be answered by counsel before ANY of the Terms/Privacy files merge:

1. Governing law + jurisdiction — `website/terms.html`, `website/cn/terms.html` **and now `src/app/terms/page.tsx`
   (currently New South Wales, Australia, against an NZ operating entity)**.
2. NZ Privacy Act 2020 vs Australian Privacy Principles applicability boundary (both website and `src/app/privacy/page.tsx`).
3. Australian Consumer Law reference.
4. Cross-border data disclosure.
5. NZ Company Number / NZBN public display requirement (nothing displayed today).
6. **Historical web-publication review** — earlier public Terms/Privacy pages named `ABC Plus Home Pty Limited`. A qualified lawyer should determine whether prior published versions need to be retained, archived, versioned, or accompanied by a correction notice, if any users accepted or relied on those versions. This PR makes no assumption that users have or have not accepted the earlier text, that any contract migration is required, or that any prior entity name must remain on the site.

### 9.6 CN canonical description — APPROVED by PM 2026-08-19

**Status**: PM approved. Applied verbatim in the two places below. This sentence only — no other CN positioning copy has been written, extended, or rewritten.

Frozen CN canonical description:

> Magic Engine 帮助澳大利亚和新西兰的英语及中文团队，在一个平台中提升 SEO、GEO、培训和可上线的执行能力，把诊断转化为清晰可见的实际工作。

Actual code landing:

- `website/about.html` — the lead paragraph's `data-zh` attribute now carries the frozen CN string. `data-en` and the rendered EN body text are unchanged.
- `website/cn/about.html` — new plain-text `<p class="lead">` directly under `<h1>关于 Magic Engine</h1>`, mirroring the EN page's structure. This page uses no `data-en`/`data-zh` attributes anywhere, so the paragraph follows the page's own convention.

**Semantic equivalence check** (EN → CN, clause by clause):

| EN clause | CN clause | Equivalent |
|---|---|---|
| helps | 帮助 | ✅ |
| English- and Chinese-speaking teams | 英语及中文团队 | ✅ |
| across Australia and New Zealand | 澳大利亚和新西兰的 | ✅ |
| improve SEO, GEO, training, and launch-ready execution | 提升 SEO、GEO、培训和可上线的执行能力 | ✅ |
| in one place | 在一个平台中 | ✅ meaning preserved; CN says "platform" where EN says "place" — slightly more specific, still the same claim |
| turning diagnosis into visible work | 把诊断转化为清晰可见的实际工作 | ✅ meaning preserved; CN adds "清晰/实际" (clear/actual) as natural Chinese emphasis |

No claim exists in one language and not the other. Both strings are PM-frozen; the two nuances above are recorded, not edited.

**Still untranslated on `website/cn/about.html` (pre-existing, out of scope)**: the "Who we are" / "Our name" body paragraphs are still English on the CN page. That predates this PR and is positioning copy, so it is left alone.

## 10. Round 3 (2026-08-19) — closure fixes

Independent review of #1061 flagged nine items. All addressed here; none touch legal wording.

### 10.1 Public HTML must not carry the legal-review comment (P1)

The 4 static Terms/Privacy files (`website/{,cn/}terms.html`, `website/{,cn/}privacy.html`) previously carried a `<!-- LEGAL REVIEW REQUIRED BEFORE MERGE: … -->` block in `<head>`. That comment shipped to viewers whenever the page did — turning a review checklist item into public content. **Removed in all 4 files.**

The Next.js source-file comments at the top of `src/app/terms/page.tsx` and `src/app/privacy/page.tsx` **do not appear** in the build output (verified: `grep -l 'LEGAL REVIEW' .next/server/app/` returns 0 files, both before and after this change). They are slimmed to a pointer at this document, and the full risk list lives in exactly three places: this doc (§5 + §9.5), the PR body, and the PR review checklist. **Removing the public HTML comment is a fact-hygiene fix; it is NOT a claim that legal review has been completed.** Terms/Privacy remain blocked from merge until counsel signs off.

### 10.2 `<address>` element (P2-1)

Round 1's E.4 was worded as "any `<address>` element on public site" — that was a mis-worded assertion, not a legal requirement. The actual claim that must be true is: **no public street/postal address, no `PostalAddress` JSON-LD node, and `<address>` (if used) must not carry a street address**. E.4 has been split (§6) and the mis-worded assertion retired. The 2 `<address>` elements in `src/app/about/page.tsx` and `src/app/privacy/page.tsx` are semantically correct HTML for contact-info blocks; they contain the operator name and the single line "New Zealand" (jurisdiction, not a street), and are retained.

### 10.3 User-facing "Magic Lab administrator" copy (P2-2)

Rewrote the current-product UI copy in **9 UI/runtime source files, grouped into 7 audit bullets below** — every string a signed-in user actually sees. Full whole-repo classification pass done: 0 user-facing `Magic Lab` strings remain. Everything still greppable is one of three deliberately-retained categories, listed in §9.4 (Magic Lab Class the separate brand, the `Magic Lab` client-record name in `supabase/migrations/**` and diagnostic tests, and source-file comments).

Files changed in round 3 for this:
- `src/app/unauthorized/page.tsx` — "Contact your Magic Lab administrator." → "Contact your Magic Engine administrator."
- `src/components/auth/FeatureLockGate.tsx` — "A Magic Lab field engineer …" → "A Magic Engine field engineer …" (the `Magic Lab Class` modal reference on L147 is Magic Lab Class the separate brand — retained.)
- `src/lib/auth/client-access.ts` — "Contact Magic Lab to unlock." → "Contact Magic Engine to unlock."
- `src/app/dashboard/clients/[id]/messenger/{page.tsx,_components/ReplyBox.tsx}` — "找 Magic Lab 团队 …" → "找 Magic Engine 团队 …"
- `src/lib/messaging/adapters/messenger.ts` — same
- `src/lib/mtc/charge.ts` + `src/app/api/clients/[id]/ai-factory/fan-out/route.ts` — "联系 Magic Lab 提升配额" → "联系 Magic Engine 提升配额"
- `src/app/api/clients/[id]/assets/[assetId]/provenance/route.ts` — "素材确认必须由 Magic Lab 的人来做" → "素材确认必须由 Magic Engine 的人来做"

### 10.4 Organization `@id` for #1056 semantic overlap (P2-3)

`website/index.html` Organization node gains `"@id": "https://magicengine.com.au/#organization"` as its first field after `@type`. Existing fields (`name`, `legalName`, `founder`, `url`, `email`, `areaServed`, `contactPoint`) all retained.

**Coordination note for #1056**: this PR does not import the About-page Organization patch from #1056. When #1056 lands, its About-page `Organization` node **must use the same `@id`**. Two nodes with the same `@id` are the same identity to consumers and their properties merge naturally; two nodes without a shared `@id`, or with different `@id`s, produce two distinct canonical Organization identities in structured data — a bug. Written explicitly into the PR body.

### 10.5 Organization description aligned to canonical (P2-4)

`website/index.html` Organization `description` field is now the frozen EN canonical description verbatim, replacing the earlier product-oriented sentence. There is now **one** canonical description in structured data.

### 10.6 Compact footers unified (P2-5)

All 6 short-form footers (`ai-growth-engine.html`, `industry-solutions.html`, `local-services.html`, `real-estate.html`, `travel.html`, `cn/industry-solutions.html`) now carry the single canonical line:

`© 2026 Magic Engine AI Technology Limited · New Zealand · raydeng@magicengine.com.au`

Previously several appended "Australia & New Zealand" or "Industry solution · X · Australia & New Zealand" as a second span, which — sitting adjacent to the legal-entity name — could be read as a second registered jurisdiction. The old secondary spans (industry / market context) were pure page-audience copy and are dropped from the compact footer; the same information is expressed elsewhere on those pages (nav, hero, sitemap). CN footer carries the same fact.

### 10.7 Dead `.me-sub` CSS removed (P2-6)

`me-sub` was the class on the "by Magic Lab" logo sub-line removed in round 1. Whole-repo scan (`website/**`, `src/**`, `public/**`, all JS) confirmed **0 selector consumers** outside the CSS file itself. Two stylesheet rules removed from `website/styles.css`. Not a behavioural change; a follow-up on round 1.

### 10.8 `llms.txt` narrowed (P2-7)

The prior wording "a company registered in New Zealand" implied an external registration fact we have not verified. Rewritten to the narrower fact PM has actually frozen:

```
Magic Engine is operated by Magic Engine AI Technology Limited in New Zealand.
Magic Engine serves customers across Australia and New Zealand.
Founder: Ray Deng.
```

No NZ Company Number, NZBN, or other registration identifier added. The canonical description line below it is unchanged.

### 10.9 Why this PR touches `CLAUDE.md` and `ROADMAP.md` (P2-8)

This is an entity-facts-only PR. The two doc edits are not a functional roadmap change:

- **`CLAUDE.md`** is the project-wide instruction sheet every agent reads at session start. Leaving the old "Magic Lab 旗舰产品" phrasing there would guarantee future sessions re-introduce the wrong legal-entity claim into customer-facing outputs on their next fact-generating run. The edit re-anchors the shared fact source; it does not change any rule, workflow, or priority.
- **`docs/ROADMAP.md`** received a callout at the top preserving the historical "Magic Lab Academy / Magic Lab Class" wording and re-labelling them as `internal working name; not a registered parent entity`. No item added, removed, or reordered.

Recorded in the PR body so future window-owners see this deviation from the usual "don't touch shared docs from a feature branch" rule was intentional and scoped.

### 10.10 Round-1 §5 wording corrected (P2-9)

Round 1's E.1a table cell said the LEGAL REVIEW HTML comment was "intentionally reworded to keep grep clean". That framed the legal-review checklist as a scanner-avoidance artefact — the two gates are supposed to be independent. §5 has been rewritten to state that plainly: the stale-entity scan checks the exact old strings; the legal-review checklist is verified independently; passing one does not weaken the other. Round 3 also removes the underlying LEGAL REVIEW HTML comment (§10.1), so the coupling that provoked the mis-wording no longer exists.

## 8. Actions NOT performed (per PM directive)

- ❌ merge — this PR is Draft
- ❌ deploy to Cloudflare Pages
- ❌ any production data mutation
- ❌ any change to `research/me-phase1a-gsc-ga4-wire` branch (#1055 territory)
- ❌ any change to `website/google-tag.js`, GA4/GSC connector, snapshot pipelines, Reference Loop files
- ❌ any legal review of Terms/Privacy content
- ❌ any claim that Magic Lab is a current legal entity or parent
- ❌ any positioning-language rewrite (existing About "Who we are", Terms/Privacy legal framework — untouched)
- ❌ any change to `docs/history/CHANGELOG.md` or frozen T0 receipts (#1043 doc)
- ❌ any CN translation of the frozen EN canonical description (deferred to PM)
