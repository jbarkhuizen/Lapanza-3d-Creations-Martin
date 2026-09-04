// Shapes mirror the camelCase objects server/*.js hands back over JSON
// (see rowToOrder/rowToItem in server/orders.js, etc.) — not the sqlite
// column names.

export type OrderStatus = 'pending_payment' | 'paid' | 'shipped' | 'completed' | 'cancelled';

export type OrderClientRef = { name: string; email: string; clientCode?: string } | null;

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  weight: number;
};

export type Order = {
  id: string;
  invoiceNumber: string;
  clientId: string;
  status: OrderStatus;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  promoCode: string;
  promoDiscountAmount: number;
  shippingOptionId: string | null;
  shippingPrice: number;
  shippingMethod: string;
  total: number;
  totalWeight: number;
  paymentMethod: string;
  paymentStatus: string;
  trackingNumber: string;
  collectedAt: string | null;
  confirmationEmailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: OrderClientRef;
  items?: OrderItem[];
  shippingOption?: unknown;
  transactions?: unknown[];
};

export type Client = {
  id: string;
  clientCode: string;
  name: string;
  email: string;
  phone?: string;
  city?: string;
  hasAccount: boolean;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
  [key: string]: unknown;
};

export type DashboardSummary = {
  updatedAt: string;
  totals: {
    products: number;
    filaments: number;
    categories: number;
    colours: number;
    catalogItems: number;
    published: number;
    drafts: number;
  };
  recent: Array<{ id: string; name: string; kind: string; status: string; updatedAt: string; slug: string }>;
};

export type Resource = {
  id: string;
  title: string;
  description: string;
  imagePath: string | null;
  imageOriginalName: string | null;
  filePath: string | null;
  fileOriginalName: string | null;
  printSettings: string;
  filamentType: string;
  dimensions: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TestimonialStatus = 'draft' | 'published';

export type Testimonial = {
  id: string;
  customerName: string;
  displayName: string;
  consentGiven: boolean;
  consentNote: string;
  testimonialDate: string | null;
  quote: string;
  linkUrl: string | null;
  linkLabel: string | null;
  imagePath: string | null;
  status: TestimonialStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ShippingOptionType = 'auto_weight' | 'fixed';

export type ShippingOption = {
  id: string;
  name: string;
  optionType: ShippingOptionType;
  minWeight: number;
  maxWeight: number | null;
  price: number;
  active: boolean;
  category: string;
  createdAt: string;
  updatedAt: string;
};

export type PromoKind = 'percent' | 'fixed';

export type PromoCode = {
  id: string;
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotal: number;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewsletterCampaignStatus = 'draft' | 'approved' | 'sending' | 'partial' | 'sent';

export type NewsletterCampaign = {
  id: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  status: NewsletterCampaignStatus;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  sentCount: number;
  failedCount: number;
  selectedCount: number;
  recipientStatusCounts: Record<string, number>;
};

export type PotentialMarketStatus = 'Initial Load' | 'Active' | 'Inactive' | 'Opt Out';

export type PotentialMarketContact = {
  id: string;
  name: string;
  surname: string;
  email: string;
  mobileNumber: string;
  status: PotentialMarketStatus;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppCampaignStatus = 'draft' | 'approved' | 'sent';

export type WhatsAppCampaign = {
  id: string;
  templateName: string;
  templateParams: string[];
  status: WhatsAppCampaignStatus;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  sentCount: number;
  failedCount: number;
};

// ---- Local Management (Stock / In-House Filament / Print Job Costing / Purchases) ----
// Mirrors server/inventory.js, server/in-house-filament.js, server/print-jobs.js,
// server/purchases.js response shapes.

export type InventoryItem = {
  kind: 'filament' | 'category';
  id: string;
  parentId: string;
  productId: string;
  sku: string;
  name: string;
  category: string;
  stockQty: number;
  price: number;
  weight: number;
  usedM?: number;
  usedG?: number;
  remainingM?: number;
  remainingG?: number;
  percentLeft?: number | null;
  listed: boolean;
};

export type ReorderItem = InventoryItem & { soldLast30Days: number };

export type InHouseFilament = {
  id: string;
  brand: string;
  filamentType: string;
  colorName: string;
  rollsAvailable: number;
  weightG: number;
  rollLengthM: number;
  costPerRollRand: number;
  costPerG: number;
  usedG: number;
  usedM: number;
  remainingG: number;
  remainingM: number;
  percentLeft: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PrintJobStatus = 'Estimate' | 'Printed';

export type PrintJobFilamentSlot = {
  id: string;
  inHouseFilamentId: string;
  grams: number;
  meters: number;
  cost: number;
  slotOrder: number;
};

export type PrintJob = {
  id: string;
  itemName: string;
  quantity: number;
  totalGrams: number;
  totalMeters: number;
  printTimeMinutes: number;
  designHours: number;
  setupHours: number;
  postProcessingHours: number;
  markupPct: number;
  filamentCost: number;
  powerCost: number;
  labourCost: number;
  runningCost: number;
  totalCost: number;
  markupAmount: number;
  sellingPrice: number;
  finalSellingPrice: number;
  referenceFilePath: string | null;
  referenceImagePath: string | null;
  referenceFileOriginalName: string | null;
  referenceImageOriginalName: string | null;
  status: PrintJobStatus;
  datePrinted: string;
  createdAt: string;
  listingCategoryId: string | null;
  listingItemId: string | null;
  filaments: PrintJobFilamentSlot[];
};

export type PrintJobCostPreview = {
  quantity: number;
  totalGrams: number;
  totalMeters: number;
  filamentCost: number;
  powerCost: number;
  labourCost: number;
  runningCost: number;
  totalCost: number;
  markupPct: number;
  markupAmount: number;
  sellingPrice: number;
  filaments: Array<{ inHouseFilamentId: string; name: string; grams: number; meters: number; cost: number }>;
  stockWarnings: Array<{ inHouseFilamentId: string; name: string; requestedG: number; remainingG: number }>;
};

export type PurchaseStatus = 'paid' | 'outstanding';

export type Purchase = {
  id: string;
  supplier: string;
  goods: string;
  totalValue: number;
  status: PurchaseStatus;
  paymentType: string;
  purchaseDate: string;
  createdAt: string;
};

export type SalesSummary = {
  range: string;
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  pendingPayment?: { status: string; count: number; total: number };
  series: Array<{ date: string; revenue: number }>;
  topProducts: Array<{ productId: string; name: string; units: number; revenue: number }>;
  statusBreakdown: Array<{ status: string; count: number; total: number }>;
};

// server/admins.js listAdmins() — admin/back-office accounts, not customers
// (customers are Client). There is no role field: every admin has equal
// access.
export type Admin = {
  id: string;
  username: string;
  created_at: string;
};

// server/index.js normalizeItem() — one sellable line inside a category
// product (see Product below).
export type ProductItem = {
  id: string;
  name: string;
  details: string;
  material: string;
  size: string;
  finish: string;
  price: string | number;
  sku: string;
  imageUrl: string;
  videoUrl: string;
  images: string[];
  creator: string;
  models: string[];
  sourceUrl: string;
  weight: number;
  shippingWeight?: number;
  stockQty: number;
  available: boolean;
  listed: boolean;
  sortOrder: number;
};

// /api/products serves catalog.json "category" products (see
// server/export.js readCategoryProducts / server/store.js) — each one is a
// category page (e.g. a GWM parts range) holding an array of sellable
// ProductItems, not a flat per-SKU product table.
export type Product = {
  id: string;
  kind: 'category';
  slug: string;
  name: string;
  description: string;
  crumbs: string;
  parent: string | null;
  items: ProductItem[];
  status: string;
  featured: boolean;
  sortOrder: number;
  seoTitle: string;
  seoDescription: string;
  internalNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type DesignRequestFile = {
  id: string;
  kind: 'image' | 'file';
  filePath: string;
  originalName: string;
};

export type DesignRequestStatus = 'new' | 'quoted' | 'in_progress' | 'finalized';

// server/design-requests.js rowToDesignRequest() + withQuoteStage() (added
// by every server/index.js /api/design-requests route).
export type DesignRequest = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  phone: string;
  description: string;
  budgetNote: string;
  serviceType: string;
  intendedUse: string;
  dimensions: string;
  quantity: number;
  materialPref: string;
  colourPref: string;
  finishPref: string;
  urgency: string;
  deliveryPref: string;
  statusToken: string;
  quoteAmount: number | null;
  quoteTerms: string;
  quotedAt: string | null;
  quoteStatus: string;
  quoteOrderId: string | null;
  quoteDepositPct: number;
  quoteStage: 'quoted' | 'order_placed' | 'order_paid' | null;
  status: DesignRequestStatus;
  adminNotes: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  files: DesignRequestFile[];
};

// server/analytics.js getVisitSummary() + getEventSummary() + getTopPages(),
// combined by GET /api/analytics/summary.
export type AnalyticsSummary = {
  totalVisits: number;
  uniqueVisitorsAllTime: number;
  todayVisits: number;
  dailyVisits: Array<{ day: string; visits: number; uniqueVisitors: number }>;
  topPages: Array<{ path: string; visits: number }>;
  hourlyTraffic: Array<{ hour: string; visits: number; uniqueVisitors: number }>;
  events: Array<{ eventType: string; count: number; uniqueVisitors: number }>;
};

// server/analytics.js getActiveVisitors(), served by GET /api/analytics/active.
export type ActiveVisitors = {
  totalActive: number;
  anonymousActive: number;
  registeredActive: number;
  activeClients: Array<{ clientId: string; name: string; email: string; path: string; lastSeenAt: string }>;
};
