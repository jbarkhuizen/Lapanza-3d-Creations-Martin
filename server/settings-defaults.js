/** Curated Google font pairs / singles for site-wide typography */
export const FONT_OPTIONS = [
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans', google: 'DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700' },
  { id: 'fraunces', label: 'Fraunces', family: 'Fraunces', google: 'Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..800' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', google: 'Space+Grotesk:wght@300..700' },
  { id: 'outfit', label: 'Outfit', family: 'Outfit', google: 'Outfit:wght@300..700' },
  { id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3', google: 'Source+Sans+3:ital,wght@0,300..700;1,300..700' },
  { id: 'libre-franklin', label: 'Libre Franklin', family: 'Libre Franklin', google: 'Libre+Franklin:ital,wght@0,300..700;1,300..700' },
  { id: 'manrope', label: 'Manrope', family: 'Manrope', google: 'Manrope:wght@300..700' },
  { id: 'instrument-serif', label: 'Instrument Serif', family: 'Instrument Serif', google: 'Instrument+Serif:ital@0;1' },
  { id: 'literata', label: 'Literata', family: 'Literata', google: 'Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700' },
  { id: 'playfair', label: 'Playfair Display', family: 'Playfair Display', google: 'Playfair+Display:ital,wght@0,400..700;1,400..700' },
  { id: 'syne', label: 'Syne', family: 'Syne', google: 'Syne:wght@400..700' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', family: 'IBM Plex Sans', google: 'IBM+Plex+Sans:ital,wght@0,300..700;1,300..700' },
];

export const DEFAULT_SETTINGS = {
  siteName: 'Lapanza 3D Creative Lab',
  tagline: 'Custom 3D Printing & SA Filament',
  phoneDisplay: '082 663 9608',
  phoneTel: '+27826639608',
  email: 'lapanzaonline@gmail.com',
  address: '23 Gladiator Rd, Pierre van Ryneveld, Centurion',
  hours: 'By appointment',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  facebook: 'https://www.facebook.com/Lapanzaloeferox',
  instagram: 'https://www.instagram.com/lapanza_beauty_lifestyle/',
  /** When true, one font is used for body + headings */
  useUniversalFont: false,
  universalFont: 'dm-sans',
  fontSans: 'dm-sans',
  fontSerif: 'fraunces',
  /** Default appearance for visitors who haven't chosen yet */
  defaultTheme: 'system',
  /** The 3 "Shop the range" tiles on the homepage — design (colour/rotation/link) stays in index.html, only copy is catalog-driven */
  homeTiles: [
    { eyebrow: '20 types', title: 'Filament', description: 'PLA, PETG, ABS, TPU, PRO CPE and more — real colours, real specs.' },
    { eyebrow: 'GWM · Landrover', title: 'Car Parts', description: 'Custom and replacement 3D printed parts for your vehicle.' },
    { eyebrow: 'Toys · Home · Phones', title: 'Everything Else', description: 'Toys, homeware and phone accessories, printed to order.' },
  ],
};

export function findFont(id) {
  return FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0];
}