/**
 * Domain blacklist for SERP brand extraction.
 *
 * Hosts in this list are NOT brands — they are aggregators, review sites,
 * media outlets, government portals, SaaS-hosted multi-tenant domains.
 * They must be dropped before/after domain normalisation to avoid
 * polluting `brands_mentioned` with "tripadvisor" / "myshopify" / etc.
 *
 * Match rule: `host.endsWith(entry)` after stripping the leading "www.".
 * That way "amp.tripadvisor.com" still matches "tripadvisor.com".
 *
 * Keep this list narrow — only true negatives. False positives here mean a
 * real client brand silently disappears from snapshots.
 */

export const AGGREGATOR_BLACKLIST: readonly string[] = [
  // ─── Travel review aggregators ─────────────────────────────────────────
  'tripadvisor.com',
  'tripadvisor.co.nz',
  'tripadvisor.com.au',
  'expedia.com',
  'expedia.co.nz',
  'booking.com',
  'trivago.com',
  'yelp.com',
  'yelp.co.nz',
  'opentable.com',

  // ─── General Q&A / forum / social ─────────────────────────────────────
  'reddit.com',
  'quora.com',
  'stackoverflow.com',
  'wikipedia.org',
  'medium.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'twitter.com',
  'x.com',
  'youtube.com',

  // ─── Search engines / portals ─────────────────────────────────────────
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'msn.com',

  // ─── Government / tourism boards (NZ/AU) ──────────────────────────────
  'newzealand.com',           // Tourism NZ
  'tourism.australia.com',
  'australia.com',
  'immigration.govt.nz',
  'homeaffairs.gov.au',
  'govt.nz',
  'gov.au',

  // ─── Multi-tenant SaaS hosts (NOT brands) ────────────────────────────
  'myshopify.com',
  'wixsite.com',
  'wix.com',
  'squarespace.com',
  'webflow.io',
  'wordpress.com',
  'blogspot.com',
  'tumblr.com',
  'github.io',
  'netlify.app',
  'vercel.app',
  'azurewebsites.net',
  'herokuapp.com',
  'glitch.me',

  // ─── Real estate aggregators (NZ/AU) ─────────────────────────────────
  'realestate.co.nz',
  'realestate.com.au',
  'trademe.co.nz',
  'oneroof.co.nz',
  'homes.co.nz',
  'domain.com.au',

  // ─── Restaurant / food aggregators ───────────────────────────────────
  'ubereats.com',
  'doordash.com',
  'menulog.co.nz',
  'menulog.com.au',
  'zomato.com',

  // ─── AU/NZ news / media (魏征 Hotfix-3) ─────────────────────────────
  // SERP often returns "10 Best X" listicles from these — they would
  // otherwise surface as fake brands "News" / "Stuff" / "Nzherald" / "Smh".
  'news.com.au',
  'theaustralian.com.au',
  '9news.com.au',
  '7news.com.au',
  'abc.net.au',
  'smh.com.au',
  'theage.com.au',
  'stuff.co.nz',
  'nzherald.co.nz',
  'rnz.co.nz',
  'newshub.co.nz',
  '1news.co.nz',

  // ─── AU/NZ classifieds / marketplaces (NOT brand operators) ─────────
  'carsales.com.au',
  'carsguide.com.au',
  'drive.com.au',
  'seek.com.au',
  'seek.co.nz',
  'indeed.com',
  'gumtree.com.au',
  'gumtree.co.nz',
  'allhomes.com.au',
]

/**
 * True if `host` (already lowercased, www-stripped) is in the blacklist.
 */
export function isAggregatorHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^www\./, '')
  return AGGREGATOR_BLACKLIST.some(entry => lower === entry || lower.endsWith('.' + entry))
}
