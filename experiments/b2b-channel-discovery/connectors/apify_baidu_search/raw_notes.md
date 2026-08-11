# apify_baidu_search — raw notes

Actor: `johnvc/Baidu-Search-Scraper` ("百度 Baidu - Cost-Effective Baidu Search Scraper"), pricing model FREE (usage-based, no rental fee shown by Apify MCP).
Params used for every query: `device=desktop`, `localization=2` (Simplified Chinese only), `num_results=20`, `max_pagination=1`.

## Queries run (15 total, all succeeded)

| # | Query | Run ID | Dataset ID | Runtime | organic_results returned |
|---|---|---|---|---|---|
| 1 | 新西兰定制游 旅行社 | nSetOqTjH0asvGV4u | RyshJGsolU8uGcdNk | 24.5s | 8 |
| 2 | 新西兰私家团 | usBxQJiGQ0LNxeYKR | mNuU0HuBgQTcDoIXi | 8.0s | 9 |
| 3 | 新西兰小团 包车 | 42CUmD2dYAs0RhUc7 | 0aukT7N2Jl7C1YjwT | 8.3s | 8 |
| 4 | 新西兰亲子游 定制 | wt81ImLDR7iYCAXwO | LT3lgf4zhAUQrI4kH | 91.1s (slow outlier) | 8 |
| 5 | 新西兰蜜月 定制 | SOv7JdvextMhZerhd | ZNkcwvgfZZSAtARAy | 9.6s | 8 |
| 6 | 新西兰高端定制游 | rHVo5qd6pzDNS3nif | x3OyWNXcVB82TkDBE | 9.4s | 9 |
| 7 | 新西兰南北岛 跟团 | peYzQlBQhhBNJTQj5 | tX6d7P0o66KxySNgt | 32.5s | 8 |
| 8 | 新西兰地接 | 5jZ0hH5at5lHUEZSU | 7jgIQUetAbf3nCds9 | 8.8s | 8 |
| 9 | 澳新定制 旅行社 | gJZ05xErMlypfZFQf | uZP9MfdpewXzCa2gr | 4.8s | 9 |
| 10 | 澳新专线 批发 | TBGMIcmuewlsfmfBj | wpBlHexpJcDefcOuW | 79.0s (slow outlier) | 9 |
| 11 | 澳新批发商 | 7oc93FEQHFlo08oAe | bCoTrUA8xf83fvdkE | 4.7s | 9 |
| 12 | 皇后镇定制游 | SLyttNh9UgNiYnSLy | iRESIrPmrOrQjd0Hp | 37.1s | 8 |
| 13 | 澳新产品经理 招聘 | 1VQoNh2HlNeQEyI9Z | AdjnuHCfi4iJzxRou | 55.2s | (weak — see below) |
| 14 | 新西兰产品经理 旅游 | dLCiTbp0g56Qojam9 | gxGhNylZB63Oye5fD | 7.5s | 9 |
| 15 | 澳新计调 | uteWbDf2CxBL5Rhek | hXaL1YcjaZjYp89zN | 4.4s | 8 |

No paid/API-key usage — actor ran with `api_key_used: false` on every call, meaning it's using Apify's own proxy/session pool rather than a customer-supplied Baidu key. No cost was surfaced in the MCP run summaries (`FREE` pricing tier).

Note: despite requesting `num_results=20`, the actor consistently returned only 8-9 organic results per query regardless of the setting — Baidu's SERP for these long-tail Chinese queries just doesn't have more than ~8-9 organic slots before falling into "相关搜索/热搜" filler. Requesting more results did not help; this is a Baidu SERP-depth ceiling, not an actor bug.

Query #13 (澳新产品经理 招聘) came back thin/off-topic (mostly unrelated NZ attraction/blog content, no fresh job listings) — 招聘 (recruitment) queries surfaced better hits when phrased as the destination + role rather than + "招聘", e.g. #14 and #15 outperformed #13.

## What worked

- **Company + "澳新定制/澳新批发/澳新计调/产品经理" style B2B queries dramatically outperformed generic "新西兰XX游" consumer-intent queries.** The first 8 queries (numbers 1-8, general NZ travel/honeymoon/family/charter terms) surfaced almost entirely **NZ-based or AU-based DMCs** (Hi Travel, Elite Vacation NZ, MNP Travel, Great North Tours, 万国旅行社, 日月光旅游/ANZ Sky Tours) — these are the client's own peers/competitors, not China-side channel partners, and had to be excluded per brief.
- Queries 9-15 (澳新定制旅行社, 澳新批发, 澳新计调, 产品经理) shifted the result mix toward genuine **China-based tour operators and wholesalers with dedicated ANZ business lines**: 树袋熊/美辰国旅 (Beijing), 丁丁旅游, 华任游旅行社 (Hangzhou), 信捷假期, 达美国际旅行社 (Beijing), 臻程国际旅行社 (Shanghai), 八大洲旅游, plus well-known public wholesalers (众信旅游, 凯撒旅游, 中青旅遨游网, 途牛) referenced in third-party "top ANZ agency" ranking/comparison blog posts.
- **Job-posting search terms (计调/产品经理/招聘) were the single best signal for finding companies with a live, staffed ANZ product line** — a company actively hiring "澳新线计调" or "新西兰方向产品经理" is unambiguous proof they sell NZ/ANZ product today, and the postings sometimes state city, salary band, and required years of ANZ experience. This is a distinct, non-obvious sourcing angle that a pure "新西兰旅游" content search would never surface.
- The New Zealand official tourism board's own trade directory page (`newzealand.com/cn/plan/business/...`) shows up in results and explicitly labels one entry as "Travel agent in 湖北, 中国" (银蕨假期) — this is about as strong third-party verification of "China-based, NZ-selling" as Baidu search can produce, short of directly crawling the NZ Trade Trade Directory itself (which would be a better dedicated source for a future connector).
- WebFetch confirmed one lead end-to-end (树袋熊/美辰国旅): live phone (400-004-5956) and email (info@ftourworld.com) both resolved on the actual site, matching the Baidu snippet exactly.

## What didn't work / limitations

- **WebFetch was blocked (403) on ~half the candidate sites** (newzealand.com/cn, tintintour.com, jobui.com hit a CAPTCHA wall). This is expected for Chinese sites with bot protection; a production pipeline would need a China-based proxy / headless browser with stealth, not a plain fetch.
- Several strong-sounding leads (信捷假期, 华任游旅行社, 众信旅游, 凯撒旅游) have **no primary-source URL** in the Baidu results at all — they only appear inside third-party "top 5/top 10 ANZ agency" ranking articles (baijiahao spam-SEO content, likely written by 信捷假期 itself as content marketing). These are flagged with lower confidence (0.3-0.4) and `missing_fields: website`. A follow-up Baidu search for the bare company name would likely resolve their own domains — that's a natural next iteration, not done here to stay within scope.
- No decision-maker names were found for any lead except one (奢游国际's founder 谭晴/Sunny, from a Baidu Baike company bio) — Baidu search snippets almost never contain a named person + title; that requires a dedicated people-search source (BOSS直聘 profile pages, LinkedIn, WeChat public account bios), which is out of scope for a pure Baidu-SERP connector.
- No phone/email/WeChat found for 13 of 16 leads — Chinese travel-agency SEO landing pages overwhelmingly gate contact info behind an on-page chat widget or a WeChat QR code image (not machine-readable text), so a search-snippet-only connector structurally under-collects contact info even when it exists on the page.
- Result set is heavily polluted by junk in `top_searches` / `related_searches` / `people_also_search_for` fields (Chinese entertainment/celebrity trending topics, totally unrelated to the query) — had to `omit` those fields on every `get-dataset-items` call to keep the payload usable. `organic_results` is the only field worth reading.
- Two runs (query #4, #10) took 79-91s to complete vs. 5-10s for the rest — no obvious pattern (not the longer/shorter query), looks like Baidu-side rate limiting or the actor's session rotation kicking in. Would need retry/backoff logic for a production cron.

## Stop condition

Did NOT stop early — all 15 planned queries completed and yielded a combined 16-lead shortlist after filtering out NZ/AU-based DMCs (which are the client's peers, explicitly excluded per brief) and pure informational/attraction pages (newzealand.com, RealNZ, aoyou-image-search links, etc).

## Self-assessment (1 = poor, 5 = excellent)

| Dimension | Score | Notes |
|---|---|---|
| Ease of finding real NZ-selling companies | 3/5 | Generic consumer-intent queries mostly surface NZ/AU-side DMCs (the wrong side of the deal). B2B-flavored queries (批发/定制旅行社/计调/产品经理) work much better but require knowing the industry jargon in advance. |
| Ease of finding company name | 4/5 | Once a B2B/hiring query hits, the company name is almost always explicit and unambiguous in the title or snippet. |
| Ease of finding a decision-maker | 1/5 | Essentially never present. Only 1 of 16 leads has any named person, and that came from a Baidu Baike company-history page, not a search snippet. Needs a dedicated people-search connector layered on top. |
| Ease of finding contact info | 2/5 | Phone/email showed up unprompted for exactly 1 of 16 leads (and only because WebFetch could reach the live site — Baidu's own snippet also happened to include the phone number). WeChat was never found; it's near-universally an image QR code, not text. |
| Evidence quality | 3/5 | Search snippets are usually detailed enough to judge NZ-selling intent (quotes claims like "澳新专线批发资质", "1年以上澳新产品经验") but ~1/3 of leads only exist inside third-party ranking-blog mentions with no primary source, so evidence quality varies a lot lead-to-lead. |
| Automation potential for a recurring pipeline | 3/5 | The query pattern (B2B/hiring terms > generic destination terms) is reusable and could be scheduled, but (a) the actor has a hard ~8-9 result/page ceiling regardless of `num_results`, (b) WebFetch enrichment fails ~50% of the time on Chinese sites without a stealth proxy, and (c) there's no decision-maker/contact enrichment step at all — this connector alone gets you a company shortlist, not a call-ready lead list. Would need to be chained with a company-name → official-site re-search step and a people-search connector to be pipeline-ready.

**Overall**: Baidu search via this actor is a solid **company discovery** layer (especially job-posting queries as an ANZ-intent signal) but a weak **contact enrichment** layer. Worth keeping in a multi-connector pipeline as the first-pass company sourcing step, not as a standalone lead generator.
