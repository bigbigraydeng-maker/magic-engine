/**
 * Website measurement bootstrap — Google Ads + GA4 + Consent Mode v2.
 *
 * Consent is resolved here because this file is loaded before meta-pixel.js on
 * every static website page. Meta listens for the shared `me:consent-change`
 * event and does not load until marketing consent is granted.
 */
(function initWebsiteMeasurement() {
  var GOOGLE_ADS_ID = 'AW-18192230281';
  var GA4_MEASUREMENT_ID = 'G-4JL29VZ1L4';
  var CONSENT_STORAGE_KEY = 'me_cookie_consent_v1';
  var VALID_CHOICES = { granted: true, denied: true };

  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  function readConsent() {
    try {
      var value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      return VALID_CHOICES[value] ? value : null;
    } catch (error) {
      return null;
    }
  }

  function googleConsentState(choice) {
    var granted = choice === 'granted' ? 'granted' : 'denied';
    return {
      analytics_storage: granted,
      ad_storage: granted,
      ad_user_data: granted,
      ad_personalization: granted
    };
  }

  // Default-denied must be queued before either Google tag is requested.
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  var initialChoice = readConsent();
  if (initialChoice) {
    window.gtag('consent', 'update', googleConsentState(initialChoice));
  }

  function announceConsent(choice) {
    window.dispatchEvent(new CustomEvent('me:consent-change', {
      detail: { marketing: choice === 'granted', choice: choice }
    }));
  }

  function setConsent(choice) {
    if (!VALID_CHOICES[choice]) return;

    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    } catch (error) {
      // Consent still applies to this page when storage is unavailable.
    }

    window.gtag('consent', 'update', googleConsentState(choice));
    announceConsent(choice);
    renderConsentUi(false);
  }

  window.meConsent = {
    get: readConsent,
    hasMarketingConsent: function hasMarketingConsent() {
      return readConsent() === 'granted';
    },
    set: setConsent,
    reopen: function reopenConsent() {
      renderConsentUi(true);
    }
  };

  function renderConsentUi(forceOpen) {
    if (!document.body) return;

    var isChinese = document.documentElement.lang.toLowerCase().indexOf('zh') === 0 ||
      window.location.pathname.indexOf('/cn/') === 0;
    var banner = document.getElementById('me-consent-banner');
    var manage = document.getElementById('me-consent-manage');
    var shouldShow = forceOpen || !readConsent();

    if (!banner) {
      var style = document.createElement('style');
      style.id = 'me-consent-style';
      style.textContent =
        '#me-consent-banner{position:fixed;left:50%;bottom:18px;z-index:2147483000;width:min(720px,calc(100% - 28px));transform:translateX(-50%);padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(13,15,20,.96);box-shadow:0 20px 70px rgba(0,0,0,.42);color:#f7f7f8;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;backdrop-filter:blur(18px)}' +
        '#me-consent-banner[hidden]{display:none}#me-consent-banner p{margin:0 0 14px;color:#d7d9df}#me-consent-banner a{color:#9ed0ff}' +
        '#me-consent-actions{display:flex;gap:10px;flex-wrap:wrap}#me-consent-actions button,#me-consent-manage{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:9px 15px;font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}' +
        '#me-consent-accept{background:#f3f7ff;color:#10131a}#me-consent-reject{background:transparent;color:#fff}' +
        '#me-consent-manage{position:fixed;left:14px;bottom:14px;z-index:2147482999;background:rgba(13,15,20,.88);color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.25)}' +
        '@media(max-width:560px){#me-consent-banner{bottom:10px;padding:16px}#me-consent-actions button{flex:1}#me-consent-manage{left:10px;bottom:10px}}';
      document.head.appendChild(style);

      banner = document.createElement('section');
      banner.id = 'me-consent-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-modal', 'false');
      banner.setAttribute('aria-label', isChinese ? 'Cookie 设置' : 'Cookie choices');
      banner.innerHTML =
        '<p>' +
        (isChinese
          ? '我们使用分析与广告 Cookie 衡量网站效果。你可以接受或拒绝非必要追踪，之后也能随时修改。'
          : 'We use analytics and advertising cookies to measure website performance. You can accept or reject non-essential tracking and change your choice later.') +
        ' <a href="' + (isChinese ? '/cn/privacy' : '/privacy') + '">' +
        (isChinese ? '隐私政策' : 'Privacy policy') + '</a></p>' +
        '<div id="me-consent-actions">' +
        '<button id="me-consent-accept" type="button">' + (isChinese ? '接受' : 'Accept') + '</button>' +
        '<button id="me-consent-reject" type="button">' + (isChinese ? '拒绝非必要项' : 'Reject non-essential') + '</button>' +
        '</div>';
      document.body.appendChild(banner);

      banner.querySelector('#me-consent-accept').addEventListener('click', function () {
        setConsent('granted');
      });
      banner.querySelector('#me-consent-reject').addEventListener('click', function () {
        setConsent('denied');
      });
    }

    if (!manage) {
      manage = document.createElement('button');
      manage.id = 'me-consent-manage';
      manage.type = 'button';
      manage.textContent = isChinese ? '隐私设置' : 'Privacy choices';
      manage.setAttribute('aria-controls', 'me-consent-banner');
      manage.addEventListener('click', function () {
        renderConsentUi(true);
      });
      document.body.appendChild(manage);
    }

    banner.hidden = !shouldShow;
    manage.hidden = shouldShow;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      renderConsentUi(false);
    }, { once: true });
  } else {
    renderConsentUi(false);
  }

  function loadGoogleTag(id) {
    if (document.querySelector('script[data-google-tag-id="' + id + '"]')) return;
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    script.setAttribute('data-google-tag-id', id);
    document.head.appendChild(script);
  }

  loadGoogleTag(GOOGLE_ADS_ID);
  loadGoogleTag(GA4_MEASUREMENT_ID);

  window.gtag('js', new Date());

  if (!window.__meGoogleAdsConfigured) {
    window.gtag('config', GOOGLE_ADS_ID);
    window.__meGoogleAdsConfigured = true;
  }

  if (!window.__meGa4Configured) {
    window.gtag('config', GA4_MEASUREMENT_ID);
    window.__meGa4Configured = true;
  }
})();