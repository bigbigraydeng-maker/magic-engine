/**
 * Meta Pixel loader.
 *
 * The Pixel is withheld until the shared website-consent bootstrap reports
 * marketing consent. No form values, email addresses or lead IDs are sent.
 */
(function initMetaMeasurement() {
  var META_PIXEL_ID = '2228804581237989';
  var ALLOWED_EVENTS = {
    ads_landing_view: true,
    ads_primary_cta_click: true,
    discover_start: true,
    discover_submit: true,
    contact_submit: true,
    qualified_lead: true
  };
  var LEAD_EVENTS = {
    discover_submit: true,
    contact_submit: true,
    qualified_lead: true
  };
  var leadEventsSent = {};

  function hasMarketingConsent() {
    return Boolean(
      window.meConsent &&
      typeof window.meConsent.hasMarketingConsent === 'function' &&
      window.meConsent.hasMarketingConsent()
    );
  }

  function loadPixel() {
    if (!META_PIXEL_ID || !hasMarketingConsent()) return;

    if (typeof window.fbq === 'function' && window.__meMetaPixelConfigured) {
      window.fbq('consent', 'grant');
      return;
    }

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('consent', 'grant');
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
    window.__meMetaPixelConfigured = true;
  }

  function revokePixel() {
    if (typeof window.fbq === 'function') {
      window.fbq('consent', 'revoke');
    }
  }

  window.meTrackMetaEvent = function meTrackMetaEvent(name) {
    if (!ALLOWED_EVENTS[name] || !hasMarketingConsent()) return;

    loadPixel();
    if (typeof window.fbq !== 'function' || !window.__meMetaPixelConfigured) return;

    window.fbq('trackCustom', name);

    // A standard Lead is emitted at most once for each qualifying event per page.
    if (LEAD_EVENTS[name] && !leadEventsSent[name]) {
      leadEventsSent[name] = true;
      window.fbq('track', 'Lead', { content_name: name });
    }
  };

  window.addEventListener('me:consent-change', function (event) {
    if (event.detail && event.detail.marketing) {
      loadPixel();
    } else {
      revokePixel();
    }
  });

  loadPixel();
})();