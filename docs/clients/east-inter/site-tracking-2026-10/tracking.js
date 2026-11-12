/* East Inter site tracking: Meta Pixel + Google Analytics 4. Loads nothing unless an ID is configured and the visitor
 * has not set Do Not Track. Events carry no personal data (no names, emails, cargo text, weights or prices).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EastInterTrackingApi = api;
    const start = () => api.init(root, root.document, root.EastInterTracking || {});
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const PIXEL_RE = /^\d{10,20}$/, GA_RE = /^G-[A-Z0-9]{6,12}$/;

  function allowed(win) {
    const nav = win.navigator || {};
    return !(nav.doNotTrack === '1' || win.doNotTrack === '1' || nav.msDoNotTrack === '1');
  }
  function loadScript(doc, src) {
    const s = doc.createElement('script'); s.async = true; s.src = src; doc.head.appendChild(s);
  }
  function setupMeta(win, doc, id) {
    const f = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    win.fbq = win._fbq = f;
    loadScript(doc, 'https://connect.facebook.net/en_US/fbevents.js');
    win.fbq('init', id); win.fbq('track', 'PageView');
  }
  function setupGa(win, doc, id) {
    win.dataLayer = win.dataLayer || [];
    win.gtag = function () { win.dataLayer.push(arguments); };
    loadScript(doc, 'https://www.googletagmanager.com/gtag/js?id=' + id);
    win.gtag('js', new Date());
    win.gtag('config', id, {allow_google_signals: false, allow_ad_personalization_signals: false});
  }

  // Business event -> tool events. Only generic labels, never user-entered content.
  function send(win, name, params) {
    if (win.gtag) win.gtag('event', name, params || {});
    if (win.fbq) {
      const meta = {quote_email_click: 'Contact', quote_email_prepared: 'Contact', calculator_estimate: 'ViewContent'}[name];
      if (meta) win.fbq('track', meta, params || {}); else win.fbq('trackCustom', name, params || {});
    }
  }

  function init(win, doc, cfg) {
    const state = {enabled: false, meta: false, ga: false, track: () => {}};
    if (!allowed(win)) return state;
    if (typeof cfg.metaPixelId === 'string' && PIXEL_RE.test(cfg.metaPixelId)) { setupMeta(win, doc, cfg.metaPixelId); state.meta = true; }
    if (typeof cfg.ga4MeasurementId === 'string' && GA_RE.test(cfg.ga4MeasurementId)) { setupGa(win, doc, cfg.ga4MeasurementId); state.ga = true; }
    state.enabled = state.meta || state.ga;
    if (!state.enabled) return state;
    state.track = (name, params) => send(win, name, params);
    bind(win, doc, state);
    return state;
  }

  function bind(win, doc, state) {
    // 1. Any email link: this is a click signal, not a confirmed enquiry (we cannot see whether the email is sent).
    doc.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (/^mailto:/i.test(href)) state.track('quote_email_click', {location: win.location.pathname});
      else if (/\/eastinter-pricing-calculator/.test(href) && win.location.pathname !== href.split('?')[0]) state.track('calculator_cta_click', {location: win.location.pathname});
    });
    // 2. Quote dialog on the home page: submitting it only prepares an email in the visitor's mail app.
    const form = doc.getElementById('details-form');
    if (form) form.addEventListener('submit', () => state.track('quote_email_prepared', {location: win.location.pathname}));
    // 3. Calculator: first real interaction on the page (service, city, size inputs), once per page view.
    const card = doc.querySelector('.form-card');
    if (card) {
      let done = false;
      const once = e => {
        if (done || !e.isTrusted) return; done = true;
        const svc = doc.querySelector('[data-service][aria-pressed="true"]');
        const city = doc.getElementById('city');
        state.track('calculator_estimate', {service: svc ? svc.getAttribute('data-service') : 'unknown', city: city ? city.value : 'unknown'});
      };
      ['input', 'change', 'click'].forEach(t => card.addEventListener(t, once));
    }
  }
  return {init, allowed, PIXEL_RE, GA_RE};
});
