(() => {
  const bar = document.querySelector('.nm-mobile-invite');
  if (!bar || !('IntersectionObserver' in window)) return;
  const mobile = window.matchMedia('(max-width: 700px)');
  const targets = document.querySelectorAll('main a[href^="/waitlist/"], footer, [data-waitlist-form]');
  const visible = new Set();
  function update() {
    const menuOpen = [...document.querySelectorAll('.nm-mobile')].some(menu => menu.open);
    bar.hidden = !mobile.matches || window.scrollY < 180 || visible.size > 0 || menuOpen;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    update();
  }, { rootMargin: '0px 0px 100px 0px' });
  targets.forEach(target => observer.observe(target));
  mobile.addEventListener('change', update);
  window.addEventListener('scroll', update, { passive: true });
  document.querySelectorAll('.nm-mobile').forEach(menu => menu.addEventListener('toggle', update));
  update();
})();
