/* Retired 2026-09-27: the free website check moved into the app (it holds the database and AI keys).
   The site now calls https://app.magicengine.com.au/api/public/site-check/report directly.
   Kept as a 410 so cached old pages get a clear answer instead of a 404. */

const HEADERS = { 'Access-Control-Allow-Origin': 'https://magicengine.com.au', 'Content-Type': 'application/json' };

export async function onRequestPost() {
  return new Response(JSON.stringify({ error: 'moved', code: 'unavailable' }), { status: 410, headers: HEADERS });
}
