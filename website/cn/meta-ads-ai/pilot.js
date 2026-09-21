(() => {
  const form = document.querySelector('[data-pilot-form]');
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-form-status]');
  const receipt = document.querySelector('[data-pilot-receipt]');

  function value(data, name) {
    return String(data.get(name) || '').trim();
  }

  function buildApplication(data) {
    return [
      `企业角色：${value(data, 'role')}`,
      `主要产品：${value(data, 'product')}`,
      `投放阶段：${value(data, 'adStage')}`,
      `近期数据：${value(data, 'recentData')}`,
      `授权条件：${value(data, 'accessReadiness')}`,
      `当前分析方式：${value(data, 'currentAnalysis')}`,
      `最想弄清的问题：${value(data, 'question')}`,
      `参与方式：${value(data, 'participation')}`,
      `微信：${value(data, 'wechat') || '未填写'}`,
      `方便联系时间：${value(data, 'contactTime') || '未填写'}`,
      `愿意了解其他服务：${data.get('futureContact') === 'yes' ? '是' : '否'}`,
    ].join('\n').slice(0, 1200);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.dataset.state = '';

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const payload = {
      name: value(data, 'name'),
      email: value(data, 'email'),
      company: value(data, 'company'),
      website: value(data, 'website'),
      country: '中国',
      industry: value(data, 'product'),
      targetMarket: value(data, 'targetMarket'),
      platforms: ['Meta (Facebook / Instagram)'],
      budget: value(data, 'adStage'),
      goal: buildApplication(data),
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
      receipt.hidden = false;
      receipt.querySelector('[data-receipt-name]').textContent = payload.name;
      receipt.focus({ preventScroll: true });
      receipt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = '申请尚未确认保存，请稍后重试，或发送邮件至 hello@magicengine.cloud。';
      submitButton.disabled = false;
      submitButton.textContent = '提交申请，加入候补 →';
    }
  });
})();
