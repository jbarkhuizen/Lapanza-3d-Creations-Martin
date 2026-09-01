// #95: dot/thumbnail sync for the CSS-scroll-snap photo carousel emitted by
// generate-pages.mjs's productGalleryHtml(). The swipe/drag itself is pure
// CSS (scroll-snap-type on .gallery-track) -- this only keeps the dots in
// sync via IntersectionObserver (no manual touch/pointer tracking) and
// handles dot/thumbnail clicks. Self-initializing: scans the whole document
// on load, so it works on every generated page (card carousels AND detail
// pages) with zero per-page wiring, same convention as cart-ui.js's
// delegated add-to-cart listener.
function initGallery(root) {
  const track = root.querySelector('.gallery-track');
  const slides = [...root.querySelectorAll('.gallery-slide')];
  const dots = [...root.querySelectorAll('.gallery-dot')];
  const thumbs = [...root.querySelectorAll('.gallery-thumb-btn')];
  if (!track || slides.length < 2) return; // single-photo gallery has no dots/thumbs to sync

  const setActive = (index) => {
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
  };
  setActive(0);

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((e) => e.isIntersecting);
      if (!visible) return;
      const index = Number(visible.target.dataset.gallerySlide);
      setActive(index);
    },
    { root: track, threshold: 0.6 },
  );
  slides.forEach((s) => observer.observe(s));

  dots.forEach((dot) => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      const index = Number(dot.dataset.galleryDot);
      slides[index]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
  });
  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', (e) => {
      e.preventDefault();
      const index = Number(thumb.dataset.galleryThumb);
      slides[index]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
  });
}

function initAllGalleries() {
  document.querySelectorAll('[data-gallery]').forEach(initGallery);
}

document.addEventListener('DOMContentLoaded', initAllGalleries);
