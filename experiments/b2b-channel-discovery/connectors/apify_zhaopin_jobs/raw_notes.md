# Connector spike: `apify_zhaopin_jobs` (智联招聘 via `blackfalcondata/zhaopin-scraper`)

**Goal:** find Chinese travel agencies / tour operators / wholesalers currently hiring for an
ANZ/Oceania-specific product/OP role, as a buying-intent signal for outbound-channel-partner
discovery (client: NZ inbound DMC).

**Result: STOPPING EARLY at 1 qualifying lead.** Target was 10-20. Full rationale below.

---

## What was tried

Actor: `blackfalcondata/zhaopin-scraper` (PAY_PER_EVENT, $0.01/start + $0.002/result).
Input schema pulled via `fetch-actor-details` — key fields: `query` (free text), `cityId`
(defaults to Beijing `530` if omitted), `maxResults`, `includeDetails`.

24 actor runs total against zhaopin, across 4 cities (Beijing/no-city default=530, Shanghai=538,
Guangzhou=763, Shenzhen=765) and ~20 distinct search terms:

| Query tried | City | Items returned | Genuinely ANZ-specific? |
|---|---|---|---|
| 澳新产品经理 | Beijing | 30 | 0 — fallback to generic "产品经理" browse |
| 出境游产品经理 | Beijing | 0 | — |
| 旅游产品经理 | Beijing | 40 | 0 (13 real travel jobs, 0 mention ANZ) |
| 澳新OP | Beijing | 39 | 0 — fallback to generic city browse (security guards, warehouse jobs) |
| 新西兰旅游 | Beijing | 40 | 0 |
| 澳新 | Beijing | 2 | 0 (both 新东方 study-abroad consultant roles, wrong ICP) |
| 澳新 | Shanghai | 2 | 0 (both unrelated: accounting/materials-science roles at unrelated co named "澳新健康") |
| 新西兰 | Beijing | 16 | 0 qualifying (mostly education/migration consultants — wrong ICP) |
| 新西兰 | Shanghai | 3 | 0 qualifying (education agents) |
| 新西兰地接 | Beijing | 5 | 0 |
| 旅行社 新西兰 | Beijing | 16 | 0 — fallback |
| 计调 澳新 | Beijing | 0 | — |
| 旅游产品经理 | Shanghai | 40 | 0 (1 real travel job at absurdly low salary, no ANZ) |
| 南太平洋产品经理 | Beijing | 40 | 0 — fallback |
| 长线产品经理 | Beijing | 1 | 0 (长线游轮 = long-haul cruise, but no ANZ mention) |
| 旅游产品经理 | Guangzhou (763) | 40 | 0 (several real 广东星悦国际旅游 travel postings, none mention ANZ) |
| 旅游产品经理 | Shenzhen (765) | 40 | 0 (1 real: 深圳华侨城国际旅行社, no ANZ mention) |
| 奥克兰 (Auckland) | Beijing | 0 | — |
| 悉尼 地接 (Sydney) | Beijing | 3 | 0 — fallback to unrelated finance/OP jobs |
| 墨尔本 计调 (Melbourne) | Beijing | 33 | **1 real hit** (see below) — mostly fallback |
| 地接社 澳大利亚 | Beijing | 3 | 0 — fallback |
| 大洋洲 计调 (Oceania) | Beijing | 35 | **2 hits**, both excluded (see below) |
| 澳大利亚 新西兰 计调 (combined) | Beijing | 0 | — |

**Fallback 51job cross-check** (`getascraper/51job-scraper`, query "澳新计调", Shanghai): 30 items,
all fell back to generic Shanghai travel-industry listings (hotel sales, ticketing, cruise-line
telesales) — zero ANZ mentions. Confirms the same "keyword ignored, city browsed instead" failure
mode is not specific to this one Zhaopin actor.

**Fallback Liepin cross-check** (`getascraper/liepin-scraper`, query "旅游产品经理 澳新"): actor
run **FAILED** (0/1 requests succeeded, no diagnosable error surfaced in the run summary). Not
retried further given time budget — noting it as "tried, did not return data" per the task brief.

---

## The one qualifying lead

**众信旅游控股集团股份有限公司 (UTour Group)**, Beijing HQ (Chaoyang Park west gate), 1000-9999
employees, SZSE: 002707 — one of China's largest publicly listed outbound travel wholesalers.

Posting: **极地邮轮产品操作** (Polar Cruise Product Operations), posted 2026-08-08 (3 days before
scrape date 2026-08-11 — genuinely current/fresh).

Requirement line: *"具有3年以上出境定制单团操作经验（尤其是美洲、东南亚、澳新等国家的）优先考虑"*
— 3+ years custom-tour operations experience preferred, **especially Americas, Southeast Asia, and
ANZ (澳新)**. ANZ is one of three named preferred regions, not the job's sole focus — hence
`nz_intent: medium` and `confidence: 0.5` rather than high.

URL: http://www.zhaopin.com/jobdetail/CC135697910J40757485501.htm

## One near-miss, excluded, and why

**派客斯国际文化交流(北京)有限公司** — 旅游计调主管 (Travel Coordinator Supervisor).
Description literally states *"负责带团出访美、澳、英及欧洲其它等国家"* (leads tour groups to
USA, Australia, UK, and other European countries) — a genuine, unambiguous ANZ/Australia signal
from a real travel-industry employer.

**Excluded from leads.json** because `postedDate` = 2025-03-05, i.e. ~17 months stale relative to
today (2026-08-11). The task brief requires "a real, current job listing" as the timing/intent
signal — a listing this old is not evidence of *current* hiring activity, so including it would
weaken the whole point of using job postings as a freshness signal. Flagging it here in case the
team wants to re-check whether this company is still actively hiring via another channel (it's a
plausible outreach target on its own merits, just not via this connector's timing signal).

## Noise categories observed (for calibrating future runs)

1. **Silent keyword fallback (biggest issue).** When a multi-word or compound query (e.g. "澳新OP",
   "新西兰地接", "地接社 澳大利亚") doesn't literal-match anything, the actor does NOT return zero
   results — it silently falls back to browsing all jobs in the default city (Beijing) matching
   only a substring, or sometimes just returns generic city-wide listings unrelated to the query
   entirely (security guards, warehouse workers, sales reps). This produced the majority of "40
   items returned" results that were 100% noise. **Ratio: of ~700+ listings scanned across all
   runs, only 3 listings anywhere mentioned 澳新/新西兰/澳洲 in a travel-industry context, and only
   1 was both current and a clean ICP match — well under 1% signal.**
2. **Wrong ICP: study-abroad / migration consultants.** Queries for "澳新"/"新西兰" reliably surface
   study-abroad agencies (新东方前途出国, 启德教育, various 留学顾问 roles) and migration-law firms.
   These are real, current, ANZ-specific listings — but the hiring companies sell education/visa
   services, not NZ/AU *tours*. Excluded per the task's ICP definition.
3. **Wrong industry entirely.** "大洋洲" (Oceania) surfaced two listings at 北京天泽电力集团
   (an industrial power-equipment manufacturer) for "国际渠道经理/工程师（亚洲+大洋洲）" — genuine
   ANZ market-expansion hiring, but for electrical equipment distribution, not travel. Excluded.
4. **Company-name false positives.** Query "澳新" also matched a company literally named
   "杭州澳新健康科技有限公司" (unrelated Hangzhou health-supplements startup) purely on the
   company-name string, not job content.

---

## Self-assessment (1-5 scale)

- **Ease of finding real hiring companies with ANZ intent: 2/5.** Doable but required ~20 keyword
  variants and manual reading of full job descriptions (not just titles) to find genuine signal;
  no way to filter server-side for "mentions ANZ" — had to eyeball every description.
- **Ease of getting company name: 5/5.** Company name, size band, industry, address, and a
  `company.zhaopin.com` profile URL come back cleanly on every listing.
- **Ease of finding a decision-maker/contact: 1/5.** As expected, no email/phone anywhere. Zhaopin
  does expose a named HR contact + generic title (e.g. "贾晓菲 / 人力") on most listings — useful as
  a "who to ask for" hint, but it's an HR/recruiter, not a business decision-maker, and there's no
  email or phone attached to reach them directly.
- **Evidence quality: 4/5** for the one lead that qualified (verbatim requirement text, dated
  posting, checkable URL, verified company identity) — but that's 1 out of ~700 listings screened,
  so evidence *density* is very low even though evidence *quality* per hit is solid.
- **Automation potential: 4/5.** This is a strong, cheap, easily-re-runnable timing/intent signal
  *in principle* — job postings are a real leading indicator of a company actively building out an
  ANZ product line. The blocker isn't the signal type, it's this actor's query matching: a
  scheduled job re-running these same keyword variants weekly would likely keep finding near-zero
  new signal per run unless (a) the fallback-to-browse behavior is fixed/avoided (e.g. always
  paired with a client-side "does this description contain 澳新/新西兰/澳大利亚 AND 旅游/旅行社/计调"
  filter before counting a result as a hit), and (b) it's combined with monitoring a curated list
  of ~30-50 known China outbound wholesalers/OTAs by name (众信旅游, 凯撒旅游, 中青旅遨游, 广之旅,
  携程/Trip.com outbound BU, 康辉旅游, etc.) rather than relying on open-ended keyword search.

## Recommendation if this connector is productionized

Do NOT trust "items returned > 0" as a signal of relevance — always apply a post-fetch regex/keyword
filter on `description` for ANZ terms (澳新|新西兰|澳大利亚|Australia|New Zealand|奥克兰|悉尼|墨尔本|
布里斯班) AND travel-industry terms (旅游|旅行社|计调|地接|OP|出境) before treating a listing as a
lead — this single change would have suppressed ~99% of the noise seen in this spike.
