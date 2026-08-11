# Apify `zen-studio/rednote-search-scraper` — B2B channel discovery experiment

**Date:** 2026-08-11
**Goal:** find Chinese B2B channel partners (travel agencies / custom trip designers / wholesalers) actively selling NZ or ANZ tour products on Xiaohongshu (小红书/RED), for an NZ inbound DMC client.
**Scope:** pure research spike using Apify MCP tools. No product code touched.

## What was run

### Step 1 — actor schema
`fetch-actor-details` on `zen-studio/rednote-search-scraper`. Keyword-search based, up to 10,000 results/keyword, no login/cookies needed, pay-per-event pricing (~$0.0055/note result + $0.05 actor-start).

### Step 2 — search run
Single `call-actor` run, 10 keywords, `maxResults=30` per keyword, `sortType=general`, `noteType=all`, `topUpFromOtherSorts=false`:

| # | keyword | 
|---|---|
| 1 | 新西兰定制游 |
| 2 | 新西兰私家团 |
| 3 | 新西兰小团 |
| 4 | 新西兰包车 |
| 5 | 新西兰亲子游 定制 |
| 6 | 新西兰蜜月 |
| 7 | 新西兰南北岛 |
| 8 | 澳新定制 |
| 9 | 澳新专线 |
| 10 | 皇后镇定制 |

- Run ID: `FRn0EnnjgBRgGz8dN`, dataset `PPAPNDNQ2G7XqeuLA`.
- Runtime 117s, compute units 0.0082 (this actor bills per-result, not per-CU — actual cost ≈ 290 results × $0.0055 + $0.05 start ≈ **$1.65**).
- Result: **290 unique notes** across the 10 keywords (some keywords like "澳新专线" and narrow queries returned few/no results — the actor's own catalogue for that term was thin, not a scraper failure).

### Step 3 — dataset pull + triage
Pulled `keyword, id, url, desc, title, type, author.*, engagement.*, tag_info, note_attributes` fields (full field list was too large — used `fields=` projection). Deduplicated 290 notes down to **218 unique authors**.

Ran a keyword-hit filter over each author's aggregate nickname+title+desc text against a business-signal wordlist (定制/包团/私家团/旅行社/地接/领队/顾问/旅行定制师/订制/签证/行程规划/咨询/等). **59 of 218 authors (27%)** hit at least one business term. Manually read all 59 to separate real sellers from noise:

- **True business/seller accounts:** ~33 (agencies, ground handlers, individual "定制师" consultants, charter drivers)
- **False positives (excluded):** personal travel-diary accounts recounting their own trip budget/itinerary that happened to mention 签证 or 定制 as something they *bought*, not sold (~18); off-topic (visa-service-only shops, home-renovation "全屋定制" accounts that share the word 定制 but sell kitchens not tours) (~8)

**Seller-vs-noise ratio, bottom line: of 290 raw notes / 218 unique authors, only ~33 (≈15% of authors, ≈11% of raw notes) were genuine NZ/ANZ-selling business accounts.** The rest were either off-topic entirely (73% of authors had zero business-keyword hit — pure scenery/itinerary/consumer content) or looked business-adjacent on a keyword match but turned out on manual read to be personal trip diaries or unrelated industries.

### Step 4 — profile enrichment
For the top 20 candidates (by clearest business signal + keyword diversity), ran `zen-studio/rednote-user-profile-scraper` with `includeNotes=false` (profile-only, cheapest mode) to pull real bio text, RED's own official business-verification flag (`red_official_verify_type` / `red_official_verify_content`), follower counts, and IP-location.

- Run ID: `AQvoujYAQIE8PRsXy`, dataset `zj49c6ZzI84Nz4JNP`.
- Cost: 20 profiles × $0.0299 + $0.05 start ≈ **$0.65**.
- **13 of 20 (65%) carried RED's own official verification tag `旅行社` (travel agency)** or `票务代理` (ticketing agent) — this is Xiaohongshu's own platform-level business account certification, not something I inferred from bio text. That's the strongest evidence tier in this dataset and is called out per-lead in `evidence[].type = "platform_verification"`.
- The other 7 are unverified but have unambiguous first-person seller bios (e.g. "深耕澳新12年的亲子旅行定制师" / "新西兰当地持证8年女司导").

Did **not** run the profile scraper on the remaining ~13 lower-priority candidates from the 33 — stopped once the target range (10–20 verified leads) was comfortably reached, to keep run cost and manual-review time bounded, per the brief's "modest per-keyword count" instruction.

## Result: 20 leads delivered

- 12 tour_operator, 4 custom_travel_designer, 2 wholesaler, 2 product_manager_individual
- 15 high NZ-intent, 5 medium (medium = multi-destination agencies where NZ is one line among several, not the account's sole focus)
- Average confidence 0.62 (range 0.4–0.8)
- **7 of 20 have a literal person name visible** (Tracy, VV, UU, 多多哥Peter, 鹏哥, kiki, Jack) — all are handles/first-names as presented in the account itself, not independently verified real names
- **0 of 20 have a phone number, email, or WeChat ID captured.** See below — this is the connector's structural limit, not a research gap.

## Honest 1–5 assessment

| Dimension | Score | Notes |
|---|---|---|
| Ease of finding real NZ-selling sellers vs noise | **2/5** | Only ~11-15% of raw hits were real sellers. Needed a manual keyword-filter + read pass over ~220 authors to get to 33 candidates — this connector surfaces mostly consumer trip-diary content, not a B2B directory. Cannot be trusted un-triaged. |
| Ease of getting company/brand name | **4/5** | Where an account is a real business it usually names itself in the nickname (e.g. "Cloudland丨云境旅行", "First Veil ·新西兰私奢旅行") — easy to extract. A few (~15%) use RED's un-edited default username ("小红薯XXXX") despite being platform-verified businesses — those need the bio/post content to identify what they actually sell. |
| Ease of finding a decision-maker/named contact | **2/5** | Most business accounts present as a brand, not a person. Individual "定制师" (custom-designer) accounts are the exception — those are literally run by one named consultant, so the account *is* the contact. But real legal names are almost never disclosed, only first names/handles. |
| Ease of finding contact info (wechat is the realistic channel) | **1/5** | Zero WeChat IDs, phone numbers, or emails appeared anywhere in the 20 profiles scraped (bio field, `user_desc_info`, tags — all checked). Xiaohongshu actively filters phone numbers and most WeChat-ID patterns out of bios and post text at the platform level; sellers instead say "咨询"/"欢迎私信" (DM me) and expect the buyer to open a private message thread. **This connector cannot get you a cold contact channel** — the only way to reach these accounts through this data is an in-platform DM, which requires a logged-in RED account and is not something this actor does. |
| Evidence quality | **4/5** | When it's there, it's strong: RED's own official verification tag is present for 13/20 leads (platform-level fact, not our inference), plus real post URLs and bio text quoted verbatim. Every lead traces to a live URL. |
| Automation potential | **3/5** | The search → dedupe → keyword-filter → profile-enrich pipeline is straightforward to script end-to-end (this whole run took under 10 minutes of tool calls). The bottleneck is the manual "is this actually a seller" read — that 85%+ noise rate means an LLM classification pass (feed title+desc+bio, ask seller-vs-tourist) is a near-mandatory step before this scales past a one-off spike; a keyword-hit filter alone is not precise enough (see false-positive rate above). |

## Bottom line risk flag for anyone using this connector going forward

**The single biggest risk is noise, not coverage.** Xiaohongshu search-by-keyword returns overwhelmingly consumer content (people who *bought* a NZ trip, not people *selling* one) — roughly 6 out of 7 raw hits. And even after narrowing to business accounts, **this connector cannot deliver a usable outreach channel** (no phone/email/WeChat ever surfaced) — every one of these 20 leads would need a manual RED-app DM to make first contact, which is a real operational cost per lead, not a one-time integration cost.
