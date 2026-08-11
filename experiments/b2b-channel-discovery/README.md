# B2B Channel Growth Discovery Spike — China → NZ/ANZ Travel Trade

Spike for a future `b2b_channel_growth` Domain Module. Goal: test which public data
connectors can reliably surface **Chinese B2B travel-trade leads actively selling
New Zealand / ANZ product** (not tourists, not bloggers, not NZ-side competitors).

Not production code. No new module was built. See the final chat response (or
`/output/final_report.md` if exported) for the full A–F writeup.

## Structure

```
connectors/<connector_name>/leads.json     — raw normalized output per connector (58 records total)
connectors/<connector_name>/raw_notes.md   — what was tried, what worked/didn't, honest 1-5 self-ratings
normalize/master_leads.json                — cross-connector deduped + centrally scored Top 20
```

## Connectors tested (5)

| connector_used | tool | leads.json count |
|---|---|---|
| `websearch` | built-in WebSearch | 14 |
| `apify_baidu_search` | Apify `johnvc/Baidu-Search-Scraper` | 16 |
| `apify_xiaohongshu_search` | Apify `zen-studio/rednote-search-scraper` (+ `rednote-user-profile-scraper` for top candidates) | 20 |
| `apify_zhaopin_jobs` | Apify `blackfalcondata/zhaopin-scraper` | 1 (stopped early — see raw_notes.md) |
| `apify_linkedin_harvestapi` | Apify `harvestapi/linkedin-profile-search` + `linkedin-company-search` | 8 |

**Not tested / unavailable**: Ctrip/携程, 飞猪/Fliggy, 去哪儿/Qunar (Apify Store has only
hotel-review actors for these, not B2B-relevant), BOSS直聘/企查查/天眼查 (no Apify actor
exists), Apollo (`plugin:apollo` — not authenticated this session).

## Entity resolution

58 raw records → deduped to distinct companies where the same account surfaced across
connectors (e.g. 众信旅游/UTour appeared in all 5 connectors under different sub-brands/
people — merged into one canonical record with the strongest evidence from each source).
See `normalize/master_leads.json` for the merged, scored Top 20.

## Scoring

Central rubric applied uniformly across all connectors (per spike brief §VIII): NZ Intent
(40) + B2B Value (30) + Contactability (20) + Timing (10), minus deductions for stale/weak
evidence. Applied by hand in `normalize/master_leads.json` (`lead_score`, `lead_grade`,
`score_reason` fields) rather than by each collection agent, to keep scoring consistent
across sources.
