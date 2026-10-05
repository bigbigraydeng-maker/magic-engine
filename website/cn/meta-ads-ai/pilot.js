(() => {
  const form = document.querySelector('[data-pilot-form]');
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-form-status]');
  const receipt = document.querySelector('[data-pilot-receipt]');

  function value(data, name) {
    return String(data.get(name) || '').trim();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.dataset.state = '';

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const tool = value(data, 'tool');
    const question = value(data, 'question');
    const payload = {
      formType: 'meta_ads_ai_pilot',
      name: value(data, 'name'),
      email: value(data, 'email'),
      company: value(data, 'company'),
      website: '',
      country: value(data, 'market'),
      industry: '工具实验室：' + tool,
      targetMarket: '未询问（轻量表单）',
      platforms: ['Meta (Facebook / Instagram)'],
      budget: '未询问（轻量表单）',
      goal: `想用的工具：${tool}\n需求：${question}`.slice(0, 1200),
      companyWebsite: value(data, 'companyWebsite'),
      consent: data.get('consent') === 'yes',
    };

    submitButton.disabled = true;
    submitButton.textContent = '正在提交…';

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '提交失败');

      form.reset();
      form.hidden = true;
      if (receipt) {
        receipt.hidden = false;
        const nameEl = receipt.querySelector('[data-receipt-name]');
        if (nameEl) nameEl.textContent = payload.name;
        receipt.focus({ preventScroll: true });
        receipt.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = '没有保存成功，请稍后再试，或写信到 hello@magicengine.cloud。';
      submitButton.disabled = false;
      submitButton.textContent = '提交';
    }
  });
})();
