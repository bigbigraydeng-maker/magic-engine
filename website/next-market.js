(() => {
  const mobileMenus = document.querySelectorAll('.nm-mobile');

  for (const menu of mobileMenus) {
    for (const link of menu.querySelectorAll('a')) {
      link.addEventListener('click', () => {
        menu.open = false;
      });
    }
  }

  const form = document.querySelector('[data-waitlist-form]');
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-form-status]');

  function showWelcome(payload) {
    const welcome = document.querySelector('[data-welcome]');
    if (!welcome) return;
    for (const field of ['name', 'company', 'country']) {
      welcome.querySelector(`[data-welcome-${field}]`).textContent = payload[field].trim();
    }
    welcome.querySelector('[data-welcome-target]').textContent = payload.targetMarket.trim();
    for (const section of document.querySelectorAll('main > section')) {
      section.hidden = section !== welcome;
    }
    for (const link of document.querySelectorAll('a[href="#apply"]')) {
      link.href = '/insights/';
      link.textContent = 'Explore insights';
    }
    document.title = 'Application received — Magic Engine';
    // Keep submitted details in this page only, never in the URL or storage.
    document.getElementById('welcome-title').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.dataset.state = '';

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    if (!data.getAll('platforms').length) {
      status.dataset.state = 'error';
      status.textContent = 'Please select at least one marketing platform.';
      form.querySelector('input[name="platforms"]')?.focus();
      return;
    }

    const payload = {
      name: data.get('name'),
      email: data.get('email'),
      company: data.get('company'),
      website: data.get('website'),
      country: data.get('country'),
      industry: data.get('industry'),
      targetMarket: data.get('targetMarket'),
      platforms: data.getAll('platforms'),
      budget: data.get('budget'),
      goal: data.get('goal'),
      companyWebsite: data.get('companyWebsite'),
      consent: data.get('consent') === 'yes',
    };

    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Submission failed.');

      form.reset();
      status.dataset.state = 'success';
      status.textContent = 'Thank you. Your application is in — we will review it and contact you directly if there is a strong fit.';
      submitButton.textContent = 'Application received';
      showWelcome(payload);
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message || 'We could not submit your application. Please try again or email hello@magicengine.cloud.';
      submitButton.disabled = false;
      submitButton.textContent = 'Submit application →';
    }
  });
})();
