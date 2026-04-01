// Smooth page transitions — opacity fade only (no transform, preserves fixed nav)
(function() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes _pgIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .page-container {
      animation: _pgIn 0.3s ease both;
    }
  `;
  document.head.appendChild(style);

  function goTo(href) {
    const pc = document.querySelector('.page-container');
    if (pc) {
      pc.style.transition = 'opacity 0.18s ease';
      pc.style.opacity = '0';
    }
    setTimeout(() => { window.location.href = href; }, 190);
  }
  window.navigateTo = goTo;

  // Fix back button (bfcache restore) — reset opacity
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) {
      const pc = document.querySelector('.page-container');
      if (pc) {
        pc.style.transition = '';
        pc.style.opacity = '';
        pc.style.animation = 'none';
        requestAnimationFrame(() => { pc.style.animation = ''; });
      }
    }
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('http') || href.startsWith('javascript') || link.getAttribute('target') === '_blank' || link.hasAttribute('data-no-transition')) return;
    if (link.getAttribute('onclick')) return;
    e.preventDefault();
    goTo(href);
  });
})();
