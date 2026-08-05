/* Magic Engine — Marketing Site JS
   Responsibilities:
   1. English / Chinese page routing
   2. Discover state machine (form → progress → result)
   3. API calls to /api/scout and /api/report
   4. Hero URL form redirect
*/

const CN_PREFIX = '/cn';

/* ── Language routing ── */
function isChinesePath(pathname = window.location.pathname) {
  const normalized = normalizePath(pathname);
  return normalized === CN_PREFIX || normalized.startsWith(`${CN_PREFIX}/`);
}

function normalizePath(pathname) {
  if (!pathname) return '/';
  let next = pathname;
  if (next.endsWith('/index.html')) {
    next = next.slice(0, -('/index.html'.length)) || '/';
  } else if (next.endsWith('.html')) {
    next = next.slice(0, -5) || '/';
  }
  return next === '' ? '/' : next;
}

function stripCnPrefix(pathname) {
  const normalized = normalizePath(pathname);
  if (normalized === CN_PREFIX) return '/';
  if (normalized.startsWith(`${CN_PREFIX}/`)) return normalized.slice(CN_PREFIX.length) || '/';
  return normalized;
}

function localizePath(pathname, lang) {
  const clean = stripCnPrefix(pathname);
  if (lang === 'zh') {
    return clean === '/' ? '/cn/' : `${CN_PREFIX}${clean}`;
  }
  return clean;
}

let currentLang = isChinesePath(window.location.pathname) ? 'zh' : 'en';

const MARKETING_EVENT = {
  ADS_LANDING_VIEW: 'ads_landing_view',
  ADS_PRIMARY_CTA_CLICK: 'ads_primary_cta_click',
  DISCOVER_START: 'discover_start',
  DISCOVER_SUBMIT: 'discover_submit',
  CONTACT_SUBMIT: 'contact_submit',
  QUALIFIED_LEAD: 'qualified_lead',
};

const URL_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'entry_offer',
  'entry_page',
];

const ATTRIBUTION_KEYS = [...URL_ATTRIBUTION_KEYS, 'referrer'];
const ATTRIBUTION_STORAGE_KEY = 'me_marketing_attribution_v1';

function trimAttributionValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 300);
}

function mergeAttribution(...sources) {
  const out = {};

  sources.forEach(source => {
    if (!source || typeof source !== 'object') return;
    ATTRIBUTION_KEYS.forEach(key => {
      const value = trimAttributionValue(source[key]);
      if (value) out[key] = value;
    });
  });

  return Object.keys(out).length > 0 ? out : null;
}

function attributionFromSearch(search = window.location.search) {
  const params = new URLSearchParams(search);
  const raw = {};

  ATTRIBUTION_KEYS.forEach(key => {
    const value = params.get(key);
    if (value) raw[key] = value;
  });

  return mergeAttribution(raw);
}

function readStoredAttribution() {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    return mergeAttribution(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistAttribution(attribution) {
  try {
    if (!attribution) {
      window.sessionStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Ignore storage failures in private browsing or locked-down environments.
  }
}

function getDefaultAttribution(pathname = window.location.pathname) {
  const pageKey = normalizePath(pathname);

  if (pageKey === '/ads' || pageKey === '/cn/ads') {
    return {
      entry_offer: 'free_diagnosis',
      entry_page: isChinesePath(pathname) ? 'cn_ads' : 'ads',
    };
  }

  if (pageKey === '/discover' || pageKey === '/cn/discover') {
    return {
      entry_page: isChinesePath(pathname) ? 'cn_discover' : 'discover',
    };
  }

  return null;
}

function getCurrentAttribution() {
  const pageKey = stripCnPrefix(window.location.pathname);
  const defaults = getDefaultAttribution(window.location.pathname);
  const stored = readStoredAttribution();
  const search = attributionFromSearch(window.location.search);

  const merged = pageKey === '/ads'
    ? mergeAttribution(stored, defaults, search, { referrer: document.referrer || '' })
    : mergeAttribution(defaults, stored, search, { referrer: document.referrer || '' });

  persistAttribution(merged);
  return merged;
}

let marketingAttribution = getCurrentAttribution();

function withAttribution(href, attribution) {
  if (!href) return href;

  const merged = mergeAttribution(attribution);
  if (!merged) return href;

  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);
  const url = new URL(href, isAbsolute ? undefined : window.location.origin);

  URL_ATTRIBUTION_KEYS.forEach(key => {
    const value = merged[key];
    if (value) url.searchParams.set(key, value);
  });

  return isAbsolute
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

function getLinkAttribution(link) {
  if (!link) return marketingAttribution;

  return mergeAttribution(marketingAttribution, {
    entry_offer: link.getAttribute('data-entry-offer') || '',
    entry_page: link.getAttribute('data-entry-page') || '',
  });
}

function decorateAttributionLinks(root = document) {
  root.querySelectorAll('[data-pass-attribution="true"]').forEach(link => {
    const baseHref = link.getAttribute('data-base-href') || link.getAttribute('href');
    if (!baseHref) return;

    if (!link.getAttribute('data-base-href')) {
      link.setAttribute('data-base-href', baseHref);
    }

    const nextHref = withAttribution(baseHref, getLinkAttribution(link));
    if (nextHref) link.setAttribute('href', nextHref);
  });
}

function trackMarketingEvent(name, params = {}) {
  const payload = { ...params };

  if (typeof window.gtag === 'function') {
    window.gtag('event', name, payload);
  }

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...payload });
}

function inferLeadDestination(href) {
  const target = String(href || '');
  if (target.includes('/discover')) return 'discover';
  if (target.includes('/contact')) return 'contact';
  if (target.includes('/portal/')) return 'portal';
  return 'page';
}

function postLeadEvent(payload) {
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const accepted = navigator.sendBeacon('/api/lead-event', blob);
      if (accepted) return;
    }
  } catch {
    // Fall through to fetch keepalive.
  }

  fetch('/api/lead-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

function logMarketingLeadEvent(eventName, options = {}) {
  const attribution = mergeAttribution(marketingAttribution, options.attribution);
  const pagePath = normalizePath(window.location.pathname);

  postLeadEvent({
    ctaKey: eventName,
    destination: options.destination || 'page',
    href: options.href || `${window.location.pathname}${window.location.search}`,
    pagePath,
    source: attribution?.entry_page || attribution?.utm_source || pagePath.replace(/^\//, '') || 'website',
    referrer: attribution?.referrer || document.referrer || null,
    metadata: {
      event_name: eventName,
      ...options.metadata,
      attribution,
    },
  });
}

function initAdsTracking() {
  if (stripCnPrefix(window.location.pathname) !== '/ads') return;

  const pagePath = normalizePath(window.location.pathname);

  trackMarketingEvent(MARKETING_EVENT.ADS_LANDING_VIEW, {
    page_path: pagePath,
    ...marketingAttribution,
  });
  logMarketingLeadEvent(MARKETING_EVENT.ADS_LANDING_VIEW, {
    destination: 'page',
    href: `${window.location.pathname}${window.location.search}`,
  });

  document.querySelectorAll('[data-ads-primary-cta]').forEach(link => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      const ctaLocation = link.getAttribute('data-ads-primary-cta') || 'unknown';
      const attribution = getLinkAttribution(link);

      trackMarketingEvent(MARKETING_EVENT.ADS_PRIMARY_CTA_CLICK, {
        page_path: pagePath,
        cta_location: ctaLocation,
        ...attribution,
      });

      logMarketingLeadEvent(MARKETING_EVENT.ADS_PRIMARY_CTA_CLICK, {
        destination: inferLeadDestination(href),
        href,
        attribution,
        metadata: { cta_location: ctaLocation },
      });
    });
  });
}

function initDiscoverTracking() {
  if (stripCnPrefix(window.location.pathname) !== '/discover') return;

  const pagePath = normalizePath(window.location.pathname);

  trackMarketingEvent(MARKETING_EVENT.DISCOVER_START, {
    page_path: pagePath,
    ...marketingAttribution,
  });

  logMarketingLeadEvent(MARKETING_EVENT.DISCOVER_START, {
    destination: 'page',
    href: `${window.location.pathname}${window.location.search}`,
  });
}

function shouldRewriteLink(href) {
  if (!href) return false;
  return !href.startsWith('http')
    && !href.startsWith('mailto:')
    && !href.startsWith('tel:')
    && !href.startsWith('javascript:')
    && !href.startsWith('#');
}

function localizeHref(href, lang) {
  if (!shouldRewriteLink(href)) return href;

  const url = new URL(href, window.location.origin);
  const pathname = normalizePath(url.pathname);

  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/assets/') ||
    pathname === '/app.js' ||
    pathname === '/styles.css' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  ) {
    return href;
  }

  url.pathname = localizePath(pathname, lang);
  return `${url.pathname}${url.search}${url.hash}`;
}

const PAGE_TITLES = {
  '/': {
    zh: 'Magic Engine — AI 升级、GEO 与培训',
  },
  '/industry-solutions': {
    zh: '行业解决方案 — 地产、旅游与本地服务 | Magic Engine',
  },
  '/geo': {
    zh: 'GEO — AI 可见度（澳洲和新西兰） | Magic Engine',
  },
  '/training': {
    zh: '培训 — 面向澳洲和新西兰团队 | Magic Engine',
  },
  '/ai-training': {
    zh: 'AI培训 — 面向澳洲和新西兰团队 | Magic Engine',
  },
  '/ai-automation': {
    zh: 'AI自动化 — 面向澳洲和新西兰团队 | Magic Engine',
  },
  '/ai-marketing-smes': {
    zh: 'AI营销 — 面向澳洲和新西兰 SME | Magic Engine',
  },
  '/ai-search': {
    zh: 'AI 搜索可见度 - 面向 AU/NZ 企业 | Magic Engine',
  },
  '/ai-search-faq': {
    zh: 'AI 搜索 FAQ 支持页 - 面向 AU/NZ 企业 | Magic Engine',
  },
  '/ai-search-snippets': {
    zh: 'AI 搜索 Snippet Bank - 面向 AU/NZ 企业 | Magic Engine',
  },
  '/about': {
    zh: '关于 Magic Engine — AI 升级、GEO 与培训',
  },
  '/discover': {
    zh: '免费诊断 — Magic Engine',
  },
  '/ads': {
    zh: '广告投放启动 — Magic Engine',
  },
  '/features': {
    zh: '功能 — Magic Engine',
  },
  '/privacy': {
    zh: '隐私政策 — Magic Engine',
  },
  '/terms': {
    zh: '服务条款 — Magic Engine',
  },
};

function updatePageMeta(lang) {
  if (lang !== 'zh') return;

  const pageKey = stripCnPrefix(window.location.pathname);
  const meta = PAGE_TITLES[pageKey];
  if (meta?.zh) document.title = meta.zh;
}

function rewritePageLinks(lang) {
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || link.hasAttribute('data-keep-path')) return;
    const nextHref = localizeHref(href, lang);
    if (nextHref !== href) link.setAttribute('href', nextHref);
  });

  decorateAttributionLinks();
}

function applyLanguage(lang) {
  currentLang = lang === 'zh' ? 'zh' : 'en';
  document.documentElement.lang = currentLang === 'zh' ? 'zh' : 'en';

  const toggle = document.getElementById('lang-toggle');
  if (toggle) toggle.textContent = currentLang === 'en' ? '中文' : 'EN';

  document.querySelectorAll('[data-en]').forEach(el => {
    const val = el.getAttribute(`data-${currentLang}`) || el.getAttribute('data-en');
    if (!val) return;
    if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  updatePageMeta(currentLang);
  rewritePageLinks(currentLang);
}

function toggleLang() {
  const nextLang = currentLang === 'en' ? 'zh' : 'en';
  const target = new URL(window.location.href);
  target.pathname = localizePath(window.location.pathname, nextLang);
  target.search = window.location.search;
  target.hash = window.location.hash;
  window.location.href = target.toString();
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

/* ── Visibility score (computed client-side from severity mix) ── */
function computeScore(teaser, totalCount) {
  let score = 100;
  (teaser || []).forEach(f => {
    if (f.severity === 'NOW') score -= 22;
    else if (f.severity === 'GAP') score -= 11;
    else if (f.severity === 'GOOD') score += 3;
  });
  const hidden = Math.max(0, (totalCount || 0) - (teaser?.length || 0));
  score -= hidden * 4; // unseen findings drag the score down too
  return Math.max(12, Math.min(92, Math.round(score)));
}

function scoreVerdict(score) {
  if (score < 35) return 'Nearly invisible where it counts';
  if (score < 55) return 'Losing ground to your competitors';
  if (score < 75) return 'Visible — but leaking opportunities';
  return 'Strong — with room to dominate';
}

function animateScore(el, target) {
  let cur = 0;
  const step = Math.max(1, Math.round(target / 26));
  const tick = () => {
    cur = Math.min(target, cur + step);
    el.textContent = cur;
    if (cur < target) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => { el.textContent = target; }, 1600); // guarantee final value even if rAF is throttled (background tab)
}

/* ── Render result ── */
function renderResult(data) {
  const { teaser, totalCount, topOpportunity, isDemo } = data;
  const container = document.getElementById('teaser-container');
  if (!container) return;

  const list = teaser || data.findings || []; // tolerate DEMO fallback (carries 'findings', not 'teaser')
  const score = computeScore(list, totalCount);

  let html = '';

  if (isDemo) {
    html += `<div class="demo-badge">Preview mode — enter your URL for a personalised report</div>`;
  }

  // Visibility score hero — the emotional hook
  html += `
    <div class="score-hero">
      <div class="score-cap">AI-era visibility score</div>
      <div class="score-num"><span id="score-val">0</span><span>/100</span></div>
      <div class="score-bar"><div class="score-fill" id="score-fill"></div></div>
      <div class="score-verdict">${escHtml(scoreVerdict(score))}</div>
    </div>`;

  // Findings — first one enlarged as "most urgent" with a loss-aversion line
  list.forEach((f, i) => {
    const sevLabel = f.severity === 'NOW' ? '⚡ Most urgent'
                   : f.severity === 'GAP' ? '⚠ Gap found'
                   : '✓ Strength';
    const hero = i === 0 ? ' hero-finding' : '';
    const loss = (i === 0 && f.severity === 'NOW')
      ? `<div class="finding-loss">Every week, customers ask AI assistants for businesses like yours — right now it isn't naming you.</div>`
      : '';
    html += `
      <div class="finding ${escHtml(f.severity)}${hero}">
        <div class="finding-sev">${sevLabel}</div>
        <h3>${escHtml(f.title)}</h3>
        <p>${escHtml(f.desc)}</p>
        ${loss}
        ${f.fix ? `<div class="finding-fix">→ ${escHtml(f.fix)}</div>` : ''}
      </div>`;
  });

  // Locked findings — blurred and gated behind sign-up
  const hidden = Math.max(0, (totalCount || 0) - list.length);
  if (hidden > 0) {
    let locked = '';
    for (let i = 0; i < Math.min(hidden, 3); i++) {
      locked += `
        <div class="finding GAP locked" aria-hidden="true">
          <div class="finding-sev">⚠ Gap found</div>
          <h3>████████ ███████████</h3>
          <p>███████████████ ████████ ██████████ █████ ███████████████ ████████.</p>
        </div>`;
    }
    html += `
      <div class="locked-stack">
        ${locked}
        <div class="unlock-overlay">
          <div class="lock-icon">🔒</div>
          <strong>+ ${hidden} more findings in your full report</strong>
          <p>Create your free account to unlock every finding, prioritised fixes, and your local opportunity window.</p>
          <a href="https://app.magicengine.com.au/portal/register" class="btn-primary">Unlock full report →</a>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // Animate the score number + progress bar
  const valEl = document.getElementById('score-val');
  const fillEl = document.getElementById('score-fill');
  if (valEl) animateScore(valEl, score);
  if (fillEl) setTimeout(() => { fillEl.style.width = score + '%'; }, 80);

  // Portal bridge CTA
  const base = 'https://app.magicengine.com.au/portal/login?next=/prospect';
  const registerBase = 'https://app.magicengine.com.au/portal/register?next=/prospect';
  document.querySelectorAll('.portal-link').forEach(a => {
    a.href = base;
  });
  document.querySelectorAll('.portal-register-link').forEach(a => {
    a.href = registerBase;
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

  const attribution = mergeAttribution(
    getDefaultAttribution(window.location.pathname),
    marketingAttribution,
  );

  market = detectMarket(url);
  if (btn) { btn.textContent = 'Starting…'; btn.disabled = true; }
  startProgress();

  try {
    const res = await fetch('/api/scout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, noWebsite, attribution }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    stopProgress();
    leadId = data.leadId;
    market = data.market || market;

    trackMarketingEvent(MARKETING_EVENT.DISCOVER_SUBMIT, {
      page_path: normalizePath(window.location.pathname),
      lead_id: data.leadId || '',
      market,
      ...attribution,
    });
    logMarketingLeadEvent(MARKETING_EVENT.DISCOVER_SUBMIT, {
      destination: 'discover',
      href: '/api/scout',
      attribution,
      metadata: {
        lead_id: data.leadId || null,
        market,
        no_website: Boolean(noWebsite),
      },
    });

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

  // delivered = the report email was actually sent (real lead behind it).
  // pending   = scan hasn't persisted a lead yet (demo/fallback/unknown id or
  //             /api/report returned report_not_ready). We must NOT claim the
  //             report is on its way in that case. P0-A fix.
  let delivered = false;
  try {
    if (leadId) {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, email, consent }),
      });
      delivered = res.ok;
    }
  } catch (err) {
    console.warn('Report API error (non-fatal):', err.message);
  }

  document.querySelector('.email-form-wrap')?.classList.add('hidden');

  // Toggle the success copy honestly: only show "on its way" when delivered.
  const sentEl = document.querySelector('.email-sent');
  if (sentEl) {
    sentEl.setAttribute('data-state', delivered ? 'delivered' : 'pending');
    sentEl.classList.add('show');
  }

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
  const discoverPath = localizePath('/discover', currentLang);
  const target = new URL(discoverPath, window.location.origin);

  if (url) target.searchParams.set('url', url);

  const nextHref = withAttribution(
    `${target.pathname}${target.search}${target.hash}`,
    marketingAttribution,
  );

  window.location.href = nextHref || `${target.pathname}${target.search}${target.hash}`;
}

/* ── Mobile nav ── */
function toggleMobileMenu() {
  const burger = document.querySelector('.nav-burger');
  const menu   = document.getElementById('nav-mobile');
  if (!burger || !menu) return;
  const isOpen = menu.classList.toggle('open');
  burger.classList.toggle('open', isOpen);
  burger.setAttribute('aria-expanded', String(isOpen));
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeMobileMenu() {
  const burger = document.querySelector('.nav-burger');
  const menu   = document.getElementById('nav-mobile');
  if (!burger || !menu) return;
  menu.classList.remove('open');
  burger.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  marketingAttribution = getCurrentAttribution();

  // Inject hamburger + mobile nav drawer into every page
  const navInner = document.querySelector('.nav-inner');
  const navEl    = document.querySelector('.nav');
  if (navInner && navEl) {
    const burger = document.createElement('button');
    burger.className = 'nav-burger';
    burger.setAttribute('aria-label', 'Open navigation menu');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span><span></span>';
    burger.addEventListener('click', toggleMobileMenu);
    navInner.appendChild(burger);

    const mobileNav = document.createElement('nav');
    mobileNav.id = 'nav-mobile';
    mobileNav.className = 'nav-mobile';
    mobileNav.setAttribute('aria-label', 'Mobile navigation');
    mobileNav.innerHTML = `
      <div class="nav-mobile-section nav-mobile-solutions">
        <span class="nav-mobile-label" data-en="Industry solutions" data-zh="行业解决方案">Industry solutions</span>
        <a class="nav-mobile-overview" href="/industry-solutions">
          <strong data-en="Solutions built around your industry" data-zh="贴合行业的增长解决方案">Solutions built around your industry</strong>
          <span data-en="Compare all solutions →" data-zh="查看全部方案 →">Compare all solutions →</span>
        </a>
        <div class="nav-mobile-industry-grid">
          <a href="/real-estate" data-keep-path>
            <strong data-en="Real Estate" data-zh="地产">Real Estate</strong>
            <span data-en="Audience & demand" data-zh="受众与需求">Audience & demand</span>
          </a>
          <a href="/travel" data-keep-path>
            <strong data-en="Travel" data-zh="旅游">Travel</strong>
            <span data-en="Content to leads" data-zh="内容到线索">Content to leads</span>
          </a>
          <a href="/local-services" data-keep-path>
            <strong data-en="Local Services" data-zh="本地服务">Local Services</strong>
            <span data-en="Local demand" data-zh="本地需求">Local demand</span>
          </a>
        </div>
      </div>
      <div class="nav-mobile-divider"></div>
      <div class="nav-mobile-section nav-mobile-secondary">
        <span class="nav-mobile-label" data-en="Platform & services" data-zh="平台与服务">Platform & services</span>
        <a href="/ai-growth-engine" data-keep-path data-en="The Engine" data-zh="核心引擎">The Engine</a>
        <a href="/geo" data-en="GEO & AI Visibility" data-zh="GEO 与 AI 可见度">GEO & AI Visibility</a>
        <a href="/training" data-en="AI Adoption & Training" data-zh="AI 落地与培训">AI Adoption & Training</a>
        <a href="/about" data-en="About Magic Engine" data-zh="关于 Magic Engine">About Magic Engine</a>
      </div>
      <div class="nav-mobile-divider"></div>
      <a href="/discover"
         class="nav-mobile-register"
         data-en="Get a growth diagnosis" data-zh="获取增长诊断">Get a growth diagnosis</a>
    `;
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileMenu));
    navEl.insertAdjacentElement('afterend', mobileNav);
  }

  applyLanguage(currentLang);
  decorateAttributionLinks();
  initAdsTracking();
  initDiscoverTracking();

  // Hero form
  document.getElementById('hero-url-form')?.addEventListener('submit', handleHeroSubmit);

  // Discover form
  document.getElementById('discover-form')?.addEventListener('submit', handleDiscoverSubmit);

  // Email form
  document.getElementById('email-form')?.addEventListener('submit', handleEmailSubmit);

  // No-website toggle button
  document.querySelector('.nw-toggle')?.addEventListener('click', toggleNoWebsite);

  // Auto-fill & submit if URL param present on /discover
  if (stripCnPrefix(window.location.pathname) === '/discover') {
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

/* ════════════════════════════════════════════════════════════════════
   NEW VI homepage interactions (2026-06-02)
   Self-contained IIFE, guarded by #me-home so it only runs on the
   homepage and never touches the legacy language/discover/nav logic above.
   All classes use the `me-` prefix to match the scoped styles.
   Flywheel copy is bilingual, read from <html lang>.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const home = document.getElementById("me-home");
  if (!home) return; // not the homepage — skip everything

  const lang = (document.documentElement.lang === "zh") ? "zh" : "en";
  const motionOff = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Nav shadow on scroll ---------- */
  const nav = document.getElementById("me-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Flywheel content (bilingual) ---------- */
  const STEPS_EN = [
    { no: "Step 01 — Diagnose", title: "Find what actually moves the needle.",
      body: "Magic Engine scores your search, AI visibility, social, ads, reputation and competitor signals — and surfaces the highest-leverage opportunities, ranked by impact. No more guessing where to start.",
      points: ["Six diagnostic signals, AU/NZ-first", "AI-ranked opportunity map", "Delivered in 48 hours, free"] },
    { no: "Step 02 — Prioritise", title: "Turn a long list into a clear plan.",
      body: "Opportunities are scored, sequenced and packaged into execution loops — so the team always knows the single most valuable thing to ship next.",
      points: ["Impact-vs-effort sequencing", "Approval items routed to the right people", "Scope locked before work begins"] },
    { no: "Step 03 — Execute", title: "Ship the work, not just the report.",
      body: "Prioritised work flows into active execution loops and gets done — content, website fixes, social assets and ad decisions — tracked end-to-end, visible to you and your customers.",
      points: ["Live execution tracking", "Real-time client portal view", "Nothing stalls in a backlog"] },
    { no: "Step 04 — Measure", title: "Show customers exactly what changed.",
      body: "Every loop closes with measurable proof — visibility lifts, actions shipped, results delivered — feeding straight back into the next diagnosis. The flywheel keeps turning.",
      points: ["Outcome dashboards per client", "Before / after proof", "Insight feeds the next loop"] }
  ];
  const STEPS_ZH = [
    { no: "第 01 步 — 诊断", title: "找到真正能撬动增长的点。",
      body: "Magic Engine 为你的搜索、AI 可见度、社媒、广告、口碑和竞品信号打分，并按影响力排序，浮现最高杠杆的机会。不用再猜从哪里开始。",
      points: ["六个诊断信号，澳新优先", "AI 排序的机会地图", "48 小时内交付，免费"] },
    { no: "第 02 步 — 排序", title: "把长长的清单变成清晰的计划。",
      body: "机会会被打分、排序，并打包成执行环——团队始终清楚下一个最有价值的事是什么。",
      points: ["按影响力与工作量排序", "审批项分派给对的人", "开工前先锁定范围"] },
    { no: "第 03 步 — 执行", title: "交付的是工作，不只是报告。",
      body: "优先级最高的工作进入执行环并被完成——内容、网站修复、社媒素材和广告决策——全程跟踪，你和你的客户都能看到。",
      points: ["实时执行跟踪", "客户门户实时查看", "不会卡在待办里"] },
    { no: "第 04 步 — 度量", title: "向客户清楚展示发生了什么改变。",
      body: "每个环都以可度量的证据收尾——可见度提升、已交付的动作、拿到的结果——并直接回流到下一次诊断。飞轮持续转动。",
      points: ["每个客户的成果看板", "前后对比证据", "洞察反哺下一个环"] }
  ];
  const STEPS = lang === "zh" ? STEPS_ZH : STEPS_EN;
  const TAB_LABEL = (no) => no.split("—")[1].trim();

  const detail = document.getElementById("me-fly-detail");
  const nodes = Array.from(document.querySelectorAll(".me-fly-node"));
  const arc = document.getElementById("me-fly-arc");
  const ARC_LEN = 565;

  function renderStep(i) {
    const s = STEPS[i];
    if (!detail) return;
    detail.innerHTML =
      '<div class="me-step-no">' + s.no + "</div>" +
      "<h3>" + s.title + "</h3>" +
      "<p>" + s.body + "</p>" +
      "<ul>" + s.points.map(function (p) {
        return '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' + p + "</li>";
      }).join("") + "</ul>" +
      '<div class="me-fly-tabs">' + STEPS.map(function (st, idx) {
        return '<button data-go="' + idx + '"' + (idx === i ? ' class="active"' : "") + ">" + TAB_LABEL(st.no) + "</button>";
      }).join("") + "</div>";

    nodes.forEach(function (n, idx) { n.classList.toggle("active", idx === i); });

    if (arc) {
      const frac = (i + 1) / STEPS.length;
      arc.style.transition = "stroke-dashoffset .6s cubic-bezier(.22,.61,.36,1)";
      arc.style.strokeDashoffset = String(ARC_LEN * (1 - frac));
    }
    detail.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { setStep(+b.dataset.go); });
    });
  }
  function setStep(i) { renderStep(i); }
  nodes.forEach(function (n) {
    n.addEventListener("click", function () { setStep(+n.dataset.step); });
  });
  if (detail) renderStep(0);

  /* ---------- Scroll-driven visibility (throttled) ---------- */
  const watchers = [];
  function registerWatcher(el, ratio, cb) {
    if (!el) return;
    watchers.push({ el: el, ratio: ratio == null ? 0.12 : ratio, cb: cb, done: false });
  }
  function inView(el, ratio) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.height === 0 && r.width === 0) return false;
    const visibleTop = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const need = Math.min(r.height * ratio, vh * 0.4);
    return r.top < vh && r.bottom > 0 && visibleTop >= Math.max(1, need);
  }
  let ticking = false;
  function runWatchers() {
    ticking = false;
    for (let i = watchers.length - 1; i >= 0; i--) {
      const w = watchers[i];
      if (w.done) { watchers.splice(i, 1); continue; }
      if (inView(w.el, w.ratio)) { w.done = true; w.cb(w.el); }
    }
  }
  function requestRun() {
    if (ticking) return;
    ticking = true;
    setTimeout(runWatchers, 16);
  }
  window.addEventListener("scroll", requestRun, { passive: true });
  window.addEventListener("resize", requestRun);
  let polls = 0;
  const pollTimer = setInterval(function () {
    runWatchers();
    if (++polls > 40 || watchers.length === 0) clearInterval(pollTimer);
  }, 200);

  /* ---------- Reveal on scroll ---------- */
  home.querySelectorAll(".me-reveal").forEach(function (el) {
    if (motionOff) { el.classList.add("in"); return; }
    registerWatcher(el, 0.1, function (t) { t.classList.add("in"); });
  });

  /* ---------- Count-up numbers ---------- */
  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || "0", 10);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    if (motionOff) { el.textContent = prefix + target.toFixed(dec) + suffix; return; }
    const dur = 1300;
    const start = Date.now();
    const timer = setInterval(function () {
      const t = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + (target * eased).toFixed(dec) + suffix;
      if (t >= 1) { el.textContent = prefix + target.toFixed(dec) + suffix; clearInterval(timer); }
    }, 32);
  }
  home.querySelectorAll("[data-count]").forEach(function (el) {
    registerWatcher(el, 0.5, animateCount);
  });

  requestRun();
  window.addEventListener("load", requestRun);
  setTimeout(requestRun, 250);
  setTimeout(requestRun, 800);

  /* ---------- FAQ accordion ---------- */
  home.querySelectorAll(".me-faq-item").forEach(function (item) {
    const q = item.querySelector(".me-faq-q");
    const a = item.querySelector(".me-faq-a");
    if (!q || !a) return;
    function setOpen(open) {
      item.classList.toggle("open", open);
      a.style.maxHeight = open ? a.scrollHeight + "px" : "0px";
    }
    if (item.classList.contains("open")) setOpen(true);
    q.addEventListener("click", function () {
      const willOpen = !item.classList.contains("open");
      home.querySelectorAll(".me-faq-item").forEach(function (other) {
        if (other !== item) { other.classList.remove("open"); other.querySelector(".me-faq-a").style.maxHeight = "0px"; }
      });
      setOpen(willOpen);
    });
  });
  window.addEventListener("resize", function () {
    const open = home.querySelector(".me-faq-item.open .me-faq-a");
    if (open) open.style.maxHeight = open.scrollHeight + "px";
  });
})();
