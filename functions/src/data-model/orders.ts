import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';

// ==================================================================
// # Orders
// ==================================================================

export enum OrderStatus {
  Processed = 'processed',
  NeedsManualProcessing = 'needs-manual-processing',
  Error = 'error',
  Ignore = 'ignore',
}

export enum OrderKind {
  Squarespace = 'https://api.squarespace.com/1.0/commerce/orders',
  SheetsImport = 'ilc-2005-sheets-db-import',
  Stripe = 'stripe',
}

export type BaseOrder = {
  docId: string; // Firestore ID
  // lastUpdated tracks when the order was created or generated (e.g. datePaid for old sheets, createdOn for Squarespace).
  // It is used for chronological sorting of orders across both old Google Sheets imports and Squarespace webhooks.
  lastUpdated: string; // ISO string
  ilcAppOrderKind?: OrderKind;
  ilcAppOrderStatus?: OrderStatus;
  ilcAppOrderIssues?: string[];
  // Free-form admin notes, editable from the order detail UI.
  ilcAppNotes?: string;
};

// Firestore path: /orders/{doc-id}
export type SheetsImportOrder = BaseOrder & {
  ilcAppOrderKind: OrderKind.SheetsImport;
  orderType: string; // From CSV (column 'order')
  referenceNumber: string; // From CSV
  externalId: string; // From CSV (matches memberId)
  studentOf: string; // From CSV
  paidFor: string; // From CSV
  newRenew: string; // From CSV
  datePaid: string; // From CSV (YYYY-MM-DD)
  startDate: string; // From CSV (YYYY-MM-DD)
  lastName: string; // From CSV
  firstName: string; // From CSV
  email: string; // From CSV
  country: string; // From CSV
  state: string; // From CSV
  costUsd: string; // From CSV
  collected: string; // From CSV
  split: string; // From CSV
  notes: string; // From CSV
};

export interface SquareSpaceCustomization {
  label?: string;
  value?: string;
}

export interface SquareSpaceVariantOption {
  optionName?: string;
  value?: string;
}

export enum SquareSpaceLineItemType {
  PhysicalProduct = 'PHYSICAL_PRODUCT',
  Service = 'SERVICE',
}

export enum SquarespaceFulfillmentStatus {
  Fulfilled = 'FULFILLED',
  Pending = 'PENDING',
  Canceled = 'CANCELED',
}

export interface SquareSpaceLineItem {
  id: string;
  sku: string;
  productId?: string;
  productName?: string;
  lineItemType: SquareSpaceLineItemType;
  variantOptions?: SquareSpaceVariantOption[];
  customizations?: SquareSpaceCustomization[];
  quantity: string;
  unitPricePaid: { value: string };
  // ILC App processing fields added to SquarespaceLineItem.
  ilcAppProcessingStatus?: OrderStatus;
  ilcAppProcessingIssue?: string;
  // Manually set or auto-inferred member ID, used as a fallback when the
  // Squarespace form's "Member ID" field is missing or incorrect. Admins
  // can set this via the order detail UI, or it can be automatically
  // inferred by matching the order's email + date of birth to a member.
  ilcAppMemberIdInferred?: string;
  // Manually set or auto-inferred school ID, used as a fallback when the
  // Squarespace form's "School ID" field is missing or incorrect. Admins
  // can set this via the order detail UI.
  ilcAppSchoolIdInferred?: string;
  // When the order is processed successfully and changes an expiry date,
  // these fields record the renewal date and new expiry date that were set.
  ilcAppNewLastRenewalDate?: string; // YYYY-MM-DD
  ilcAppNewExpiryDate?: string; // YYYY-MM-DD
  // Snapshot of the member/school's renewal and expiry dates before this
  // order was processed. Written once at processing time so reprocessing
  // does not overwrite the original baseline.
  ilcAppPreOrderRenewalDate?: string; // YYYY-MM-DD
  ilcAppPreOrderExpiryDate?: string; // YYYY-MM-DD
  ilcAppCountryOverride?: string; // Country name override from approved list (for generating member ID)
}

export type SquareSpaceOrder = BaseOrder & {
  ilcAppOrderKind: OrderKind.Squarespace;
  id: string; // Squarespace UUID — used in API endpoint URLs (e.g. /orders/{id}/fulfillments)
  orderNumber: string;
  createdOn: string;
  modifiedOn: string;
  customerEmail: string;
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
  };
  // This is the squarespace fulfillment status.
  fulfillmentStatus: SquarespaceFulfillmentStatus;
  lineItems?: SquareSpaceLineItem[];
};

// What kind of Stripe event produced an order record. A subscription's initial
// payment arrives as a `checkout` order; each subsequent renewal invoice as a
// `renewal` order; and ending the subscription as a `cancellation` order. This
// mirrors how Squarespace renewals each become their own order record.
export enum StripeOrderType {
  Checkout = 'checkout',
  Renewal = 'renewal',
  Cancellation = 'cancellation',
}

export enum StripeCheckoutMode {
  Payment = 'payment',
  Subscription = 'subscription',
}

export enum StripePaymentStatus {
  NoPaymentRequired = 'no_payment_required',
  Paid = 'paid',
  Unpaid = 'unpaid',
}

// A single purchased line, mapped from a Checkout Session line item or an
// invoice line. Product/price ids are retained so future downstream logic can
// map Stripe products to memberships/gradings (the Stripe analogue of a SKU).
export interface StripeOrderLineItem {
  productId: string | null;
  priceId: string | null;
  description: string;
  quantity: number | null;
  // Total for this line in the currency's minor unit (e.g. cents).
  amountTotal: number;
  currency: string;
}

// Firestore path: /orders/{doc-id}
export type StripeOrder = BaseOrder & {
  ilcAppOrderKind: OrderKind.Stripe;
  stripeOrderType: StripeOrderType;
  // Idempotency identity: the id of the primary Stripe object this record was
  // built from (checkout session `cs_...`, invoice `in_...`, or subscription
  // `sub_...` for cancellations). These id namespaces do not collide, so a
  // single equality lookup on this field is enough to dedupe redelivered
  // webhook events.
  stripeObjectId: string;
  // Specific ids, populated when available on the source object.
  checkoutSessionId?: string;
  invoiceId?: string;
  paymentIntentId?: string;
  subscriptionId?: string;
  stripeCustomerId?: string;
  mode?: StripeCheckoutMode;
  // Session or subscription status, verbatim from Stripe (e.g. 'complete',
  // 'active', 'canceled').
  status?: string;
  paymentStatus?: StripePaymentStatus | null;
  customerEmail?: string;
  customerName?: string;
  billingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  // Grand total in the currency's minor unit, or null if not applicable.
  amountTotal: number | null;
  currency: string | null;
  // When the underlying Stripe event/object was created (ISO string). Also used
  // to populate `lastUpdated` for chronological sorting alongside other orders.
  created: string;
  metadata?: Record<string, string>;
  clientReferenceId?: string | null;
  receiptUrl?: string;
  lineItems: StripeOrderLineItem[];
};

export type Order = SheetsImportOrder | SquareSpaceOrder | StripeOrder;

export type SheetsImportOrderFsDoc = Omit<SheetsImportOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export type SquarespaceOrderFsDoc = Omit<SquareSpaceOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export type StripeOrderFsDoc = Omit<StripeOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export type OrderFsDoc =
  | SheetsImportOrderFsDoc
  | SquarespaceOrderFsDoc
  | StripeOrderFsDoc;

export function initSheetsImportOrder(): SheetsImportOrder {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    ilcAppOrderKind: OrderKind.SheetsImport,
    orderType: '',
    referenceNumber: '',
    externalId: '',
    studentOf: '',
    paidFor: '',
    newRenew: '',
    datePaid: '',
    startDate: '',
    lastName: '',
    firstName: '',
    email: '',
    country: '',
    state: '',
    costUsd: '',
    collected: '',
    split: '',
    notes: '',
  };
}

export function initStripeOrder(): StripeOrder {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    ilcAppOrderKind: OrderKind.Stripe,
    stripeOrderType: StripeOrderType.Checkout,
    stripeObjectId: '',
    amountTotal: null,
    currency: null,
    created: new Date().toISOString(),
    lineItems: [],
  };
}

export function firestoreDocToOrder(doc: GenericFsDoc): Order {
  const docData = doc.data() as OrderFsDoc;
  const lastUpdated = normalizeLastUpdated(docData.lastUpdated);

  if (!docData.ilcAppOrderKind || docData.ilcAppOrderKind === OrderKind.SheetsImport) {
    return { ...initSheetsImportOrder(), ...docData, ilcAppOrderKind: OrderKind.SheetsImport, lastUpdated, docId: doc.id } as SheetsImportOrder;
  }
  return { ...docData, lastUpdated, docId: doc.id } as Order;
}

// ==================================================================
// # Member Orders Subcollection: /members/{memberDocId}/orders/{orderDocId}
// ==================================================================

export enum MemberOrderKind {
  Stripe = 'stripe',
  Squarespace = 'squarespace',
  SheetsImport = 'sheets-import',
}

export enum OrderItemCategory {
  Membership = 'membership',
  InstructorLicense = 'instructor_license',
  SchoolLicense = 'school_license',
  Grading = 'grading',
  VideoLibrary = 'video_library',
  Vod = 'vod',
  Event = 'event',
  Other = 'other',
}

export interface MemberOrderLineItem {
  productId: string | null;
  priceId: string | null;
  description: string;
  quantity: number | null;
  amountTotal: number;
  currency: string;
  category?: OrderItemCategory;
}

export enum MemberOrderType {
  Checkout = 'checkout',
  Renewal = 'renewal',
  Cancellation = 'cancellation',
  OneTime = 'one_time',
}

export enum MemberOrderPaymentStatus {
  Paid = 'paid',
  Unpaid = 'unpaid',
  NoPaymentRequired = 'no_payment_required',
  Refunded = 'refunded',
}

export enum MemberOrderFulfillmentStatus {
  Fulfilled = 'fulfilled',
  Pending = 'pending',
  Cancelled = 'cancelled',
}

export type MemberOrder = {
  docId: string; // Same as /orders/{docId} for 1:1 mirroring
  orderDocId: string; // Global order reference ID
  memberDocId: string;
  memberId: string;

  // Source information
  orderKind: MemberOrderKind;
  orderType: MemberOrderType;
  orderNumber?: string; // Human-readable (e.g. Stripe invoice #, Squarespace order #)

  // Dates
  date: string; // YYYY-MM-DD (transaction date)
  created: string; // ISO timestamp
  lastUpdated: string; // ISO timestamp

  // Financials & Status
  amountTotal: number | null; // Cents or null for cancellations
  currency: string | null;
  paymentStatus: MemberOrderPaymentStatus | null;
  fulfillmentStatus: MemberOrderFulfillmentStatus;

  // Line items
  description: string; // Main summary description for row header
  lineItems: MemberOrderLineItem[];

  // Stripe references & Receipt Links
  subscriptionId?: string;
  stripeInvoiceId?: string;
  stripeReceiptUrl?: string; // Hosted invoice or receipt URL from Stripe
  gradingDocId?: string; // If this order purchased a grading
};

export type MemberOrderFsDoc = Omit<MemberOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export function initMemberOrder(): MemberOrder {
  return {
    docId: '',
    orderDocId: '',
    memberDocId: '',
    memberId: '',
    orderKind: MemberOrderKind.Stripe,
    orderType: MemberOrderType.Checkout,
    orderNumber: '',
    date: new Date().toISOString().split('T')[0],
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    amountTotal: 0,
    currency: 'usd',
    paymentStatus: MemberOrderPaymentStatus.Paid,
    fulfillmentStatus: MemberOrderFulfillmentStatus.Fulfilled,
    description: '',
    lineItems: [],
  };
}

export function firestoreDocToMemberOrder(doc: GenericFsDoc): MemberOrder {
  const docData = doc.data() as MemberOrderFsDoc;
  const lastUpdated = normalizeLastUpdated(docData?.lastUpdated);

  return {
    ...initMemberOrder(),
    ...docData,
    lastUpdated,
    docId: doc.id,
  };
}
