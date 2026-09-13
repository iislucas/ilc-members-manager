import {
  membershipActivatedSubject,
  membershipActivatedBody,
  instructorLicenseActivatedSubject,
  instructorLicenseActivatedBody,
  orderConfirmationSubject,
  orderConfirmationBody,
  eventRegistrationConfirmationSubject,
  eventRegistrationConfirmationBody,
  vodPurchaseConfirmationSubject,
  vodPurchaseConfirmationBody,
  gradingPaymentConfirmationSubject,
  gradingPaymentConfirmationBody,
  subscriptionRenewalSubject,
  subscriptionRenewalBody,
  eventDigestOverallSubject,
  eventDigestOverallBody,
  eventDigestItemTemplate,
} from '../email-templates';

// A single cached blog post with only the fields the UI needs.
// The `body` and `excerpt` fields contain pre-processed HTML where
// Squarespace-specific quirks (lazy images, protocol-relative URLs,
// video embeds) have already been resolved.
// Which source wrote a blog post in /members-post or /instructors-post.
//
// The two collections mix cached and authored content, so this is what lets
// the Squarespace sync tell them apart: it only prunes and clears posts it
// wrote itself, leaving app-authored posts alone.
export enum BlogPostSourceKind {
  // Written in the app. Never pruned or cleared by the Squarespace sync.
  FirebaseSourced = 'firebase-sourced',
  // Mirrored from the Squarespace blog; regenerable on the next sync.
  Squarespace = 'squarespace',
  // Imported from WordPress archive (pages/posts/wiki).
  WordPress = 'wordpress',
}

// Read a post's source kind from a raw Firestore document.
//
// This is the single place where an untyped stored value becomes a
// BlogPostSourceKind, so CachedBlogPost.kind can be non-optional everywhere
// else. Documents written before the field existed have no `kind`; they came
// from the Squarespace sync, which is the only writer these collections had
// at the time, so that is what they are reported as. An unrecognised value is
// reported as FirebaseSourced: the sync must never delete content it cannot
// identify.
export function blogPostSourceKind(
  data: Partial<Record<'kind', unknown>>,
): BlogPostSourceKind {
  if (data.kind === undefined || data.kind === null || data.kind === '') {
    return BlogPostSourceKind.Squarespace;
  }
  if (data.kind === BlogPostSourceKind.Squarespace) {
    return BlogPostSourceKind.Squarespace;
  }
  if (data.kind === BlogPostSourceKind.WordPress) {
    return BlogPostSourceKind.WordPress;
  }
  return BlogPostSourceKind.FirebaseSourced;
}

export enum BlogPostStatus {
  Published = 'published',
  Draft = 'draft',
}

export type CachedBlogPost = {
  id: string; // Item ID (Squarespace item ID or WP ID)
  urlId: string; // URL-friendly slug for routing
  title: string;
  excerpt: string; // pre-processed HTML or markdown
  body: string; // pre-processed HTML or markdown
  bodyMarkdown: string; // original markdown source if available
  assetUrl: string; // hero/thumbnail image
  publishOn: number; // timestamp (ms since epoch)
  addedOn: number; // timestamp (ms since epoch)
  categories: string[];
  tags: string[];
  author: string; // display name
  // Which source wrote this post. Always set; read stored documents through
  // blogPostSourceKind so legacy documents without the field are normalised.
  kind: BlogPostSourceKind;
  isDraft: boolean; // When true, hidden from public users and visible only to admins
  status: BlogPostStatus;
  lastUpdated?: string; // ISO date-time; managed by sync logic
};

export function initCachedBlogPost(): CachedBlogPost {
  return {
    id: '',
    urlId: '',
    title: '',
    excerpt: '',
    body: '',
    bodyMarkdown: '',
    assetUrl: '',
    publishOn: 0,
    addedOn: 0,
    categories: [],
    tags: [],
    author: '',
    // These collections had no other writer when the field was introduced.
    kind: BlogPostSourceKind.Squarespace,
    isDraft: false,
    status: BlogPostStatus.Published,
  };
}

// Metadata about the content cache, stored at /system/cache-metadata.
export type CacheMetadata = {
  blogsLastRefreshed: string; // ISO date-time
  blogsItemCount: number;
  blogsLastSyncUpdated: number; // items written (new or changed) in last sync
  blogsLastSyncRemoved: number; // stale items pruned in last sync
  stripeLastRefreshed: string; // ISO date-time
  stripeProductCount: number;
};

export function initCacheMetadata(): CacheMetadata {
  return {
    blogsLastRefreshed: '',
    blogsItemCount: 0,
    blogsLastSyncUpdated: 0,
    blogsLastSyncRemoved: 0,
    stripeLastRefreshed: '',
    stripeProductCount: 0,
  };
}

// System configuration for email templates, stored at /system/email-templates.
export interface EmailTemplates {
  // --- Account & Activation Emails ---
  membershipActivatedSubject: string;
  membershipActivatedBody: string; // Markdown template
  instructorLicenseActivatedSubject: string;
  instructorLicenseActivatedBody: string; // Markdown template

  // --- Purchase & Order Confirmations ---
  orderConfirmationSubject: string;
  orderConfirmationBody: string;

  eventRegistrationConfirmationSubject: string;
  eventRegistrationConfirmationBody: string;

  vodPurchaseConfirmationSubject: string;
  vodPurchaseConfirmationBody: string;

  gradingPaymentConfirmationSubject: string;
  gradingPaymentConfirmationBody: string;

  subscriptionRenewalSubject: string;
  subscriptionRenewalBody: string;

  // --- Upcoming Event Digest (Two-Tier Template) ---
  // 1. Overall Email Template (contains subject and body with {eventsList} placeholder)
  eventDigestOverallSubject: string;
  eventDigestOverallBody: string;

  // 2. Per-Event Item Template (renders an individual event card within the list)
  eventDigestItemTemplate: string;
}

export function initEmailTemplates(): EmailTemplates {
  return {
    membershipActivatedSubject: membershipActivatedSubject(),
    membershipActivatedBody: membershipActivatedBody({ appBase: '{appBase}' }),
    instructorLicenseActivatedSubject: instructorLicenseActivatedSubject(),
    instructorLicenseActivatedBody: instructorLicenseActivatedBody({
      instructorId: '{instructorId}',
      appBase: '{appBase}',
      instructorSopUrl: '{instructorSopUrl}',
    }),

    orderConfirmationSubject: orderConfirmationSubject(),
    orderConfirmationBody: orderConfirmationBody({
      name: '{name}',
      orderNumber: '{orderNumber}',
      orderDate: '{orderDate}',
      amount: '{amount}',
      currency: '{currency}',
      itemsSummary: '{itemsSummary}',
      receiptUrl: '{receiptUrl}',
      appBase: '{appBase}',
    }),

    eventRegistrationConfirmationSubject: eventRegistrationConfirmationSubject(),
    eventRegistrationConfirmationBody: eventRegistrationConfirmationBody({
      name: '{name}',
      eventTitle: '{eventTitle}',
      eventDates: '{eventDates}',
      eventLocation: '{eventLocation}',
      attendanceType: '{attendanceType}',
      onlineJoiningLink: '{onlineJoiningLink}',
      specialInstructions: '{specialInstructions}',
      amount: '{amount}',
      receiptUrl: '{receiptUrl}',
      appBase: '{appBase}',
    }),

    vodPurchaseConfirmationSubject: vodPurchaseConfirmationSubject(),
    vodPurchaseConfirmationBody: vodPurchaseConfirmationBody({
      name: '{name}',
      videoTitle: '{videoTitle}',
      videoUrl: '{videoUrl}',
      amount: '{amount}',
      receiptUrl: '{receiptUrl}',
      appBase: '{appBase}',
    }),

    gradingPaymentConfirmationSubject: gradingPaymentConfirmationSubject(),
    gradingPaymentConfirmationBody: gradingPaymentConfirmationBody({
      name: '{name}',
      memberId: '{memberId}',
      gradingLevel: '{gradingLevel}',
      gradingEventName: '{gradingEventName}',
      gradingDate: '{gradingDate}',
      amount: '{amount}',
      gradingUrl: '{gradingUrl}',
      appBase: '{appBase}',
    }),

    subscriptionRenewalSubject: subscriptionRenewalSubject(),
    subscriptionRenewalBody: subscriptionRenewalBody({
      name: '{name}',
      planName: '{planName}',
      amount: '{amount}',
      renewalDate: '{renewalDate}',
      nextRenewalDate: '{nextRenewalDate}',
      receiptUrl: '{receiptUrl}',
      appBase: '{appBase}',
    }),

    eventDigestOverallSubject: eventDigestOverallSubject(),
    eventDigestOverallBody: eventDigestOverallBody({
      name: '{name}',
      period: '{period}',
      eventsCount: '{eventsCount}',
      eventsList: '{eventsList}',
      calendarUrl: '{calendarUrl}',
      preferencesUrl: '{preferencesUrl}',
      appBase: '{appBase}',
    }),

    eventDigestItemTemplate: eventDigestItemTemplate({
      eventTitle: '{eventTitle}',
      eventDates: '{eventDates}',
      eventLocation: '{eventLocation}',
      eventInstructors: '{eventInstructors}',
      eventDetailsUrl: '{eventDetailsUrl}',
      eventPrice: '{eventPrice}',
      attendanceType: '{attendanceType}',
      eventSummary: '{eventSummary}',
    }),
  };
}
