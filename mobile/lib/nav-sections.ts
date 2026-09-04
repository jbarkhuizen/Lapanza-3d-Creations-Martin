// Mirrors the three sidebar groups in admin/index.html so the mobile Menu
// tab reads as the same product as the desktop admin portal.

export type NavSection = {
  title: string;
  route: string;
  // Ionicons glyph name — kept as `string` rather than importing Ionicons'
  // glyph-map type here, since this module has no other reason to depend
  // on @expo/vector-icons.
  icon: string;
};

export type NavGroup = {
  title: string;
  items: NavSection[];
};

export const navGroups: NavGroup[] = [
  {
    title: 'Client Side',
    items: [
      { title: 'Analytics', route: '/analytics', icon: 'stats-chart-outline' },
      { title: 'Products', route: '/products', icon: 'cube-outline' },
      { title: 'Orders', route: '/orders', icon: 'receipt-outline' },
      { title: 'Clients', route: '/clients', icon: 'people-outline' },
      { title: 'Registered Users', route: '/users', icon: 'person-outline' },
      { title: 'Design Requests', route: '/design-requests', icon: 'color-palette-outline' },
      { title: 'Invoice History', route: '/invoices', icon: 'document-text-outline' },
      { title: '3D Resources', route: '/resources', icon: 'layers-outline' },
      { title: 'Testimonials', route: '/testimonials', icon: 'chatbubble-ellipses-outline' },
      { title: 'Shipping Options', route: '/shipping', icon: 'car-outline' },
      { title: 'Promo Codes', route: '/promo-codes', icon: 'pricetag-outline' },
      { title: 'Newsletter', route: '/newsletter', icon: 'mail-outline' },
      { title: 'Potential Market', route: '/potential-market', icon: 'trending-up-outline' },
      { title: 'WhatsApp Updates', route: '/whatsapp', icon: 'logo-whatsapp' },
    ],
  },
  {
    title: 'Local Management',
    items: [
      { title: 'Stock Management', route: '/stock', icon: 'cube-outline' },
      { title: 'In-House Filament', route: '/filament', icon: 'color-filter-outline' },
      { title: 'Print Job Costing', route: '/print-jobs', icon: 'calculator-outline' },
      { title: 'Purchase History', route: '/purchases', icon: 'cart-outline' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { title: 'Backups', route: '/backups', icon: 'cloud-download-outline' },
      { title: 'Version History', route: '/version-history', icon: 'time-outline' },
      { title: 'Audit Logs', route: '/audit-log', icon: 'shield-checkmark-outline' },
      { title: 'Site Settings', route: '/site-settings', icon: 'settings-outline' },
    ],
  },
];
