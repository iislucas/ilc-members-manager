/* mini-tools/vod-grants-analyzer/src/types.ts
 *
 * Strongly-typed domain models for VOD purchase analysis and grants management.
 */

export type PurchaseCategory =
  | 'vod_series'
  | 'skipped_subscription'
  | 'unmigrated_video'
  | 'unmigrated_audio'
  | 'non_video'
  | 'unmatched';

export interface RawPurchaseRecord {
  source: string;
  sourceFile: string;
  sourceOrderId: string;
  email: string;
  customerName: string;
  itemRaw: string;
  date: string;
  amount: string;
  paymentMethod: string;
  status: string;
  ticketName?: string;
  category?: PurchaseCategory;
  target?: string;
}

export interface CompactOrderRecord {
  id: string;
  email: string;
  name: string;
  item: string;
  cat: string;
  date: string;
  amount: string;
  source_file: string;
}

export interface VideoPart {
  docId: string;
  title: string;
  durationSeconds?: number;
  priceCents?: number;
  stripeProductId?: string;
  stripePriceId?: string;
}

export interface VodSeriesInfo {
  seriesTitle: string;
  trailerVideoId: string;
  trailerTitle: string;
  parts: VideoPart[];
}

export interface MemberRecord {
  docId: string;
  memberId: string;
  name: string;
  email: string;
  emails: string[];
  studentLevel: number;
  classVideoLibrarySubscription: boolean;
  classVideoLibraryExpirationDate: string;
}

export interface IndividualVideoGrant {
  email: string;
  customerName: string;
  isRegisteredMember: boolean;
  memberDocId: string;
  memberId: string;
  studentLevel: number | string;
  videoId: string;
  videoTitle: string;
  seriesTitle: string;
  grantKind: 'admin_grant' | 'stripe_purchase' | 'event_attendance';
  sources: string[];
  sources_str?: string;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
}

export interface SeriesGrant {
  email: string;
  customerName: string;
  isRegisteredMember: boolean;
  memberDocId: string;
  memberId: string;
  studentLevel: number | string;
  seriesTitle: string;
  partCount: number;
  partVideoIds: string;
  sources: string[];
  sources_str?: string;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
}

export interface SkippedSubscriptionRecord {
  email: string;
  customerName: string;
  isRegisteredMember: boolean;
  memberDocId: string;
  memberId: string;
  studentLevel: number | string;
  currentClassVideoSub: boolean;
  currentClassVideoExpiry: string;
  sources: string[];
  sources_str?: string;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  orderCount: number;
}

export interface UnmigratedPurchaseRecord {
  email: string;
  customerName: string;
  isRegisteredMember: boolean;
  memberDocId: string;
  memberId: string;
  unmigratedTitle: string;
  itemType: string;
  sources: string[];
  sources_str?: string;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
}

export interface SummaryMetrics {
  generatedAt: string;
  totals: {
    rawRecordsProcessed: number;
    categorizedRecords: number;
    individualVideoGrants: number;
    seriesGrants: number;
    skippedSubscriptionCustomers: number;
    unmigratedTitlePurchases: number;
    uniqueVodPurchasers: number;
    registeredVodPurchasersInFirestore: number;
    unregisteredVodPurchasers: number;
  };
  catalogStats: {
    totalFirestoreVideos: number;
    vodSeriesInCatalog: number;
  };
  seriesBreakdown: Record<string, {
    seriesTitle: string;
    purchaserCount: number;
    videoPartCount: number;
    videoPartIds: string;
  }>;
}

export interface ValidationResults {
  allPassed: boolean;
  checksPassed: number;
  totalChecks: number;
  fileBreakdown: Record<string, number>;
  timestamp: string;
}

export interface AppData {
  summaryMetrics: SummaryMetrics;
  validationResults: ValidationResults;
  timelineStats: Record<string, number>;
  channelStats: Record<string, number>;
  topCustomers: {
    email: string;
    name: string;
    isRegistered: boolean;
    memberId: string;
    grantCount: number;
    seriesCount: number;
  }[];
  grants: IndividualVideoGrant[];
  seriesGrants: SeriesGrant[];
  unmigrated: UnmigratedPurchaseRecord[];
  skippedSubs: SkippedSubscriptionRecord[];
  rawOrders: CompactOrderRecord[];
  seriesBreakdown: Record<string, {
    seriesTitle: string;
    purchaserCount: number;
    videoPartCount: number;
    videoPartIds: string;
  }>;
}

declare global {
  interface Window {
    APP_DATA?: AppData;
    exportGrantsCSV?: () => void;
    exportOrdersCSV?: () => void;
  }
}

