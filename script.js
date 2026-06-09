// ── NAV BURGER ──
const burger = document.getElementById('navBurger');
const menu   = document.getElementById('navMenu');

burger.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open);
});

menu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    menu.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  });
});

// Offset anchor targets so the fixed nav doesn't cover them
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const navH = document.getElementById('nav').getBoundingClientRect().height;
    const top  = target.getBoundingClientRect().top + window.scrollY - navH - 8;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

// ── ACCORDION ──
document.querySelectorAll('.accordion__trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item   = trigger.closest('.accordion__item');
    const body   = item.querySelector('.accordion__body');
    const isOpen = item.classList.contains('open') || item.classList.contains('accordion__item--open');

    // Collapse all
    document.querySelectorAll('.accordion__item').forEach(i => {
      i.classList.remove('open', 'accordion__item--open');
      i.querySelector('.accordion__body').style.display = 'none';
      i.querySelector('.accordion__trigger').setAttribute('aria-expanded', 'false');
    });

    // If it was closed, open it
    if (!isOpen) {
      item.classList.add('open');
      body.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
    }
  });
});

// ── DATO COUNTERS ──
const counterEls = document.querySelectorAll('.dato__number[data-target]');

const runCounter = (el, target, duration = 750) => {
  const start = performance.now();
  const tick = now => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(target * eased).toLocaleString('es-CO');
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const datosGrid = document.querySelector('.datos-clave__grid');
if (datosGrid) {
  new IntersectionObserver((entries, obs) => {
    if (entries[0].isIntersecting) {
      counterEls.forEach(el => runCounter(el, +el.dataset.target));
      obs.disconnect();
    }
  }, { threshold: 0.3 }).observe(datosGrid);
}

// ── FLIP CARDS ──
// On touch devices hover doesn't fire, so we toggle a class on click/tap.
// On pointer devices with hover (desktop), CSS :hover handles it;
// click still toggles for users who prefer click.
document.querySelectorAll('.flip-card').forEach(card => {
  let startX, startY;

  card.addEventListener('pointerdown', e => {
    startX = e.clientX;
    startY = e.clientY;
  });

  card.addEventListener('pointerup', e => {
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx < 8 && dy < 8) {           // tap/click, not scroll
      card.classList.toggle('flipped');
    }
  });

  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.classList.toggle('flipped');
    }
  });
});
