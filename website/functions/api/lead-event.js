const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'entry_offer',
  'entry_page',
  'referrer',
];

function normaliseString(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function normaliseAttribution(input) {
  if (!input || typeof input !== 'object') return null;

  const out = {};
  ATTRIBUTION_KEYS.forEach(key => {
    const value = normaliseString(input[key], 300);
    if (value) out[key] = value;
  });

  return Object.keys(out).length > 0 ? out : null;
}

async function insertLeadEvent(env, payload) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return false;

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/website_lead_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return true;

  const text = await res.text().catch(() => '');
  console.error('lead-event insert failed:', res.status, text);
  return false;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const ctaKey = normaliseString(body.ctaKey, 120);
    const destination = normaliseString(body.destination || 'page', 80);
    const href = normaliseString(body.href || `${request.url}`, 1000);
    const pagePath = normaliseString(body.pagePath || '/', 300) || '/';
    const attribution = normaliseAttribution(body.metadata?.attribution || body.attribution);
    const referrer = normaliseString(body.referrer || attribution?.referrer || request.headers.get('referer') || '', 1000) || null;
    const metadata = body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {};

    if (!ctaKey || !destination || !href) {
      return new Response(JSON.stringify({ error: 'Missing tracking fields.' }), {
        status: 400,
        headers,
      });
    }

    if (metadata.attribution) delete metadata.attribution;

    const tracked = await insertLeadEvent(env, {
      page_path: pagePath,
      cta_key: ctaKey,
      destination,
      target_href: href,
      source: normaliseString(body.source || attribution?.entry_page || attribution?.utm_source || 'website', 120) || 'website',
      referrer,
      metadata: {
        ...metadata,
        attribution,
        user_agent: request.headers.get('user-agent'),
        origin: request.headers.get('origin'),
      },
    });

    return new Response(JSON.stringify({ ok: true, tracked }), {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('lead-event fatal error:', error);
    return new Response(JSON.stringify({ error: 'Tracking failed.' }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
