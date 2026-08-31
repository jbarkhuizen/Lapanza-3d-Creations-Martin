import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initHomeMotion() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) document.documentElement.classList.add('js-motion');

  if (!reduce) {
    const heroLines = gsap.utils.toArray('.hero-line');
    if (heroLines.length) {
      gsap.to(heroLines, {
        opacity: 1,
        y: 0,
        duration: 1.05,
        stagger: 0.12,
        ease: 'power3.out',
        delay: 0.15,
      });
    }

    document.querySelectorAll('.fade-up').forEach((el) => {
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 82%',
          toggleActions: 'play none none reverse',
        },
      });
    });

    gsap.utils.toArray('.reveal-head').forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y: 24,
        duration: 0.85,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          toggleActions: 'play none none reverse',
        },
      });
    });

    gsap.utils.toArray('.tile').forEach((card, i) => {
      gsap.from(card, {
        opacity: 0,
        y: 40,
        rotate: i % 2 === 0 ? -2 : 2,
        duration: 0.85,
        delay: i * 0.1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: card,
          start: 'top 90%',
          toggleActions: 'play none none reverse',
        },
      });
    });

    const btn = document.getElementById('magnetic-cta');
    if (btn) {
      const strength = 28;
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const relX = e.clientX - rect.left - rect.width / 2;
        const relY = e.clientY - rect.top - rect.height / 2;
        xTo((relX / rect.width) * strength);
        yTo((relY / rect.height) * strength);
      });
      btn.addEventListener('mouseleave', () => {
        xTo(0);
        yTo(0);
      });
    }
  } else {
    document.querySelectorAll('.fade-up, .hero-line').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  const form = document.getElementById('newsletter-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = new FormData(form).get('email');
      const note = document.getElementById('newsletter-note');
      try {
        const res = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Something went wrong');
        if (note) note.textContent = data.message || "Thanks — we'll be in touch.";
        form.reset();
      } catch (err) {
        if (note) note.textContent = err.message || 'Something went wrong — please try again.';
      }
    });
  }

}
