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
