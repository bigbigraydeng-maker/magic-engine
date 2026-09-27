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

// Map our internal marketing events to Meta Pixel standard events for CAPI.
// Keep in sync with src/lib/marketing/events.ts (Next.js layer) and the
// mapping described in docs/sop/client-tracking-onboarding.md §5.
const META_PIXEL_EVENT = {
  contact_submit: 'Lead',
  discover_submit: 'CompleteRegistration',
  qualified_lead: 'Lead',
  ads_primary_cta_click: 'InitiateCheckout',
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Server-side Meta Conversions API upload.
 * Runs alongside the existing Supabase insert, not instead of it. Silent no-op
 * when either the ctaKey is not mapped to a Meta event, or the CAPI env vars
 * are missing (keeps the endpoint working in local/preview without secrets).
 * Uses the same eventID as the client-side fbq call so Meta dedupes; expects
 * the caller to pass body.eventID — the Next.js helper (lead-conversion.ts
 * pattern) already generates and forwards it.
 */
async function sendMetaCapiEvent(env, ctaKey, body, request) {
  const metaEventName = META_PIXEL_EVENT[ctaKey];
  if (!metaEventName) return { skipped: 'unmapped-event' };
  if (!env.META_PIXEL_ID || !env.META_CAPI_ACCESS_TOKEN) {
    return { skipped: 'missing-config' };
  }

  const eventId = normaliseString(body.eventID || body.event_id || '', 200) ||
    (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  const userData = {
    client_ip_address:
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      undefined,
    client_user_agent: request.headers.get('user-agent') || undefined,
  };
  // PII must be SHA-256 hashed before send — Meta rejects plaintext.
  if (typeof body.email === 'string' && body.email.trim()) {
    userData.em = [await sha256Hex(body.email.trim().toLowerCase())];
  }
  if (typeof body.phone === 'string' && body.phone.trim()) {
    userData.ph = [await sha256Hex(body.phone.replace(/\D/g, ''))];
  }

  const capiPayload = {
    data: [
      {
        event_name: metaEventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: normaliseString(
          body.href || request.headers.get('referer') || '',
          1000,
        ) || undefined,
        user_data: userData,
        custom_data: {
          value: typeof body.value === 'number' ? body.value : 1,
          currency: normaliseString(body.currency, 8) || 'NZD',
        },
      },
    ],
    access_token: env.META_CAPI_ACCESS_TOKEN,
  };
  // In development / QA set META_CAPI_TEST_EVENT_CODE=TEST12345 to route
  // events into the Test Events tab instead of production; remove for live.
  if (env.META_CAPI_TEST_EVENT_CODE) {
    capiPayload.test_event_code = env.META_CAPI_TEST_EVENT_CODE;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${env.META_PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capiPayload),
      },
    );
    if (res.ok) return { sent: true, eventId, metaEventName };
    const errText = await res.text().catch(() => '');
    console.error('CAPI upload failed:', res.status, errText);
    return { sent: false, status: res.status, error: errText.slice(0, 200) };
  } catch (err) {
    console.error('CAPI upload threw:', err);
    return { sent: false, error: String(err).slice(0, 200) };
  }
}

const RESERVED_CTA_KEYS = new Set(['tool_signup']);

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

    // Server-written funnel events (the app records a Tools Lab sign-up only after a verified session).
    // The public endpoint must not accept them, or anyone could post fake sign-ups.
    if (RESERVED_CTA_KEYS.has(ctaKey)) {
      return new Response(JSON.stringify({ error: 'Reserved event.' }), { status: 400, headers });
    }

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

    // Meta Conversions API — server-side fallback for the client-side Pixel.
    // Fires only for events mapped to a Meta standard event (Lead, etc.).
    // Independent of the Supabase insert above: CAPI can succeed even if
    // Supabase is unreachable, and vice versa. See docs/sop/client-tracking-onboarding.md §5.
    const capi = await sendMetaCapiEvent(env, ctaKey, body, request);

    return new Response(JSON.stringify({ ok: true, tracked, capi }), {
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
