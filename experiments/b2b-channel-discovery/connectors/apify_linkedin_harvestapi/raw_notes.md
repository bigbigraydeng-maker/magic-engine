# Apify `harvestapi/linkedin-*` connector — raw run notes

Date: 2026-08-10 (research spike, no product code touched)
Actors: `harvestapi/linkedin-profile-search` (Short mode, no email lookup) and `harvestapi/linkedin-company-search` (full mode). Both are "no cookies needed" LinkedIn scrapers on Apify.

## What I ran

### Profile search (`harvestapi/linkedin-profile-search`)

| # | Input | Result |
|---|---|---|
| 1 | `searchQuery="New Zealand Product Manager travel"`, `locations=["China"]`, max 25 | 25 of 346 total matches. Mostly noise (payments, MICE, aviation, general BD roles located in China but not ANZ-product-specific). Found: Alfred Li (ex-Tourism NZ), Kaiying Roxy Zhou (Trip.com Oceania), Xiaoying Xu (Tourism NZ China office — excluded, it's the NZ government board's own China office, not a Chinese travel company). |
| 2 | `currentJobTitles=["Australia New Zealand Product Manager","Oceania Product Manager","New Zealand Destination Specialist","出境游产品经理"]`, `locations=["China"]`, max 25 | Only 2 hits, both false positives: "Product Manager - Oceania" at a logistics/last-mile courier company, and "Regional Sales Manager (Oceania & Eastern Europe)" at a medical-device maker. English-language exact job-title filters basically don't work for this vertical — Chinese travel-agency job titles are almost never written in English on LinkedIn. |
| 3 | `searchQuery="澳新产品经理 旅游"`, `locations=["China"]`, max 25 | 25 of 213 total. Much better signal-to-noise: several real "澳新部经理" (Australia-NZ Dept Manager) titles at named Chinese travel agencies, mixed in with unrelated "产品经理" (generic Product Manager, any industry) noise. |
| 4 | `currentJobTitles=["澳新产品经理","新西兰产品经理","澳新部经理","澳新旅游产品经理"]`, `locations=["China"]`, max 25 | **9 of 9 total — the best single query of the run.** Exact-match Chinese job-title filtering works well once you use the real Chinese department name ("澳新部"/"ANZ Department") instead of an English translation. 5 of 9 were genuine travel-agency ANZ roles (Lvmama, Zhongshang, Beijing Zhongxin/UTS, Guolv Huanqiu Shanghai, CTS Head Office); 3 were the same "澳新部经理" title but at **study-abroad/education consultancies** (澳际教育 / AoJi Education) rather than tour operators — excluded from leads.json per the "no travel selling" exclusion; 1 was a fire-alarm-equipment "NZ Sales Manager" — excluded (wrong industry entirely, same geography keyword). |
| 5 | `currentJobTitles=["大洋洲部经理","大洋洲产品经理","新西兰部经理","澳新部商品经理"]`, `locations=["China"]`, max 25 | 0 hits — these department-name variants aren't used on LinkedIn by anyone in this sample. |
| 6 | `currentJobTitles=["南太平洋部经理","新西兰地接经理","澳新部总监","澳新产品总监"]`, `locations=["China"]`, max 25 | 1 hit — a New Oriental (新东方) study-abroad "Beijing ANZ Project Dept Director" — education again, excluded. |
| 7 | `searchQuery="新西兰跟团游 定制游"`, `locations=["China"]`, max 25 | 0 hits. |

### Company search (`harvestapi/linkedin-company-search`)

| # | Input | Result |
|---|---|---|
| 1 | `searchQuery="outbound travel New Zealand Australia tour operator"`, `locations=["China"]` | **0 hits.** Combining a `searchQuery` with `locations` on this actor seems to over-constrain — repeatedly returned 0 even for queries that clearly have real matches (confirmed below). |
| 2 | `searchQuery="澳新旅游 新西兰旅游 wholesale travel"`, `locations=["China"]` | 0 hits, same pattern. |
| 3 | `searchQuery="New Zealand outbound travel wholesaler"`, **no locations filter** | 23 hits, but the actor's own "China" location filter appears unreliable — the 23 results were wholesalers/DMCs from India, Pakistan, Indonesia, Sri Lanka, Egypt, plus one NZ-based inbound wholesaler and a US-based "Chinese-source market" specialist (JBS Hotels, Arcadia CA — serves the China market but is not itself China-based, so excluded). **None were both China-headquartered and NZ-specific** — this free-text query mostly surfaces the English-speaking global wholesaler community, which isn't where Chinese outbound agencies list themselves. |
| 4 | `searchQuery="驴妈妈旅游"` (a known Chinese OTA name), no locations | 1 hit — confirms this actor works fine on exact Chinese company names without the `locations` param. |
| 5 | `searchQuery="跟团游 新西兰"`, `locations=["China"]` | 0 hits — reconfirms `locations` + Chinese free-text query returns empty even when matches likely exist. |
| 6 | `searchQuery="国旅环球(北京)国际旅行社上海分公司"` (exact name found via a profile hit), no locations | 1 hit — confirmed a real, active China-based travel-agency branch page. |
| 7 | `searchQuery="China Travel Service Head Office"` , no locations | 2 hits, one of which (ctsho.com, Beijing, "Leisure, Travel & Tourism" industry) matched the "中旅总社" employer named in a profile hit. |
| 8 | A few more exact-name lookups ("众信旅游", "中旅总社", "国旅环球") | Mostly 0 — the actor's fuzzy matching wants closer-to-exact strings; abbreviated/colloquial Chinese company names (as opposed to the full registered legal name) frequently miss. |

**Bottom line on the company-search actor**: applying the `locations` filter alongside any `searchQuery` reliably returned 0 items in this session, whether the query was English or Chinese — this looks like an actor-side bug or an undocumented incompatibility, not scarcity of real companies. Dropping `locations` and instead reading `locations.parsed.country` from full-mode results (or cross-referencing a specific company name discovered via a profile hit) was the only workflow that produced usable output.

## Yield summary

- Total distinct people/company records pulled across all runs: ~140 (most from the two 25-result general queries).
- **Real, mainland-China-based, ANZ/NZ-specific leads that survived verification: 8** (in leads.json) — 6 high-confidence named individuals at genuine outbound tour operators/OTAs (Lvmama, 中商国际旅行社, 北京众信/UTS, 国旅环球上海分公司, 中旅总社/CTS, Trip.com), 1 medium-confidence individual at a campervan-niche agency, and 1 lower-confidence "adjacent connector" (ex-Tourism New Zealand staffer now at a China-based tourism-marketing consultancy, not himself a channel partner).
- Noise categories that ate most of the 140: (a) same job title, completely unrelated industry — "Product Manager - Oceania" at a parcel-logistics company, "NZ Sales Manager" at a fire-alarm company, medical-device "Oceania" sales; (b) generic "产品经理" with zero geography signal; (c) study-abroad/education consultancies using the identical "澳新部" department-name convention as travel agencies (澳际教育, New Oriental) — genuinely hard to tell apart from a job title alone, only the company name disambiguates; (d) Tourism New Zealand's own China-office staff — a foreign destination-marketing org, not a Chinese travel company, so out of scope even though extremely NZ-relevant.
- This is NOT a case of LinkedIn being empty for this vertical — once the query used the actual Chinese departmental job title ("澳新部经理" / ANZ Department Manager), a real and identifiable cluster of named decision-makers at recognizable Chinese travel agencies (including one NYSE-adjacent-scale player, UTS, and the state-linked CTS group) surfaced immediately. The scarcity was in *guessing the right Chinese phrase*, not in LinkedIn's coverage of the segment. I stopped at 8 rather than padding to 20 because further pagination on the working query (#4 above) was already exhausted (9 of 9 total results returned) and adjacent English-language or department-name variants (queries 2, 5, 6, 7) returned essentially nothing new — continuing would mean lowering the bar to include education agencies or geography-only false positives, which the brief explicitly asks to exclude.

## Self-assessment (1–5, 5 = easy/great)

- **Ease of finding real NZ-selling Chinese companies**: 3/5. Company-search actor's `locations` filter appears broken when combined with a query; had to reverse-engineer company identity from profile hits instead (i.e., people-search was the actual company-discovery mechanism, not company-search).
- **Ease of getting a clean company name**: 4/5. Once a company was identified, `linkedin-company-search` on the exact Chinese legal name reliably returned a clean, checkable company page (address, employee count, industry, sometimes website).
- **Ease of finding a named decision-maker**: 5/5 — this was LinkedIn's clear strength. The single best query returned 9/9 exact matches, 6 of which were directly usable named individuals with explicit "Australia-New Zealand Department" titles at real Chinese travel agencies.
- **Ease of finding contact info (email/phone/WeChat)**: 1/5, exactly as expected going in. Every single profile returned zero email, zero phone, zero WeChat — Short mode doesn't fetch it and "Full + email search" mode wasn't tried this session (it triggers an external SMTP-verification step per the actor's README, out of scope for a first pass). All 8 leads have `phone`/`email`/`wechat` as `""` and flagged in `missing_fields`.
- **Evidence quality**: 4/5. Job titles and tenure came directly from LinkedIn's structured `currentPositions` field, and several profiles had rich self-written Chinese-language summaries that explicitly named "澳大利亚、新西兰" or gave self-assigned credentials like "新西兰金牌旅游专家" (NZ Gold-Medal Travel Expert) — strong, quotable, checkable evidence, not inference.
- **Automation potential**: 4/5 for the profile-search half of the pipeline (Chinese job-title dictionary → `currentJobTitles` filter → China location filter is a clean, repeatable, cheap query pattern — sub-10-second runs, free-tier actor). 2/5 for the company-search half until the `locations`-filter issue is understood or worked around; as a fallback, company identity can always be back-filled from the `currentPositions.companyLinkedinUrl` / `companyId` already present in profile-search results, which is what this run ended up doing.

## Known gaps / next steps if this connector goes into production

1. Build out a proper Chinese job-title dictionary for this vertical (澳新部经理/总监/产品经理/直客产品经理/地接经理, plus 南太平洋/大洋洲 variants) and run it as a matrix rather than ad hoc guesses.
2. File/investigate the `locations` + `searchQuery` combination on `linkedin-company-search` before relying on it — in this session it was 0/6 with the filter present and 3/3 without it.
3. Decide the product's stance on "adjacent connectors" (like the ex-Tourism-NZ contact) — valuable for warm intros but not a direct channel-partner account; the schema's `account_type` enum doesn't have a clean bucket for this and I used `"other"` plus a note in `missing_fields`.
4. Try `profileScraperMode: "Full"` (not attempted this session, Short mode was used throughout for speed/cost) to see if fuller profile data ever surfaces an email or a personal website — still won't get phone/WeChat, which practically never appear on LinkedIn regardless of mode.
