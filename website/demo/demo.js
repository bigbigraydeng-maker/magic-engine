(() => {
  const labels = { overview: 'Growth overview', insights: 'Market discovery', competitors: 'Competitor intelligence', visibility: 'SEO & AI visibility', ads: 'Ads intelligence', content: 'Content studio', social: 'Social media', leads: 'Leads & CRM', actions: 'Actions & approvals', outcomes: 'Outcomes & reports' };

  const activate = (id, options = {}) => {
    if (!labels[id]) return;
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
    document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.view === id));
    document.querySelector('#title').textContent = labels[id];
    if (options.updateHash) history.pushState(null, '', `#${id}`);
    if (options.scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  document.querySelectorAll('[data-view]').forEach(control => {
    control.addEventListener('click', () => {
      activate(control.dataset.view, { updateHash: true, scroll: true });
    });
  });

  window.addEventListener('hashchange', () => activate(location.hash.slice(1) || 'overview'));
  activate(location.hash.slice(1) || 'overview');
})();
