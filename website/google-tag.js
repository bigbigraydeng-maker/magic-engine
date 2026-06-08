(function initGoogleAdsTag() {
  var GOOGLE_ADS_ID = 'AW-18192230281';

  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  if (!document.querySelector('script[data-google-tag-id="' + GOOGLE_ADS_ID + '"]')) {
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GOOGLE_ADS_ID;
    script.setAttribute('data-google-tag-id', GOOGLE_ADS_ID);
    document.head.appendChild(script);
  }

  if (!window.__meGoogleAdsConfigured) {
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_ID);
    window.__meGoogleAdsConfigured = true;
  }
})();
