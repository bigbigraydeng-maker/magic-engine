/* Magic Engine — Marketing Site JS
   Responsibilities:
   1. EN/中文 language toggle
   2. Discover state machine (form → progress → result)
   3. API calls to /api/scout and /api/report
   4. Hero URL form redirect
*/

/* ── Language toggle ── */
let currentLang = 'en';

function toggleLang() {
  currentLang = currentLang === 'en' ? 'zh' : 'en';
  const toggle = document.getElementById('lang-toggle');
  if (toggle) toggle.textContent = currentLang === 'en' ? '中文' : 'EN';
  document.querySelectorAll('[data-en]').forEach(el => {
    const val = el.getAttribute(`data-${currentLang}`) || el.getAttribute('data-en');
    if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });
}

/* ── Demo data (shown when API fails or times out) ── */
const DEMO = {
  AU: {
    summary: 'Your business has several common visibility gaps. Enter your URL above for a personalised report.',
    findings: [
      {
        severity: 'NOW',
        title: 'Missing from AI assistants',
        desc: 'When customers ask ChatGPT or Google AI Overview for services like yours, businesses with the right content appear — others don\'t. This channel now drives 35%+ of new business discovery.',
        fix: 'Create authoritative content that AI assistants cite when answering questions in your category.',
      },
      {
        severity: 'GAP',
        title: 'EOFY opportunity window is open',
        desc: 'Australia\'s end-of-financial-year (30 June) triggers a surge in business purchases. Competitors investing in visibility now will capture intent that peaks in May–June.',
        fix: 'Launch EOFY-targeted content and ads before the window closes.',
      },
      {
        severity: 'GAP',
        title: 'Google Business Profile needs attention',
        desc: 'Local "near me" searches are the highest-converting search type. An incomplete Google Business Profile suppresses your local ranking significantly.',
        fix: 'Optimise with photos, services, hours, and recent review responses.',
      },
    ],
    totalCount: 6,
    topOpportunity: { title: 'EOFY visibility campaign', draft_cta: 'Draft my EOFY campaign →' },
  },
  NZ: {
    summary: 'Your business has several common visibility gaps. Enter your URL above for a personalised report.',
    findings: [
      {
        severity: 'NOW',
        title: 'Missing from AI assistants',
        desc: 'When customers ask ChatGPT or Google AI Overview for services like yours, businesses with the right content appear — others don\'t. This channel now drives 35%+ of new business discovery.',
        fix: 'Create authoritative content that AI assistants cite when answering questions in your category.',
      },
      {
        severity: 'GAP',
        title: 'EOFY opportunity window is open',
        desc: 'New Zealand\'s end-of-financial-year (31 March) triggers a surge in business purchases. Competitors investing in visibility now will capture intent that peaks in February–March.',
        fix: 'Launch EOFY-targeted content and ads before the March window closes.',
      },
      {
        severity: 'GAP',
        title: 'TradeMe and local platforms untapped',
        desc: 'NZ customers use TradeMe Services and local directories heavily. Your presence on these platforms significantly affects local trust and discoverability.',
        fix: 'Build and optimise your TradeMe Services profile and local NZ directory listings.',
      },
    ],
    totalCount: 6,
    topOpportunity: { title: 'EOFY visibility campaign', draft_cta: 'Draft my EOFY campaign →' },
  },
};

/* ── Market detection ── */
function detectMarket(url) {
  try {
    const h = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
    if (h.endsWith('.nz') || h.includes('.co.nz')) return 'NZ';
  } catch { /* ignore */ }
  return 'AU';
}

/* ── Discover state machine ── */
let leadId = null;
let market = 'AU';
let progressTimer = null;
let stepIdx = 0;

const STEPS = [
  'Scanning your online footprint…',
  'Checking Google search visibility…',
  'Analysing AI assistant mentions…',
  'Reviewing social & ad signals…',
  'Writing your discovery report…',
];

function showState(name) {
  document.querySelectorAll('.discover-state').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`state-${name}`);
  if (el) {
    el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function advanceStep(idx) {
  document.querySelectorAll('.ps').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
}

function startProgress() {
  showState('progress');
  stepIdx = 0;
  advanceStep(0);
  progressTimer = setInterval(() => {
    if (stepIdx < STEPS.length - 1) advanceStep(++stepIdx);
  }, 20000);
}

function stopProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  advanceStep(STEPS.length); // mark all done
}

/* ── Render result ── */
function renderResult(data) {
  const { teaser, totalCount, summary, topOpportunity, isDemo } = data;
  const container = document.getElementById('teaser-container');
  if (!container) return;

  let html = '';

  if (isDemo) {
    html += `<div class="demo-badge">Preview mode — enter your URL for a personalised report</div>`;
  }

  if (summary) {
    html += `<p class="result-summary">${escHtml(summary)}</p>`;
  }

  (teaser || []).forEach(f => {
    const sevLabel = f.severity === 'NOW' ? '⚡ Act now'
                   : f.severity === 'GAP' ? '⚠ Gap found'
                   : '✓ Looking good';
    html += `
      <div class="finding ${escHtml(f.severity)}">
        <div class="finding-sev">${sevLabel}</div>
        <h3>${escHtml(f.title)}</h3>
        <p>${escHtml(f.desc)}</p>
        ${f.fix ? `<div class="finding-fix">→ ${escHtml(f.fix)}</div>` : ''}
      </div>`;
  });

  const shown = teaser?.length || 0;
  const extra = (totalCount || 0) - shown;
  if (extra > 0) {
    html += `<div class="more-badge">+ ${extra} more findings in your full report</div>`;
  }

  container.innerHTML = html;

  // Portal bridge CTA
  const base = 'https://app.magicengine.com.au/login?next=/portal';
  document.querySelectorAll('.portal-link').forEach(a => {
    a.href = leadId ? `${base}&lead=${encodeURIComponent(leadId)}` : base;
  });

  // Show top opportunity in portal bridge if present
  if (topOpportunity) {
    const opp = document.getElementById('opportunity-title');
    if (opp) opp.textContent = topOpportunity.title;
  }

  showState('result');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Form submit ── */
async function handleDiscoverSubmit(e) {
  e.preventDefault();

  const urlInput = document.getElementById('url-input');
  const btn = document.getElementById('discover-btn');
  const url = urlInput?.value?.trim() || '';

  const nwPanel = document.querySelector('.nw-panel.open');
  const noWebsite = nwPanel ? {
    what:  document.getElementById('nw-what')?.value || '',
    where: document.getElementById('nw-where')?.value || '',
    who:   document.getElementById('nw-who')?.value || '',
  } : null;

  if (!url && !noWebsite) {
    urlInput?.focus();
    urlInput?.classList.add('shake');
    setTimeout(() => urlInput?.classList.remove('shake'), 500);
    return;
  }

  market = detectMarket(url);
  if (btn) { btn.textContent = 'Starting…'; btn.disabled = true; }
  startProgress();

  try {
    const res = await fetch('/api/scout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, noWebsite }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    stopProgress();
    leadId = data.leadId;
    market = data.market || market;

    setTimeout(() => renderResult(data), 500);

  } catch (err) {
    console.warn('Scout API failed, falling back to demo:', err.message);
    stopProgress();
    renderResult({ ...DEMO[market], isDemo: true, leadId: null });
  }

  if (btn) { btn.textContent = 'Run discovery →'; btn.disabled = false; }
}

/* ── Email submit ── */
async function handleEmailSubmit(e) {
  e.preventDefault();

  const emailInput = document.getElementById('email-input');
  const consentBox = document.getElementById('consent-checkbox');
  const btn = document.getElementById('email-btn');

  const email = emailInput?.value?.trim() || '';
  const consent = consentBox?.checked || false;

  if (!email) { emailInput?.focus(); return; }
  if (!consent) {
    consentBox?.closest('.consent-row')?.classList.add('shake');
    setTimeout(() => consentBox?.closest('.consent-row')?.classList.remove('shake'), 500);
    return;
  }

  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    if (leadId) {
      await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, email, consent }),
      });
    }
  } catch (err) {
    console.warn('Report API error (non-fatal):', err.message);
  }

  // Always show success (graceful degradation)
  document.querySelector('.email-form-wrap')?.classList.add('hidden');
  document.querySelector('.email-sent')?.classList.add('show');

  if (btn) { btn.textContent = 'Send my full report →'; btn.disabled = false; }
}

/* ── No-website toggle ── */
function toggleNoWebsite() {
  const panel = document.querySelector('.nw-panel');
  const urlBar = document.querySelector('.disc-url-bar');
  if (!panel) return;
  panel.classList.toggle('open');
  const isOpen = panel.classList.contains('open');
  if (urlBar) urlBar.style.display = isOpen ? 'none' : '';
  const toggle = document.querySelector('.nw-toggle');
  if (toggle) toggle.textContent = isOpen ? '↑ I have a website' : '↓ I don\'t have a website';
}

/* ── Hero URL form ── */
function handleHeroSubmit(e) {
  e.preventDefault();
  const url = document.getElementById('hero-url-input')?.value?.trim() || '';
  if (url) {
    window.location.href = `/discover?url=${encodeURIComponent(url)}`;
  } else {
    window.location.href = '/discover';
  }
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {

  // Hero form
  document.getElementById('hero-url-form')?.addEventListener('submit', handleHeroSubmit);

  // Discover form
  document.getElementById('discover-form')?.addEventListener('submit', handleDiscoverSubmit);

  // Email form
  document.getElementById('email-form')?.addEventListener('submit', handleEmailSubmit);

  // No-website toggle button
  document.querySelector('.nw-toggle')?.addEventListener('click', toggleNoWebsite);

  // Auto-fill & submit if URL param present on /discover
  if (window.location.pathname.startsWith('/discover')) {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
      const urlInput = document.getElementById('url-input');
      if (urlInput) {
        urlInput.value = decodeURIComponent(urlParam);
        setTimeout(() => {
          document.getElementById('discover-form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }, 600);
      }
    }
  }
});

/* ── Shake animation (inline) ── */
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  .shake { animation: shake .4s ease; }
`;
document.head.appendChild(shakeStyle);
