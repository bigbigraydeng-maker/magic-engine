(function initMetaPixel() {
  var META_PIXEL_ID = '2228804581237989';

  if (!META_PIXEL_ID) return;

  if (typeof window.fbq === 'function' && window.__meMetaPixelConfigured) return;

  // Meta Pixel base code — inlined instead of external so the pixel fires on
  // first paint (matches google-tag.js pattern). Idempotent guard above stops
  // duplicate init when this script loads twice.
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

  window.fbq('init', META_PIXEL_ID);
  window.fbq('track', 'PageView');

  window.__meMetaPixelConfigured = true;

  // Small helper for form/CTA code to fire the standard Lead event without
  // needing to know Pixel details. Usage: window.meTrackLead({ page: '/contact' })
  if (typeof window.meTrackLead !== 'function') {
    window.meTrackLead = function meTrackLead(params) {
      if (typeof window.fbq !== 'function') return;
      window.fbq('track', 'Lead', params || {});
    };
  }

  // noscript fallback pixel — inserted programmatically so it works on browsers
  // that block inline scripts but load external ones (rare, but Meta docs
  // recommend it for full coverage).
  if (document.body && !document.getElementById('me-meta-pixel-noscript')) {
    var img = document.createElement('img');
    img.id = 'me-meta-pixel-noscript';
    img.height = 1;
    img.width = 1;
    img.style.display = 'none';
    img.alt = '';
    img.src = 'https://www.facebook.com/tr?id=' + META_PIXEL_ID + '&ev=PageView&noscript=1';
    document.body.appendChild(img);
  }
})();
