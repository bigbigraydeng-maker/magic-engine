# Publishing Notes — Karndean Flooring Brisbane (Authorised Retailer Guide)

> **For:** PM publishing this blog to oztopbuildingsupplies.com.au WordPress admin
> **Post URL target:** `/blog/where-to-buy-karndean-flooring-brisbane/`
> **Estimated WP admin time:** 25–35 minutes including image upload

---

## 1. Pre-publish quick check (2 min)

Open `blog.md` and `meta.json` side by side. Confirm:

- [ ] Phone `07 3416 6458` appears at least 5 times in blog.md (search Ctrl+F)
- [ ] String `Big Panda` does **not** appear anywhere (Ctrl+F → 0 results expected)
- [ ] String `competitive pricing` does **not** appear (Ctrl+F → 0 results expected)
- [ ] No fabricated Karndean ranges (only `LooseLay Longboard` should appear — no Korlok/Da Vinci/Van Gogh)

If any of the above fails, **stop and tell SEO Factory window** before publishing.

---

## 2. WordPress admin steps

### A. Create the post

1. WP admin → **Posts → Add New**
2. Title: `Where to Buy Karndean Flooring in Brisbane: Your Authorised Retailer Guide`
3. Permalink slug (set after title is typed): `where-to-buy-karndean-flooring-brisbane`
4. Paste body from `blog.md` (everything below the H1 line — WP uses the post title as H1 automatically, so do **not** paste the `# Where to Buy...` line twice)
5. Confirm WordPress converts `## H2` headings to proper `<h2>` blocks. If using Gutenberg, each H2 should land in its own Heading block. If using Classic Editor, switch to Text/HTML tab and verify `<h2>` tags rendered correctly.

### B. Yoast SEO fields

In the Yoast meta box below the editor:

| Yoast field | Value |
|-------------|-------|
| **Focus keyphrase** | `Karndean flooring Brisbane` |
| **SEO title** | `Where to Buy Karndean Flooring in Brisbane \| Oztop Authorised` |
| **Slug** | `where-to-buy-karndean-flooring-brisbane` |
| **Meta description** | `Authorised Karndean retailer in Brisbane. Visit our Slacks Creek showroom or call 07 3416 6458 for same-day quote. Servicing 100km radius.` |
| **Cornerstone content** | ON (this is a high-value local retailer guide we want crawled often) |
| **Social → Facebook image** | Upload hero image (see image plan below) — 1200×630 |
| **Social → Facebook title** | `Where to Buy Karndean Flooring in Brisbane \| Oztop` |
| **Social → Facebook description** | `Authorised Karndean retailer in Slacks Creek. See real LooseLay Longboard planks in person. Same-day quote. Call 07 3416 6458.` |

**Expected Yoast traffic-light:** Green for SEO (focus keyphrase appears in title, slug, first paragraph, multiple H2s, meta desc as semantic match) and Green for Readability (sentences short, lots of headings, lists).

If Yoast flags "keyphrase density too low" — ignore, the keyphrase is in 10 places organically; Yoast over-counts very short keyphrases.

### C. Categories & tags

- **Category:** `Buying Guides` (create if missing — or use existing "Flooring Guides" / "Blog" parent)
- **Tags:** `Karndean`, `Vinyl Flooring`, `Brisbane`, `LooseLay Longboard`, `Authorised Retailer`, `Showroom`

### D. Featured image

Upload **1 hero image** to the post featured image slot:
- **Filename:** `karndean-looselay-brisbane-install.jpg`
- **Dimensions:** 1200×630 (Open Graph friendly) or larger 1920×1080 cropped to 1200×630 for featured
- **Alt text:** `Karndean LooseLay Longboard installed in a Brisbane home — Oztop authorised retailer`
- **Source guidance:** Use a real Oztop completed-install project photo from `/projects/`. **Do NOT use Karndean stock marketing photos** — the Oztop_MasterBrief brand red-line forbids stock smile photos and over-filtered effect shots. Real install photo from a Brisbane home is mandatory.

If no suitable hero photo exists in projects archive, **flag to PM** and use a tight close-up of LooseLay Longboard plank texture from the Slacks Creek showroom (natural light, no filter) as a temporary hero. Hero image can be swapped post-publish without losing SEO equity.

### E. In-body images (optional but recommended)

Add 2–3 in-body images at these positions if available:

| Position | Image idea | Alt text |
|----------|-----------|----------|
| After "Oztop's Karndean range in stock" intro | Photo of LooseLay Longboard sample boards laid out at the Slacks Creek showroom | `Karndean LooseLay Longboard sample boards at Oztop Slacks Creek showroom` |
| Inside "Visit our Slacks Creek showroom" | Photo of the showroom exterior or interior with flooring displays | `Oztop Building Supplies showroom at 5 Judds Ct Slacks Creek` |
| Inside "Installation: licensed and insured" | Photo of installer prepping subfloor or laying a Karndean plank (real job) | `Licensed Oztop installer fitting Karndean LooseLay Longboard in a Brisbane home` |

All in-body images: filename in kebab-case, alt text descriptive and includes "Karndean" or "Oztop" + location/context.

---

## 3. Internal links (set during paste, not after)

The blog has 4 internal links already embedded as markdown `[anchor](/url)`. After paste, manually verify each is a clickable internal link in WP editor:

| Anchor text in body | Target URL | Verify by |
|--------------------|-----------|-----------|
| `Karndean range` | `/brand/karndean/` | Click in preview → should land on brand page |
| `vinyl flooring category` | `/product-category/flooring/vinyl-flooring/` | Click in preview |
| `SPC and hybrid range` | `/product-category/flooring/spc-wpc-hybrid-flooring/` | Click in preview |
| `engineered timber options` | `/product-category/flooring/engineered-timber-flooring/` | Click in preview |

All links should open in the **same tab** (default) — internal links open same-tab per WP best practice. Do NOT set `target="_blank"` on any of these.

---

## 4. Schema JSON-LD injection

The `meta.json` file contains **two schema blocks**: `article_schema` and `faq_schema`. WordPress + Yoast handle the Article schema automatically once you fill Yoast fields. The **FAQPage schema is the one that needs manual injection** — it's what drives the rich-result FAQ accordion in Google SERPs.

### Option A — if Yoast Premium is installed
Use the Yoast FAQ block in the editor:
1. At the position of the `## Frequently asked questions` H2, insert a Yoast FAQ block
2. Add each Q/A pair (5 total) from the FAQ section
3. Yoast auto-generates `FAQPage` JSON-LD

### Option B — if Yoast free or no plugin

Copy the `faq_schema` JSON object from `meta.json`, wrap it in a `<script>` tag, and inject via a Custom HTML block at the **end** of the post body:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { ... copy 5 Q&A objects from meta.json faq_schema.mainEntity ... }
  ]
}
</script>
```

After publishing, test with **Google Rich Results Test** (https://search.google.com/test/rich-results) by pasting the published URL — should report 1 valid Article + 1 valid FAQPage with 5 questions.

---

## 5. Publish + immediate post-publish actions

### Publish settings
- **Visibility:** Public
- **Status:** Publish (not Draft)
- **Publish date:** today (2026-06-09) — keep as-is, don't backdate

### Immediately after Publish hits
Within 10 minutes:

1. **Open the live URL** in incognito → verify:
   - H1 displays the full title
   - Featured image loads
   - All 4 internal links work
   - Phone number `07 3416 6458` displays correctly
   - No raw markdown (no stray `**` or `##` symbols)

2. **Google Search Console → URL Inspection**:
   - Paste live URL: `https://oztopbuildingsupplies.com.au/blog/where-to-buy-karndean-flooring-brisbane/`
   - Click **Request indexing**
   - Google usually crawls within 1–3 days for an active site; cornerstone content sometimes within hours

3. **Bing Webmaster Tools → URL Submission**:
   - Paste the same URL → Submit
   - Bing/ChatGPT search index pulls from Bing, so this matters for AI visibility

4. **Rich Results Test**:
   - https://search.google.com/test/rich-results
   - Paste live URL → confirm Article + FAQPage both valid

5. **Internal sharing**:
   - Add post URL to the Oztop FB page (organic post, no boost needed — see social plan below)
   - DM the URL to the FDE working the Karndean enquiries pipeline so they can reply to leads with it

---

## 6. Tracking & 8-week ranking check

Set a calendar reminder for **2026-08-04 (8 weeks out)**:

- [ ] Check `Karndean flooring Brisbane` ranking in `google.com.au` (use incognito + Australia VPN if checking from NZ)
- [ ] Target: Top 20 (per SEO Factory brief)
- [ ] Pull GSC clicks/impressions/position for the URL
- [ ] If ranking is stuck >50 after 6 weeks: review featured image, internal links from related pages, and consider 1 backlink push from Karndean's "find a retailer" directory if available

Magic Engine's `keyword-snapshots-weekly` cron will automatically track this keyword going forward — verify it's in CTS/Oztop's tracked keyword list in the ME admin panel. If not, add it.

---

## 7. Social re-purposing (optional, FDE can handle)

After publish, generate 1 FB post + 1 IG carousel from the blog content:

- **FB post:** Pull the "Why buy Karndean from an authorised Brisbane retailer" 3-point summary → write 80-word FB caption + link to the blog
- **IG carousel:** 5 slides — slide 1 hook ("Looking for Karndean in Brisbane?"), slides 2–4 the 3 benefits of buying local, slide 5 CTA with showroom address + phone

Both should be queued in Publer for next Tuesday or Thursday morning publishing.

---

## 8. Files in this folder

```
2026-06-09-karndean-flooring-brisbane/
├── blog.md                # Full article markdown (1620 words)
├── meta.json              # All SEO metadata + schema + compliance check
└── publishing-notes.md    # This file
```

PM: when this post is live, reply in the SEO Factory window with the live URL and the date/time of publish so SEO Factory can log it to the Oztop content tracker.
