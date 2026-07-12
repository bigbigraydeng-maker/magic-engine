(function initMetaPixel() {
  // Set to the numeric Pixel ID from Meta Events Manager once created.
  // Kept as a placeholder until the ID is known; the loader no-ops in that
  // state so the Cloudflare deploy is safe to ship immediately.
  var PIXEL_ID = 'PIXEL_ID_PENDING';

  if (!PIXEL_ID || PIXEL_ID === 'PIXEL_ID_PENDING') {
    return;
  }

  // Meta Pixel base — self-loading fbevents.js, same shape as the snippet
  // Meta Events Manager hands out. Wrapped in a guard so a stray second
  // include won't double-initialise the queue.
  if (typeof window.fbq !== 'function') {
    (function (f, b, e, v, n, t, s) {
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
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  if (!window.__meMetaPixelInit) {
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
    window.__meMetaPixelInit = true;
  }

  // Lead event tracking. Fires when the visitor submits any of the site's
  // three conversion forms — the URL diagnosis on index.html and cn.html, and
  // the discover-form / email-form on discover.html. The submitted input
  // value is passed as content_name so Meta Ads audiences can slice by intent
  // (which URL the visitor asked us to diagnose).
  var LEAD_FORM_IDS = ['hero-url-form', 'discover-form', 'email-form'];

  function attachLeadTracking() {
    LEAD_FORM_IDS.forEach(function (formId) {
      var form = document.getElementById(formId);
      if (!form || form.__meLeadTracked) return;
      form.__meLeadTracked = true;
      form.addEventListener('submit', function () {
        var primaryInput = form.querySelector(
          'input[type="url"], input[type="email"], input[type="text"]'
        );
        window.fbq('track', 'Lead', {
          content_name: primaryInput ? primaryInput.value : formId,
          content_category: formId,
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLeadTracking);
  } else {
    attachLeadTracking();
  }
})();
