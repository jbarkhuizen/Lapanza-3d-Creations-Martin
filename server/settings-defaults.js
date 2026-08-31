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
  hours: 'Mon–Fri 8am–5pm, Sat 8am–12pm',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  // Backlog #78: displayed in the contact area (index.html #contact,
  // get-in-touch.html) alongside `hours` above -- both real figures from
  // the owner (2026-08-28), not invented. Free text, same convention as
  // printLeadTimeDays/filamentDispatchDays, so the owner can update the
  // wording themselves from Settings without needing a code change.
  whatsappResponseNote: 'Usually within a few hours during business hours',
  escalationContactsNote: 'For urgent matters outside normal hours, contact Johan on 082 782 4585 or Linandi on 082 663 9608.',
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
  // Admin picks existing products by productId (same "filament:{slug}:{sku}"
  // / "category:{slug}:{sku}" scheme the cart already uses, see
  // src/js/cart.js) -- NOT typed name/price/link, so a featured item can
  // never go stale: server/export.js's syncPublicJson() re-resolves each one
  // against current catalog data (name, price, a link straight to that
  // item's anchor on its category/filament page) on every publish, same
  // freshness guarantee as everything else on the storefront. A productId
  // that no longer resolves (item deleted) is dropped silently rather than
  // breaking the homepage.
  featuredProducts: [],

  // Phase 3: bank details for the printable invoice (server/index.js's
  // renderInvoiceHtml) -- from the business's own real Absa account.
  bankName: 'Absa',
  bankAccountName: 'J Barkhuizen',
  bankAccountNumber: '404 950 4269',
  bankBranchCode: '632005',
  // Continues the real spreadsheet's existing sequence (last used: INV-0009)
  // rather than starting a fresh, overlapping INV-0001 -- see orders.js's
  // nextInvoiceNumber(). Only used until the very first order/invoice is
  // created here; after that the counter is self-sustaining from orders.
  invoiceNumberSeed: 10,

  // Phase 3: Print Job Costing tool (server/print-jobs.js) -- internal-only,
  // never affects storefront product pricing.
  markupPct: 0,
  electricityRate: 3.85,
  printerPowerDraw: 0.15,
  runningCostsPct: 0.25,
  designRate: 300,
  setupRate: 300,
  postProcessingRate: 300,

  // Phase 4: where owner-facing notifications (new order, new design
  // request) get sent -- separate from LOW_STOCK_ALERT_EMAIL's env-var
  // override since this one's admin-editable, not deploy-time config.
  orderNotificationEmail: 'lapanzaonline@gmail.com',
  // Configurable lists: { id, name, active }[], admin-managed from Settings
  // (§ "Configurable lists" panels). `name` is the value actually stored on
  // records elsewhere (in_house_filament.brand, todo_items.category/
  // priority) -- `id` only exists so the admin UI has a stable key to toggle/
  // edit by, renaming a list entry does NOT retroactively change existing
  // records' stored strings (same as renaming a shipping option never
  // rewrites past orders). `active: false` hides an entry from pickers used
  // to create NEW records, but never hides it from a record that already
  // has it -- a retired brand/category/priority must stay visible on
  // whatever already used it, same reasoning as `filament_colours.listed`.
  inHouseFilamentBrands: [
    { id: 'sunlu', name: 'SunLu', active: true },
    { id: 'sa-filament', name: 'SA Filament', active: true },
    { id: 'build-volume', name: 'Build Volume', active: true },
    { id: 'creality', name: 'Creality', active: true },
  ],
  // Vehicle models a car-parts item can be tagged as fitting -- multi-select,
  // an item stores the matching name strings directly (see server/index.js
  // normalizeItems). Split one list per brand (2026-08-27) rather than one
  // shared list -- GWM (P300/P500/Tank 300/Tank 500/P-Series) and Land
  // Rover's naming don't overlap and a shared list risked tagging a part
  // with the wrong brand's model. `admin.js`'s carPartItemFields() picks
  // the list by the item's own category slug.
  carPartModelsLandrover: [
    { id: 'defender-200-tdi', name: 'Defender 200 Tdi', active: true },
    { id: 'defender-300-tdi', name: 'Defender 300 Tdi', active: true },
    { id: 'defender-td5', name: 'Defender Td5', active: true },
    { id: 'defender-puma', name: 'Defender Puma', active: true },
    { id: 'defender-l663', name: 'Defender L663', active: true },
    { id: 'discovery-1', name: 'Discovery 1', active: true },
    { id: 'discovery-2', name: 'Discovery 2', active: true },
    { id: 'discovery-3', name: 'Discovery 3', active: true },
    { id: 'discovery-4', name: 'Discovery 4', active: true },
    { id: 'freelander-1', name: 'Freelander 1', active: true },
    { id: 'freelander-2', name: 'Freelander 2', active: true },
    { id: 'range-rover-classic', name: 'Range Rover Classic', active: true },
    { id: 'range-rover-p38', name: 'Range Rover P38', active: true },
    { id: 'range-rover-l322', name: 'Range Rover L322', active: true },
    { id: 'range-rover-l405', name: 'Range Rover L405', active: true },
    { id: 'range-rover-sport-l320', name: 'Range Rover Sport L320', active: true },
    { id: 'series-1', name: 'Series 1', active: true },
    { id: 'series-2', name: 'Series 2', active: true },
    { id: 'series-2a', name: 'Series 2A', active: true },
    { id: 'series-3', name: 'Series 3', active: true },
  ],
  carPartModelsGwm: [
    { id: 'p300', name: 'P300', active: true },
    { id: 'p500', name: 'P500', active: true },
    { id: 'tank-300', name: 'Tank 300', active: true },
    { id: 'tank-500', name: 'Tank 500', active: true },
    { id: 'p-series', name: 'P-Series', active: true },
  ],
  todoCategories: [
    { id: 'bug', name: 'Bug', active: true },
    { id: 'feature', name: 'Feature', active: true },
    { id: 'enhancement', name: 'Enhancement', active: true },
    { id: 'tech-debt', name: 'Tech Debt', active: true },
  ],
  // List order doubles as sort order in the Todo/Backlog table (see
  // TODO_PRIORITY_RANK in admin.js) -- reordering here would change sort,
  // but there's no reorder UI yet, only add/toggle-active, so order is
  // fixed at Critical>High>Medium>Low until that's built.
  todoPriorities: [
    { id: 'critical', name: 'Critical', active: true },
    { id: 'high', name: 'High', active: true },
    { id: 'medium', name: 'Medium', active: true },
    { id: 'low', name: 'Low', active: true },
  ],

  // SITE-027: filament colour swatches show "Only N left" instead of a raw
  // stock count once a colour's stockQty drops to or below this -- read by
  // scripts/generate-pages.mjs from the synced src/data/settings.json, not
  // the DB directly (that script has no DB access, only the JSON exports).
  // Distinct from LOW_STOCK_ALERT_EMAIL's owner-notification threshold
  // (hardcoded at <=1 in orders.js) -- this one is customer-facing copy.
  lowStockThreshold: 3,

  // SITE-010: real figures from the business owner (2026-08-27), not
  // invented -- shown on filament/category pages (generate-pages.mjs) and
  // in the cart (cart-ui.js, via /site-settings.json). Free-text strings
  // ("3-5", not a number) since these are ranges, not exact day counts.
  printLeadTimeDays: '3-5',
  filamentDispatchDays: '1-2',

  // Communications: subject + message (the greeting/intro copy) for every
  // branded transactional email server/mailer.js sends, admin-editable from
  // Settings -> Communications. Structural HTML (buttons, order tables,
  // security disclaimers) stays code-controlled in mailer.js/email-
  // template.js -- only wording is editable here, so an admin can't
  // accidentally drop a reset link or a "link expires" disclaimer. {{token}}
  // placeholders get substituted per-send (see interpolate() in
  // email-template.js); each template's available tokens are listed in its
  // comment in mailer.js. Invoice emails and one-off newsletter campaigns
  // aren't here -- they have their own dedicated templates/composer
  // (server/invoice.js, the newsletter campaign UI) since they're either
  // shared with a non-email surface (the printable invoice) or authored
  // fresh per send rather than a fixed reusable template.
  emailTemplates: {
    passwordReset: {
      subject: 'Reset your Lapanza 3D password',
      message: 'We received a request to reset your Lapanza 3D Creative Lab account password. Click the button below to choose a new one.',
    },
    emailVerification: {
      subject: 'Verify your email — Lapanza 3D',
      message: "Thanks for creating an account with Lapanza 3D Creative Lab. Confirm your email address to finish setting it up.",
    },
    orderConfirmation: {
      subject: 'Order confirmation {{orderRef}} — Lapanza 3D',
      message: "Thanks for your order from Lapanza 3D Creative Lab! Here's a summary of what you ordered.",
    },
    orderShipped: {
      subject: 'Your order {{orderRef}} is on its way — Lapanza 3D',
      message: 'Good news — your order has been handed to the courier. You can track it with the tracking number below.',
    },
    designRequestStatus: {
      subject: 'Your design request is now {{status}} — Lapanza 3D',
      message: 'Your custom design request has been updated to: {{status}}.',
    },
    newsletterConfirm: {
      subject: 'Confirm your newsletter signup — Lapanza 3D',
      message: 'Thanks for signing up to hear from Lapanza 3D Creative Lab! Confirm your subscription below.',
    },
    lowStockAlert: {
      subject: 'Low stock: {{itemName}} ({{stockQty}} left)',
      message: '{{itemName}} is running low on stock.',
    },
    newOrderNotification: {
      subject: 'New order {{orderRef}} — {{total}}',
      message: 'A new order has been placed.',
    },
    orderCancelledNotification: {
      subject: 'Order cancelled: {{orderRef}}',
      message: 'An order was cancelled.',
    },
    newDesignRequestNotification: {
      subject: 'New design request from {{name}}',
      message: 'A new custom design request has been submitted.',
    },
  },

  // Backlog #120: operational alerts (server/alerts.js) -- backup/payment/
  // checkout failures and security-signal spikes were previously console-
  // only or, at best, an audit_log row nobody proactively checks. Each
  // failure class has its own on/off switch since some sites may want
  // payment-failure alerts but not security-spike ones, etc. Alert wording
  // itself is fixed/code-authored, NOT here -- these only control
  // whether/how sensitively an alert fires. Email alerts go to the existing
  // `orderNotificationEmail`, not a separate address, matching every other
  // owner-facing notification in this project.
  alertBackupFailureEnabled: true,
  alertPaymentFailureEnabled: true,
  alertCheckoutErrorEnabled: true,
  // Email-delivery-down fallback: if Gmail itself is broken, an email ABOUT
  // Gmail being broken never arrives -- this falls back to WhatsApp once
  // `alertEmailFallbackThreshold` sends fail within an hour. Requires a
  // Meta-approved WhatsApp template (business-initiated messages can't be
  // free text, see server/whatsapp.js) -- degrades to a console.error until
  // both the template name and WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID
  // (env, server-side only) are actually configured.
  alertEmailFallbackEnabled: true,
  alertEmailFallbackThreshold: 3,
  alertEmailFallbackWhatsappNumber: '',
  alertEmailFallbackWhatsappTemplateName: '',
  // Security-signal burst detection (rate_limit_exceeded/unauthorized_access/
  // client_login_failure) -- a single one of any of these is normal
  // background noise; a burst within the window below is the actual signal.
  alertSecuritySpikeEnabled: true,
  alertSecuritySpikeThreshold: 10,
  alertSecuritySpikeWindowMinutes: 15,
};

export function findFont(id) {
  return FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0];
}