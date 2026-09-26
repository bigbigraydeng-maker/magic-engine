const MAX_BODY_BYTES = 16_000;

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function deliverToExistingContactFlow(env, submission) {
  const endpoint = env.CONTACT_API_URL || 'https://app.magicengine.com.au/api/contact';
  const message = [
    'Magic Engine early-access waitlist',
    '',
    `Current country / market: ${submission.country}`,
    `Industry: ${submission.industry}`,
    `Target market: ${submission.targetMarket}`,
    `Marketing platforms: ${submission.platforms.join(', ')}`,
    `Approximate monthly marketing budget: ${submission.budget}`,
    `Website: ${submission.website || 'Not provided'}`,
    '',
    `Main goal: ${submission.goal || 'Not provided'}`,
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(submission.formType === 'meta_ads_ai_pilot'
        ? { formType: 'meta_ads_ai_pilot' }
        : {}),
      name: submission.name,
      email: submission.email,
      company: submission.company,
      message,
      entry_page: '/waitlist/',
      entry_offer: 'early_access_waitlist',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Waitlist contact delivery failed:', response.status, detail.slice(0, 300));
    throw new Error('Waitlist contact delivery failed.');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'Submission is too large.' }, 413);

    const body = await request.json();
    if (clean(body.companyWebsite, 200)) return json({ ok: true });

    const submission = {
      formType: clean(body.formType, 80),
      name: clean(body.name, 120),
      email: clean(body.email, 200).toLowerCase(),
      company: clean(body.company, 180),
      website: clean(body.website, 300),
      country: clean(body.country, 120),
      industry: clean(body.industry, 160),
      targetMarket: clean(body.targetMarket, 160),
      platforms: Array.isArray(body.platforms)
        ? body.platforms.map((item) => clean(item, 80)).filter(Boolean).slice(0, 8)
        : [],
      budget: clean(body.budget, 100),
      goal: clean(body.goal, 1200),
    };

    if (!submission.name || !validEmail(submission.email) || !submission.company ||
        !submission.country || !submission.industry || !submission.targetMarket ||
        !submission.platforms.length || !submission.budget || body.consent !== true) {
      return json({ error: 'Please complete all required fields and accept the privacy notice.' }, 400);
    }

    await deliverToExistingContactFlow(env, submission);
    return json({ ok: true });
  } catch (error) {
    console.error('Waitlist submission failed:', error);
    return json({ error: 'We could not submit your application. Please try again or email hello@magicengine.cloud.' }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
