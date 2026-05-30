/* POST /api/scout
   Receives: { url: string, noWebsite?: { what, where, who } }
   Returns:  { leadId, market, teaser, totalCount, summary, topOpportunity }
*/

const LOCALES = {
  AU: {
    name: 'Australia', fyEnd: '30 June', gst: '10%',
    platforms: ['Gumtree', 'Facebook Marketplace', 'Seek', 'Google Maps', 'Yellow Pages'],
    moments: ['EOFY (30 Jun)', 'Australia Day', 'ANZAC Day', 'Melbourne Cup', 'Christmas in July'],
  },
  NZ: {
    name: 'New Zealand', fyEnd: '31 March', gst: '15%',
    platforms: ['TradeMe', 'Facebook Marketplace', 'Seek', 'Google Maps', 'Neighbourly'],
    moments: ['EOFY (31 Mar)', 'Waitangi Day', 'ANZAC Day', 'Matariki', 'NZ Christmas summer'],
  },
};

function detectMarket(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h.endsWith('.nz') || h.includes('.co.nz')) return 'NZ';
  return 'AU';
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(locale, pageText, hostname) {
  return `You are 张骞, a local business reconnaissance analyst for ${locale.name}.

Analyse the business from its homepage. Be specific and locally accurate.

Locale rules:
- Market: ${locale.name}
- Financial year ends: ${locale.fyEnd} (CRITICAL: use this, not another country's date)
- GST rate: ${locale.gst}
- Key local platforms: ${locale.platforms.join(', ')}
- Key local seasonal moments: ${locale.moments.join(', ')}
- Use AU/NZ English spelling (colour, optimise, analyse, etc.)

Business domain: ${hostname || 'unknown'}
Homepage text (first 8000 chars):
---
${pageText}
---

Return ONLY valid JSON, no markdown, no explanation:
{
  "summary": "2-sentence honest summary of business digital visibility",
  "market": "${locale.name === 'Australia' ? 'AU' : 'NZ'}",
  "findings": [
    {
      "severity": "NOW|GAP|GOOD",
      "title": "short title (max 8 words)",
      "desc": "specific observation with local context (2-3 sentences)",
      "fix": "concrete actionable recommendation"
    }
  ],
  "top_opportunity": {
    "title": "headline opportunity",
    "draft_cta": "CTA button text"
  }
}

Rules:
- 5–7 findings, ordered priority (NOW first, then GAP, then GOOD)
- At least one finding references ${locale.name}-specific context (${locale.fyEnd} EOFY, GST ${locale.gst}, or local platforms)
- Do NOT invent facts not supported by homepage; note uncertainty in desc
- severity NOW = urgent issue harming them today; GAP = missed opportunity; GOOD = strength to build on`;
}

function getDemoFindings(market) {
  return {
    summary: 'We could not fetch the homepage — here is a general analysis based on common patterns.',
    market,
    findings: [
      {
        severity: 'NOW',
        title: 'Not appearing in AI assistant answers',
        desc: `When customers ask ChatGPT or Google's AI Overview for services like yours in ${market === 'NZ' ? 'New Zealand' : 'Australia'}, businesses with structured content appear. Without it, you're invisible at the moment of intent.`,
        fix: 'Add FAQ content and structured data so AI assistants can cite your business.',
      },
      {
        severity: 'GAP',
        title: `${market === 'NZ' ? 'EOFY (31 March NZ)' : 'EOFY (30 June AU)'} window approaching`,
        desc: `End-of-financial-year is a peak buying period. Businesses that build visibility before the ${market === 'NZ' ? 'March' : 'June'} deadline capture a disproportionate share of decision-ready customers.`,
        fix: 'Start EOFY content and ad campaigns at least 6 weeks before the financial year ends.',
      },
      {
        severity: 'GAP',
        title: 'Google Business Profile incomplete',
        desc: "'Near me' and local searches are the highest-converting search type. An incomplete Google Business Profile suppresses local rankings across Google Search and Maps.",
        fix: 'Add photos, complete all service fields, post weekly updates, and respond to recent reviews.',
      },
    ],
    top_opportunity: { title: 'AI + EOFY visibility sprint', draft_cta: 'Draft my campaign →' },
  };
}

async function storeLead(env, { url, market, findings, noWebsite }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    // Return a stub ID when Supabase isn't configured
    return { id: `demo-${Date.now()}` };
  }

  const body = JSON.stringify({
    url: url || '',
    market,
    findings,
    no_website_answers: noWebsite || null,
    status: 'scouted',
  });

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Supabase insert error:', res.status, txt);
    return { id: `fallback-${Date.now()}` };
  }

  const rows = await res.json();
  return rows[0] || { id: `unknown-${Date.now()}` };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const { url, noWebsite } = body;

    if (!url && !noWebsite) {
      return new Response(JSON.stringify({ error: 'url or noWebsite required' }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Parse hostname and detect market
    let hostname = '';
    let market = 'AU';
    if (url) {
      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        hostname = parsed.hostname;
        market = detectMarket(hostname);
      } catch { /* ignore bad URL */ }
    }
    const locale = LOCALES[market];

    // Fetch homepage text
    let pageText = '';
    if (url) {
      try {
        const fetchUrl = url.startsWith('http') ? url : `https://${url}`;
        const pageRes = await fetch(fetchUrl, {
          signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': 'MagicEngineScout/1.0 (+https://magicengine.com.au)' },
        });
        const html = await pageRes.text();
        pageText = extractText(html).slice(0, 8000);
      } catch (fetchErr) {
        console.warn('Page fetch failed:', fetchErr.message);
      }
    }

    if (!pageText && noWebsite) {
      pageText = [
        noWebsite.what  ? `Business type: ${noWebsite.what}` : '',
        noWebsite.where ? `Service area: ${noWebsite.where}` : '',
        noWebsite.who   ? `Target customers: ${noWebsite.who}` : '',
      ].filter(Boolean).join('. ');
    }

    if (!pageText) {
      pageText = `Domain: ${hostname || url}. No homepage text available.`;
    }

    // Call Anthropic (via CF AI Gateway if configured)
    const anthropicBase = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const prompt = buildPrompt(locale, pageText, hostname);

    let findings;
    let retried = false;

    async function callClaude() {
      const r = await fetch(`${anthropicBase}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(55000),
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}`);
      const d = await r.json();
      return d.content?.[0]?.text || '';
    }

    try {
      const raw = await callClaude();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      findings = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e1) {
      if (!retried) {
        retried = true;
        try {
          const raw2 = await callClaude();
          const m = raw2.match(/\{[\s\S]*\}/);
          findings = JSON.parse(m ? m[0] : raw2);
        } catch {
          findings = getDemoFindings(market);
        }
      } else {
        findings = getDemoFindings(market);
      }
    }

    // Store lead
    const lead = await storeLead(env, { url, market, findings, noWebsite });

    const teaser = (findings.findings || []).slice(0, 3);

    return new Response(
      JSON.stringify({
        leadId: lead.id,
        market,
        teaser,
        totalCount: (findings.findings || []).length,
        summary: findings.summary || '',
        topOpportunity: findings.top_opportunity || null,
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Scout fatal error:', err);
    return new Response(
      JSON.stringify({ error: 'Scout failed — try again', demo: true }),
      { status: 502, headers: corsHeaders }
    );
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
