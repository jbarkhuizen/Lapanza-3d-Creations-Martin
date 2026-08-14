const THEME_KEY = 'lapanza-theme';

const FONT_CATALOG = {
  'dm-sans': { family: 'DM Sans', google: 'DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700' },
  fraunces: { family: 'Fraunces', google: 'Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..800' },
  'space-grotesk': { family: 'Space Grotesk', google: 'Space+Grotesk:wght@300..700' },
  outfit: { family: 'Outfit', google: 'Outfit:wght@300..700' },
  'source-sans-3': { family: 'Source Sans 3', google: 'Source+Sans+3:ital,wght@0,300..700;1,300..700' },
  'libre-franklin': { family: 'Libre Franklin', google: 'Libre+Franklin:ital,wght@0,300..700;1,300..700' },
  manrope: { family: 'Manrope', google: 'Manrope:wght@300..700' },
  'instrument-serif': { family: 'Instrument Serif', google: 'Instrument+Serif:ital@0;1' },
  literata: { family: 'Literata', google: 'Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700' },
  playfair: { family: 'Playfair Display', google: 'Playfair+Display:ital,wght@0,400..700;1,400..700' },
  syne: { family: 'Syne', google: 'Syne:wght@400..700' },
  'ibm-plex-sans': { family: 'IBM Plex Sans', google: 'IBM+Plex+Sans:ital,wght@0,300..700;1,300..700' },
};

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preferred) {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (preferred === 'light' || preferred === 'dark') return preferred;
  return systemTheme();
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#14110f' : '#f7f3eb';
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = next === 'dark' ? 'Light mode' : 'Dark mode';
  });
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  return next;
}

function loadGoogleFonts(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const families = unique.map((id) => FONT_CATALOG[id]?.google).filter(Boolean);
  if (!families.length) return;

  const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
  let link = document.getElementById('site-dynamic-fonts');
  if (!link) {
    link = document.createElement('link');
    link.id = 'site-dynamic-fonts';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = href;
}

export function applyFonts(settings = {}) {
  const useUniversal = Boolean(settings.useUniversalFont);
  const universal = settings.universalFont || 'dm-sans';
  const sansId = useUniversal ? universal : settings.fontSans || 'dm-sans';
  const serifId = useUniversal ? universal : settings.fontSerif || 'fraunces';
  const sans = FONT_CATALOG[sansId] || FONT_CATALOG['dm-sans'];
  const serif = FONT_CATALOG[serifId] || FONT_CATALOG.fraunces;

  loadGoogleFonts([sansId, serifId]);
  document.documentElement.style.setProperty('--font-sans', `"${sans.family}", ui-sans-serif, system-ui, sans-serif`);
  document.documentElement.style.setProperty('--font-serif', `"${serif.family}", ui-serif, Georgia, serif`);
  document.documentElement.classList.toggle('font-universal', useUniversal);
}

export async function initAppearance() {
  let settings = {
    useUniversalFont: false,
    universalFont: 'dm-sans',
    fontSans: 'dm-sans',
    fontSerif: 'fraunces',
    defaultTheme: 'system',
  };

  try {
    const res = await fetch('/site-settings.json', { cache: 'no-store' });
    if (res.ok) settings = { ...settings, ...(await res.json()) };
  } catch {
    /* defaults */
  }

  applyFonts(settings);
  applyTheme(resolveTheme(settings.defaultTheme));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(resolveTheme(settings.defaultTheme));
    }
  });
}
