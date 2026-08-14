import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';

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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = new FormData(form).get('email');
      const note = document.getElementById('newsletter-note');
      if (note) {
        note.textContent = email
          ? `Thanks — we'll be in touch at ${email}. Prefer WhatsApp for faster replies.`
          : "Thanks — we'll be in touch.";
      }
      form.reset();
    });
  }

  initHeroScene(reduce);
}

function initHeroScene(reduceMotion) {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const heroSection = canvas.closest('section');
  let width = heroSection.clientWidth;
  let height = heroSection.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(0, 0.15, 7.2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene.add(new THREE.AmbientLight(0xf2ece1, 0.55));
  const key = new THREE.DirectionalLight(0xc24b28, 1.25);
  key.position.set(4.2, 3.2, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf7f3eb, 0.45);
  fill.position.set(-3, 1.5, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe4f35a, 0.75);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  const group = new THREE.Group();
  const layerCount = 16;
  const layerMat = new THREE.MeshStandardMaterial({
    color: 0xf7f3eb,
    metalness: 0.42,
    roughness: 0.42,
    transparent: true,
    opacity: 0.94,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xc24b28,
    metalness: 0.55,
    roughness: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xc24b28,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
  });

  for (let i = 0; i < layerCount; i++) {
    const t = i / (layerCount - 1);
    const radius = 1.05 + Math.sin(t * Math.PI) * 0.42;
    const geo = new THREE.TorusGeometry(radius, i % 5 === 0 ? 0.055 : 0.038, 12, 64);
    const mesh = new THREE.Mesh(geo, i % 5 === 0 ? accentMat : layerMat);
    mesh.position.y = (t - 0.5) * 3.4;
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = t * 0.75;
    group.add(mesh);
  }

  const wireMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.05, 1), wireMat);
  group.add(wireMesh);
  group.rotation.x = 0.18;
  group.position.y = 0.1;
  scene.add(group);

  function resize() {
    width = heroSection.clientWidth;
    height = heroSection.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);

  let scrollProgress = 0;
  if (!reduceMotion) {
    ScrollTrigger.create({
      trigger: heroSection,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        scrollProgress = self.progress;
      },
    });
  }

  const clock = new THREE.Clock();
  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    if (!reduceMotion) {
      group.rotation.y = elapsed * 0.14 + scrollProgress * 1.55;
      group.rotation.z = Math.sin(elapsed * 0.2) * 0.04;
      wireMesh.rotation.y = -elapsed * 0.09;
      wireMesh.rotation.x = elapsed * 0.05;
      camera.position.y = 0.15 + scrollProgress * -1.35;
      camera.position.z = 7.2 - scrollProgress * 0.8;
      key.intensity = 1.05 + scrollProgress * 0.55;
    }
    renderer.render(scene, camera);
  }
  animate();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(frame);
    else animate();
  });
}
