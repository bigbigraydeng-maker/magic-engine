(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reduced.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('main > section:not(:first-child) .nm-reading, main .nm-card, .me-ecosystem-heading').forEach(el => {
      el.classList.add('me-reveal');
      observer.observe(el);
    });
  }
  const hero = document.querySelector('.nm-hero, .nm-cn-hero');
  let frame = 0;
  if (hero && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    hero.addEventListener('pointermove', event => {
      if (reduced.matches || frame) return;
      frame = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        hero.style.setProperty('--glow-x', `${100 * (event.clientX - rect.left) / rect.width}%`);
        hero.style.setProperty('--glow-y', `${100 * (event.clientY - rect.top) / rect.height}%`);
        frame = 0;
      });
    });
  }
})();
