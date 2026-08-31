import filaments from '../data/filaments.json';
import siteSettings from '../data/settings.json';

export const SITE = {
  name: 'Lapanza 3D Creative Lab',
  shortName: 'Lapanza',
  tagline: 'Custom 3D Printing & SA Filament',
  phoneDisplay: '082 663 9608',
  phoneTel: '+27826639608',
  email: 'lapanzaonline@gmail.com',
  address: '23 Gladiator Rd, Pierre van Ryneveld, Centurion',
  hours: 'By appointment',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  social: {
    facebook: 'https://www.facebook.com/profile.php?id=61591435717039',
    instagram: 'https://www.instagram.com/lapanza_beauty_lifestyle/',
  },
  year: 2026,
};

/** Approximate swatch colours for catalogue cards */
export const COLOUR_MAP = {
  white: '#f4f1ea',
  'cool white': '#eef2f6',
  black: '#1a1714',
  grey: '#8a8680',
  gray: '#8a8680',
  silver: '#c5c8cc',
  'clear (natural)': '#e8e4d8',
  clear: '#e8e4d8',
  natural: '#e8e4d8',
  blue: '#2f5f9e',
  red: '#b53a2e',
  yellow: '#e6c84a',
  green: '#4f7a45',
  orange: '#d97a2e',
  purple: '#6b4d8a',
  pink: '#d4849a',
  brown: '#6b4a32',
  gold: '#c6a34e',
  copper: '#a85c32',
  turquoise: '#3d9b9b',
  teal: '#2f6f6f',
  neon: '#dff25c',
  lime: '#b8d84a',
  transparent: '#e8e4d8',
  ivory: '#f3ead6',
  bone: '#e8dfc8',
  charcoal: '#2c2926',
  navy: '#1f3358',
  magenta: '#a8326e',
  cyan: '#3a9bb5',
};

export function colourHex(name) {
  if (!name) return '#d6d0c4';
  const key = name.toLowerCase().trim();
  if (COLOUR_MAP[key]) return COLOUR_MAP[key];
  for (const [k, v] of Object.entries(COLOUR_MAP)) {
    if (key.includes(k)) return v;
  }
  return '#d6d0c4';
}

/** Built from catalog so admin-published filaments appear in the sidebar */
export const FILAMENT_NAV = filaments.map((f) => ({
  slug: f.slug,
  label: f.name,
}));

// #130: car-part brands for the sidebar nav -- bundled from the synced
// settings export at build time (a publish rebuilds, same freshness as
// FILAMENT_NAV above). Falls back to the two founding brands when the
// export predates the setting.
const rawBrands = Array.isArray(siteSettings.carPartBrands) && siteSettings.carPartBrands.length
  ? siteSettings.carPartBrands.filter((b) => b && b.active !== false && b.name)
  : [{ name: 'GWM' }, { name: 'Landrover' }];
export const CAR_BRANDS_NAV = rawBrands.map((b) => ({
  slug: String(b.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  label: b.name,
}));
