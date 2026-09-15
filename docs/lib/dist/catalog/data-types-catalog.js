"use strict";
/* data-types-catalog.ts
 *
 * Authoritative registry of all Firestore collections, subcollections, and domain data models
 * organized across 8 functional groups with 3 hierarchical levels of detail.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_TYPES_CATALOG = void 0;
const data_type_1 = require("../models/data-type");
exports.DATA_TYPES_CATALOG = [
    {
        id: 'member',
        name: 'Member',
        domain: data_type_1.DataDomainGroup.IdentityAuth,
        collectionPath: '/members/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/members.ts',
        summary: 'The core membership identity document representing an individual practitioner, instructor, school manager, or administrator. Maintains personal profile, ranks, licensing credentials, and account-wide push/email notification preferences (paired with client-side localStorage devicePushEnabled).',
        cardinality: 'One document per registered member profile.',
        ownership: 'Linked to user email addresses in member.emails; administered by HQ Admins.',
        keyRelations: [
            { targetTypeId: 'acl', targetTypeName: 'ACL', relation: 'Mirrored into /acl/{email} for fast authorization' },
            { targetTypeId: 'grading', targetTypeName: 'Grading', relation: 'Tracked via gradingDocIds and studentMemberDocId' },
            { targetTypeId: 'school', targetTypeName: 'School', relation: 'Affiliated via schoolDocId' },
            { targetTypeId: 'instructor-profile', targetTypeName: 'InstructorPublicData', relation: 'Mirrored to public instructor profile' },
        ],
        readRoles: ['Admin (HQ)', 'Self (matching email)', 'School Manager (students of school)'],
        writeRoles: [
            'Admin (full write)',
            'Self (contact details only, auth email preservation required)',
            'School Manager (scoped whitelist: contact, address, levels, notes; strictly no isAdmin or memberId mutation)',
        ],
        rulesSummary: 'Self can update contact, name, and address (must preserve auth email). School managers have scoped operational update permissions for affiliated students. isAdmin, memberId, and document creation/deletion require Admin role.',
        affectedTriggers: ['on-member-update.ts', 'mirror-instructors-to-public-profile.ts'],
        mirrorTargets: ['/acl/{email}', '/instructors/{instructorId}', '/schools/{schoolId}/members/{docId}'],
        relatedJourneys: ['member-onboarding', 'grading-progression', 'instructor-licensing', 'push-notifications'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring', 'one-click-unsubscribe'],
        relatedPersonas: ["active-member", "grading-candidate", "apprentice-instructor", "school-manager", "hq-admin"],
        enforcingPermissions: ["read:member-passbook", "read:member-profile", "update:instructor-profile", "read:student-roster", "manage:school-roster", "verify:members", "admin:all"],
        tsInterface: `export interface Member {
  docId: string;
  memberId: string;
  name: string;
  emails: string[];
  studentLevel: string;
  applicationLevel: string;
  membershipType: string;
  currentMembershipExpires: string;
  instructorId: string;
  instructorLicenseType: string;
  instructorLicenseExpires: string;
  schoolId: string;
  gradingDocIds: string[];
  isAdmin: boolean;
  lastUpdated: string;
}`,
        initDefaults: `initMember(): all empty strings, isAdmin: false, emails: [], gradingDocIds: []`,
        converterFunction: 'firestoreDocToMember',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Firestore document ID' },
            { name: 'memberId', type: 'string', required: true, description: 'Unique public identifier e.g. US402' },
            { name: 'name', type: 'string', required: true, description: 'Full legal/practitioner name' },
            { name: 'emails', type: 'string[]', required: true, description: 'List of associated email addresses' },
            { name: 'studentLevel', type: 'string', required: true, description: 'Highest achieved Student Level (Entry..11)' },
            { name: 'applicationLevel', type: 'string', required: true, description: 'Highest achieved Application Level (1..6)' },
            { name: 'membershipType', type: 'string', required: true, description: 'Annual, Senior, Youth, or Life' },
            { name: 'currentMembershipExpires', type: 'string', required: true, description: 'Expiration date YYYY-MM-DD or life' },
            { name: 'instructorId', type: 'string', required: true, description: 'Assigned instructor number e.g. 289' },
            { name: 'instructorLicenseExpires', type: 'string', required: true, description: 'License expiry date YYYY-MM-DD' },
            { name: 'schoolId', type: 'string', required: true, description: 'Affiliated school identifier' },
            { name: 'gradingDocIds', type: 'string[]', required: true, description: 'List of grading document docIds' },
            { name: 'isAdmin', type: 'boolean', required: true, description: 'Global administrative privileges' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO 8601 timestamp of last modification' },
        ],
    },
    {
        id: 'grading',
        name: 'Grading',
        domain: data_type_1.DataDomainGroup.CurriculumGrading,
        collectionPath: '/gradings/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/gradings.ts',
        summary: 'A formal examination record tracking a member grading attempt, fee settlement, examiner evaluation, and progression milestone.',
        cardinality: 'One document per level examination attempt.',
        ownership: 'Created by student or admin; managed by examiner, Sifu, and linked event managers.',
        keyRelations: [
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'References studentMemberDocId and updates member levels on pass' },
            { targetTypeId: 'ilc-event', targetTypeName: 'IlcEvent', relation: 'Optionally linked via gradingEventDocId' },
            { targetTypeId: 'order', targetTypeName: 'Order', relation: 'Settled by orderId upon successful payment' },
        ],
        readRoles: ['Admin (HQ)', 'Student (self)', 'Grading Manager (Sifu / Event Manager)'],
        writeRoles: ['Admin (full write)', 'Student (notes, request, link event)', 'Grading Manager (status, results, notes)'],
        rulesSummary: 'Strict field-level validation via affectedKeys().hasOnly(...). Managers can approve and set status; students can change event until finalized.',
        affectedTriggers: ['on-grading-update.ts'],
        mirrorTargets: ['/instructors/{id}/gradings/{id}', '/schools/{id}/gradings/{id}'],
        relatedJourneys: ['grading-progression'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
        relatedPersonas: ["grading-candidate", "sifu-instructor", "grading-examiner", "event-organizer", "hq-admin"],
        enforcingPermissions: ["request:grading", "create:grading-request", "purchase:grading-fee", "read:grading-feedback", "accept:grading-request", "evaluate:grading", "record:grading-result", "manage:event-gradings", "admin:all"],
        tsInterface: `export interface Grading {
  docId: string;
  studentMemberDocId: string;
  studentMemberId: string;
  studentName: string;
  level: string;
  status: GradingStatus;
  gradingEvent: string;
  gradingEventDate: string;
  gradingEventDocId: string;
  gradingInstructorId: string;
  acceptedByMemberDocId: string;
  statusChangedByMemberDocId: string;
  orderId: string;
  notes: string;
  studentNotes: string;
  resultNotes: string;
  lastUpdated: string;
}`,
        initDefaults: `initGrading(): status: Pending, empty strings for IDs and dates`,
        converterFunction: 'firestoreDocToGrading',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Firestore document ID' },
            { name: 'studentMemberDocId', type: 'string', required: true, description: 'Reference to Member document' },
            { name: 'level', type: 'string', required: true, description: 'Target examination level e.g. Student 3' },
            { name: 'status', type: 'GradingStatus', required: true, description: 'Pending, Accepted, InReview, Passed, Declined' },
            { name: 'gradingEventDocId', type: 'string', required: true, description: 'DocId of linked IlcEvent' },
            { name: 'gradingInstructorId', type: 'string', required: true, description: 'Selected evaluating instructor ID' },
            { name: 'orderId', type: 'string', required: true, description: 'Settling order docId or empty if unpaid' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp of last update' },
        ],
    },
    {
        id: 'ilc-event',
        name: 'IlcEvent',
        domain: data_type_1.DataDomainGroup.EventsTicketing,
        collectionPath: '/events/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/events.ts',
        summary: 'A workshop, retreat, class series, or grading seminar hosted by HQ, a school, or certified instructor.',
        cardinality: 'One document per scheduled event.',
        ownership: 'Owned by ownerDocId, managed by managerDocIds and HQ Admins.',
        keyRelations: [
            { targetTypeId: 'grading', targetTypeName: 'Grading', relation: 'Grants grading management access to event organizers' },
            { targetTypeId: 'event-registration', targetTypeName: 'EventRegistration', relation: 'Holds attendee registration records in subcollection' },
            { targetTypeId: 'product', targetTypeName: 'Product', relation: 'Links ticket pricing tiers' },
        ],
        readRoles: ['Public (approved published events)', 'Members (all events)', 'Admin / Owner (all drafts)'],
        writeRoles: ['Admin (all events)', 'Owner / Manager (own events)'],
        rulesSummary: 'Public read allowed for published events. Mutation guarded by ACL memberDocIds matching owner or managerDocIds.',
        affectedTriggers: ['proposed-events.ts', 'on-event-registration-update.ts'],
        mirrorTargets: [],
        relatedJourneys: ['event-hosting-ticketing'],
        relatedFlows: ['client-reactivity', 'ecommerce-webhooks', 'micro-frontends'],
        relatedPersonas: ["event-organizer", "external-attendee", "school-manager", "hq-admin", "anonymous-visitor"],
        enforcingPermissions: ["read:public-events", "purchase:event-ticket", "manage:event", "manage:event-gradings", "admin:all"],
        tsInterface: `export interface IlcEvent {
  docId: string;
  title: string;
  dates: string[];
  startDate: string;
  endDate: string;
  location: string;
  ownerDocId: string;
  managerDocIds: string[];
  status: EventStatus;
  ticketProductIds: string[];
  lastUpdated: string;
}`,
        initDefaults: `initEvent(): status: Draft, managerDocIds: [], dates: []`,
        converterFunction: 'firestoreDocToEvent',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Firestore document ID' },
            { name: 'title', type: 'string', required: true, description: 'Event title' },
            { name: 'startDate', type: 'string', required: true, description: 'Start date YYYY-MM-DD' },
            { name: 'location', type: 'string', required: true, description: 'Physical address or Online link' },
            { name: 'ownerDocId', type: 'string', required: true, description: 'DocId of event organizer member' },
            { name: 'managerDocIds', type: 'string[]', required: true, description: 'DocIds of co-managers' },
            { name: 'status', type: 'EventStatus', required: true, description: 'Draft, Proposed, Published, Cancelled' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp of last update' },
        ],
    },
    {
        id: 'event-registration',
        name: 'EventRegistration',
        domain: data_type_1.DataDomainGroup.EventsTicketing,
        collectionPath: '/events/{id}/registrations/{id}',
        isSubcollection: true,
        parentCollection: 'events',
        sourceFile: 'functions/src/data-model/events.ts',
        summary: 'Attendee ticket registration record capturing ticket tier, payment confirmation, and attendance status.',
        cardinality: 'One document per registered attendee per event.',
        ownership: 'Purchased by member or guest; managed by event organizer.',
        keyRelations: [
            { targetTypeId: 'ilc-event', targetTypeName: 'IlcEvent', relation: 'Parent event subcollection' },
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Mirrored into /members/{id}/registrations/{id}' },
            { targetTypeId: 'order', targetTypeName: 'Order', relation: 'Linked to payment order' },
        ],
        readRoles: ['Admin', 'Event Organizer / Manager', 'Attendee (self)'],
        writeRoles: ['Admin', 'Event Organizer (check-in)', 'Cloud Functions (fulfillment)'],
        rulesSummary: 'Attendees can read their own registration; event managers can update attendance/check-in flags.',
        affectedTriggers: ['on-event-registration-update.ts'],
        mirrorTargets: ['/members/{memberDocId}/registrations/{regId}'],
        relatedJourneys: ['event-hosting-ticketing'],
        relatedFlows: ['ecommerce-webhooks'],
        relatedPersonas: ["external-attendee", "event-organizer", "active-member", "hq-admin"],
        enforcingPermissions: ["purchase:event-ticket", "read:own-registrations", "checkin:attendees", "admin:all"],
        tsInterface: `export interface EventRegistration {
  docId: string;
  eventDocId: string;
  memberDocId: string;
  email: string;
  name: string;
  ticketType: string;
  paymentStatus: 'paid' | 'unpaid' | 'comp';
  orderId: string;
  checkedIn: boolean;
  lastUpdated: string;
}`,
        initDefaults: 'initEventRegistration(): checkedIn: false, paymentStatus: unpaid',
        converterFunction: 'firestoreDocToEventRegistration',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Registration docId' },
            { name: 'eventDocId', type: 'string', required: true, description: 'Parent event docId' },
            { name: 'memberDocId', type: 'string', required: true, description: 'Registered member docId or guest' },
            { name: 'checkedIn', type: 'boolean', required: true, description: 'Whether attendee has checked in on site' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp' },
        ],
    },
    {
        id: 'school',
        name: 'School',
        domain: data_type_1.DataDomainGroup.OrganizationSchool,
        collectionPath: '/schools/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/schools.ts',
        summary: 'An official affiliate school or training group operating under the auspices of I Liq Chuan.',
        cardinality: 'One document per registered school or club.',
        ownership: 'Owned by managerDocIds; administered by HQ Admins.',
        keyRelations: [
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Maintains student roster in subcollection' },
            { targetTypeId: 'grading', targetTypeName: 'Grading', relation: 'Maintains school grading history in subcollection' },
            { targetTypeId: 'acl', targetTypeName: 'ACL', relation: 'Mirrors manager school permissions to /acl/{email}' },
        ],
        readRoles: ['Public (approved schools)', 'School Managers', 'Admin'],
        writeRoles: ['Admin (full write)', 'School Manager (profile, location, contact)'],
        rulesSummary: 'School managers can edit school details. License renewals update expiry dates via webhooks.',
        affectedTriggers: ['on-school-update.ts'],
        mirrorTargets: ['/acl/{managerEmail}'],
        relatedJourneys: ['instructor-licensing'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
        relatedPersonas: ["school-manager", "apprentice-instructor", "hq-admin", "anonymous-visitor"],
        enforcingPermissions: ["read:public-schools", "read:student-roster", "read:school-gradings", "manage:school", "manage:school-roster", "license:school-renewal", "admin:all"],
        tsInterface: `export interface School {
  docId: string;
  schoolId: string;
  name: string;
  managerDocIds: string[];
  instructorIds: string[];
  licenseExpires: string;
  country: string;
  city: string;
  lastUpdated: string;
}`,
        initDefaults: 'initSchool(): managerDocIds: [], instructorIds: []',
        converterFunction: 'firestoreDocToSchool',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Firestore document ID' },
            { name: 'name', type: 'string', required: true, description: 'Official school name' },
            { name: 'managerDocIds', type: 'string[]', required: true, description: 'DocIds of school managers' },
            { name: 'licenseExpires', type: 'string', required: true, description: 'School license expiry date' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp' },
        ],
    },
    {
        id: 'instructor-profile',
        name: 'InstructorPublicData',
        domain: data_type_1.DataDomainGroup.IdentityAuth,
        collectionPath: '/instructors/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/members.ts',
        summary: 'Public instructor directory entry mirrored automatically from certified Member profiles.',
        cardinality: 'One document per licensed instructor.',
        ownership: 'Mirrored from /members/{docId} by Cloud Function trigger.',
        keyRelations: [
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Mirrored source profile' },
            { targetTypeId: 'grading', targetTypeName: 'Grading', relation: 'Subcollection mirrors gradings examined by this instructor' },
        ],
        readRoles: ['Public (anyone)', 'All Members'],
        writeRoles: ['System (mirror trigger on-member-update.ts only)'],
        rulesSummary: 'Publicly readable by all. Client writes forbidden (system-maintained mirror).',
        affectedTriggers: ['mirror-instructors-to-public-profile.ts'],
        mirrorTargets: [],
        relatedJourneys: ['instructor-licensing'],
        relatedFlows: ['trigger-mirroring', 'micro-frontends'],
        relatedPersonas: ["sifu-instructor", "apprentice-instructor", "anonymous-visitor", "hq-admin"],
        enforcingPermissions: ["read:public-instructors", "update:instructor-profile", "mentor:students", "admin:all"],
        tsInterface: `export interface InstructorPublicData {
  docId: string;
  instructorId: string;
  name: string;
  bio: string;
  country: string;
  city: string;
  photoUrl: string;
  licenseExpires: string;
  lastUpdated: string;
}`,
        initDefaults: 'initInstructorPublicData(): default empty strings',
        converterFunction: 'firestoreDocToInstructorPublicData',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Matches Member docId' },
            { name: 'instructorId', type: 'string', required: true, description: 'Assigned instructor ID e.g. 289' },
            { name: 'name', type: 'string', required: true, description: 'Instructor name' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp' },
        ],
    },
    {
        id: 'video-item',
        name: 'VideoItem',
        domain: data_type_1.DataDomainGroup.MediaVod,
        collectionPath: '/videos/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/vod.ts',
        summary: 'Curated Video on Demand (VOD) catalog entry for instructional tutorials, workshops, and class video library recordings.',
        cardinality: 'One document per video asset.',
        ownership: 'Curated and managed by HQ Admins.',
        keyRelations: [
            { targetTypeId: 'video-grant', targetTypeName: 'VideoGrant', relation: 'Grants playback access to individual users' },
            { targetTypeId: 'product', targetTypeName: 'Product', relation: 'Linked to Stripe product for direct purchase' },
        ],
        readRoles: ['Public (metadata and trailer)', 'Authorized Purchasers (full playback)'],
        writeRoles: ['Admin only'],
        rulesSummary: 'Metadata public. Full playback HLS URLs require server signed session token.',
        affectedTriggers: ['on-transcode-finished.ts'],
        mirrorTargets: [],
        relatedJourneys: ['vod-streaming'],
        relatedFlows: ['media-transcoding'],
        relatedPersonas: ["student-practitioner", "active-member", "hq-admin"],
        enforcingPermissions: ["stream:vod", "read:syllabus", "transcoder:gcp", "admin:all"],
        tsInterface: `export interface VideoItem {
  docId: string;
  title: string;
  description: string;
  durationSeconds: number;
  thumbnailUrl: string;
  hlsMasterPlaylistUrl: string;
  accessTier: VodAccessTier;
  trailerVideoId: string;
  stripeProductId: string;
  lastUpdated: string;
}`,
        initDefaults: 'initVideoItem(): accessTier: MembersOnly, duration: 0',
        converterFunction: 'firestoreDocToVideoItem',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Video document ID' },
            { name: 'title', type: 'string', required: true, description: 'Video title' },
            { name: 'durationSeconds', type: 'number', required: true, description: 'Length in seconds' },
            { name: 'accessTier', type: 'VodAccessTier', required: true, description: 'Public, MembersOnly, PurchaseRequired' },
            { name: 'lastUpdated', type: 'string', required: true, description: 'ISO timestamp' },
        ],
    },
    {
        id: 'video-grant',
        name: 'VideoGrant',
        domain: data_type_1.DataDomainGroup.MediaVod,
        collectionPath: '/members/{id}/videoGrants/{videoId} & /videoGrants/{globalGrantKey}',
        isSubcollection: true,
        parentCollection: 'members',
        sourceFile: 'functions/src/data-model/vod.ts',
        summary: 'User access grant record verifying access to a specific VideoItem. Issued via Stripe purchases, gifts from peers, admin complimentary grants, or event attendance.',
        cardinality: 'One document per user per granted video in member subcollection, mirrored to global /videoGrants collection.',
        ownership: 'Owned by member; granted via Stripe fulfillment (self/gift) or Admin direct grant callable.',
        keyRelations: [
            { targetTypeId: 'video-item', targetTypeName: 'VideoItem', relation: 'Target video granted' },
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Parent member subcollection' },
            { targetTypeId: 'order', targetTypeName: 'Order', relation: 'Associated purchase or gift order' },
        ],
        readRoles: ['Owner Member', 'Admin'],
        writeRoles: ['Cloud Functions (Stripe fulfillment) / Admin callable (grantVideoAccess)'],
        rulesSummary: 'Member can read own grants; writes restricted to Cloud Functions and Admin SDK.',
        affectedTriggers: [],
        mirrorTargets: ['/videoGrants/{globalGrantKey}'],
        relatedJourneys: ['vod-streaming'],
        relatedFlows: ['ecommerce-webhooks', 'media-transcoding'],
        relatedPersonas: ["active-member", "student-practitioner", "hq-admin", "system-automation"],
        enforcingPermissions: ["stream:vod", "webhook:stripe", "admin:all", "grant:vod-access"],
        tsInterface: `export type VideoGrant = {
  docId: string;
  videoId: string;
  memberDocId: string;
  memberEmail: string;
  grantKind: VideoGrantKind; // StripePurchase | AdminGrant | EventAttendance | Complimentary | GiftPurchase
  orderDocId?: string;
  stripeSessionId?: string;
  amountPaidCents?: number;
  grantedByMemberDocId?: string;
  giftedByMemberDocId?: string;
  giftedByName?: string;
  giftedByEmail?: string;
  giftMessage?: string;
  notes?: string;
  grantedAt: string;
  expiresAt?: string;
};`,
        initDefaults: 'initVideoGrant(videoId, memberDocId): grantKind: StripePurchase, grantedAt: nowIso',
        converterFunction: 'firestoreDocToVideoGrant',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Matches videoId' },
            { name: 'videoId', type: 'string', required: true, description: 'Granted video docId' },
            { name: 'memberDocId', type: 'string', required: true, description: 'Member document ID' },
            { name: 'memberEmail', type: 'string', required: true, description: 'Recipient email snapshot' },
            { name: 'grantKind', type: 'VideoGrantKind', required: true, description: 'stripe_purchase | admin_grant | event_attendance | complimentary | gift_purchase' },
            { name: 'orderDocId', type: 'string', required: false, description: 'Reference to associated /orders/{orderDocId}' },
            { name: 'stripeSessionId', type: 'string', required: false, description: 'Stripe checkout session ID' },
            { name: 'giftedByMemberDocId', type: 'string', required: false, description: 'Member docId of gift sender' },
            { name: 'giftedByName', type: 'string', required: false, description: 'Display name snapshot of gift sender' },
            { name: 'giftedByEmail', type: 'string', required: false, description: 'Email address of gift sender' },
            { name: 'giftMessage', type: 'string', required: false, description: 'Optional personal greeting from gift sender' },
            { name: 'grantedByMemberDocId', type: 'string', required: false, description: 'Admin docId if granted manually via grantVideoAccess' },
            { name: 'notes', type: 'string', required: false, description: 'Reason or reference notes' },
            { name: 'grantedAt', type: 'string', required: true, description: 'ISO 8601 timestamp of grant issuance' },
            { name: 'expiresAt', type: 'string', required: false, description: 'Optional expiration timestamp for temporary access' },
        ],
    },
    {
        id: 'video-progress',
        name: 'VideoProgress',
        domain: data_type_1.DataDomainGroup.MediaVod,
        collectionPath: '/members/{id}/videoProgress/{videoId}',
        isSubcollection: true,
        parentCollection: 'members',
        sourceFile: 'functions/src/data-model/vod.ts',
        summary: 'Playback resume state and completion marker for a member on a specific video.',
        cardinality: 'One document per user per watched video.',
        ownership: 'Maintained by member video player component.',
        keyRelations: [{ targetTypeId: 'video-item', targetTypeName: 'VideoItem', relation: 'Watched video' }],
        readRoles: ['Owner Member'],
        writeRoles: ['Owner Member'],
        rulesSummary: 'Member can read and write their own progress records.',
        affectedTriggers: [],
        mirrorTargets: [],
        relatedJourneys: ['vod-streaming'],
        relatedFlows: ['client-reactivity'],
        relatedPersonas: ["active-member", "student-practitioner", "hq-admin"],
        enforcingPermissions: ["stream:vod", "admin:all"],
        tsInterface: `export interface VideoProgress {
  videoId: string;
  currentTimeSeconds: number;
  completed: boolean;
  lastUpdated: string;
}`,
        initDefaults: 'currentTimeSeconds: 0, completed: false',
        converterFunction: 'firestoreDocToVideoProgress',
        fields: [
            { name: 'currentTimeSeconds', type: 'number', required: true, description: 'Resume playback timestamp' },
            { name: 'completed', type: 'boolean', required: true, description: 'Whether video was watched to conclusion' },
        ],
    },
    {
        id: 'order',
        name: 'Order',
        domain: data_type_1.DataDomainGroup.CommerceFulfillment,
        collectionPath: '/orders/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/orders.ts',
        summary: 'A financial transaction record representing an e-commerce checkout, subscription invoice, or imported legacy order.',
        cardinality: 'One document per order.',
        ownership: 'Recorded by Stripe webhooks or Squarespace/Sheets importers.',
        keyRelations: [
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Links customer email and memberDocId' },
            { targetTypeId: 'grading', targetTypeName: 'Grading', relation: 'Settles grading fees' },
            { targetTypeId: 'video-grant', targetTypeName: 'VideoGrant', relation: 'Issues video licenses' },
            { targetTypeId: 'event-registration', targetTypeName: 'EventRegistration', relation: 'Fulfills event tickets' },
        ],
        readRoles: ['Admin (all orders)', 'Customer Member (matching customerEmail)'],
        writeRoles: ['Cloud Functions (Stripe webhook receiver only)'],
        rulesSummary: 'Customer can read their own orders. Client mutations strictly forbidden.',
        affectedTriggers: ['stripe-webhook.ts'],
        mirrorTargets: ['/members/{memberDocId}/orders/{orderDocId}'],
        relatedJourneys: ['event-hosting-ticketing', 'vod-streaming', 'instructor-licensing'],
        relatedFlows: ['ecommerce-webhooks'],
        relatedPersonas: ["active-member", "grading-candidate", "external-attendee", "school-manager", "hq-admin", "system-automation"],
        enforcingPermissions: ["read:own-orders", "manage:billing-portal", "purchase:grading-fee", "license:school-renewal", "override:orders", "webhook:stripe", "admin:all"],
        tsInterface: `export interface Order {
  docId: string;
  orderNumber: string;
  source: 'stripe' | 'squarespace' | 'sheets';
  customerEmail: string;
  customerName: string;
  lineItems: OrderLineItem[];
  totalAmountCents: number;
  currency: string;
  paymentStatus: 'paid' | 'pending' | 'refunded';
  settled: boolean;
  orderDate: string;
  lastUpdated: string;
}`,
        initDefaults: 'initOrder(): paymentStatus: pending, settled: false, lineItems: []',
        converterFunction: 'firestoreDocToOrder',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Order document ID' },
            { name: 'customerEmail', type: 'string', required: true, description: 'Customer email' },
            { name: 'totalAmountCents', type: 'number', required: true, description: 'Total price in cents' },
            { name: 'settled', type: 'boolean', required: true, description: 'Whether fulfillment actions ran' },
        ],
    },
    {
        id: 'acl',
        name: 'ACL',
        domain: data_type_1.DataDomainGroup.IdentityAuth,
        collectionPath: '/acl/{email}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/system.ts',
        summary: 'Fast-lookup authorization document keyed by lowercase login email caching global roles, member docIds, and license expirations.',
        cardinality: 'One document per unique login email.',
        ownership: 'System-maintained by Cloud Functions triggers.',
        keyRelations: [
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Aggregates member profiles matching email' },
            { targetTypeId: 'school', targetTypeName: 'School', relation: 'Caches school manager privileges' },
        ],
        readRoles: ['Admin (all ACLs)', 'Self (matching email)'],
        writeRoles: ['System triggers only'],
        rulesSummary: 'Self can read own ACL. Writes completely blocked for all clients.',
        affectedTriggers: ['on-member-update.ts', 'on-school-update.ts'],
        mirrorTargets: [],
        relatedJourneys: ['member-onboarding', 'instructor-licensing'],
        relatedFlows: ['trigger-mirroring'],
        relatedPersonas: ["active-member", "hq-admin", "system-automation"],
        enforcingPermissions: ["admin:all", "service:firebase-admin"],
        tsInterface: `export interface ACL {
  email: string;
  isAdmin: boolean;
  memberDocIds: string[];
  instructorIds: string[];
  membershipExpires: string;
  instructorLicenseExpires: string;
  schoolDocIds: string[];
  schoolLicenseExpires: string;
  notYetLinkedToMember: boolean;
  lastUpdated: string;
}`,
        initDefaults: 'initAcl(): isAdmin: false, memberDocIds: [], expiry dates empty',
        converterFunction: 'firestoreDocToAcl',
        fields: [
            { name: 'email', type: 'string', required: true, description: 'Lowercase user email' },
            { name: 'isAdmin', type: 'boolean', required: true, description: 'Admin privileges' },
            { name: 'membershipExpires', type: 'string', required: true, description: 'Membership expiration date or life' },
        ],
    },
    {
        id: 'product',
        name: 'Product',
        domain: data_type_1.DataDomainGroup.EventsTicketing,
        collectionPath: '/products/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/events.ts',
        summary: 'Pricing model and tier definition for event tickets, annual memberships, instructor licenses, and video purchases.',
        cardinality: 'One document per purchasable tier.',
        ownership: 'Curated by Admins and Event Organizers.',
        keyRelations: [
            { targetTypeId: 'ilc-event', targetTypeName: 'IlcEvent', relation: 'Provides ticket pricing for events' },
            { targetTypeId: 'order', targetTypeName: 'Order', relation: 'Referenced in order line items' },
        ],
        readRoles: ['Public / All Members'],
        writeRoles: ['Admin / Event Organizer'],
        rulesSummary: 'Publicly readable. Admins and organizers can update event product pricing.',
        affectedTriggers: [],
        mirrorTargets: [],
        relatedJourneys: ['event-hosting-ticketing'],
        relatedFlows: ['ecommerce-webhooks'],
        relatedPersonas: ["active-member", "anonymous-visitor", "hq-admin"],
        enforcingPermissions: ["admin:all"],
        tsInterface: `export interface Product {
  docId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  stripePriceId: string;
  stripeProductId: string;
  category: 'membership' | 'license' | 'event_ticket' | 'video' | 'grading';
  lastUpdated: string;
}`,
        initDefaults: 'initProduct(): priceCents: 0, currency: USD',
        converterFunction: 'firestoreDocToProduct',
        fields: [
            { name: 'docId', type: 'string', required: true, description: 'Product document ID' },
            { name: 'name', type: 'string', required: true, description: 'Product title' },
            { name: 'priceCents', type: 'number', required: true, description: 'Price in cents' },
        ],
    },
    {
        id: 'post',
        name: 'Post',
        domain: data_type_1.DataDomainGroup.CommunityContent,
        collectionPath: '/members-post/{id}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/content-cache.ts',
        summary: 'Community announcement, training article, or instructor message.',
        cardinality: 'One document per article.',
        ownership: 'Authored by instructors and admins.',
        keyRelations: [{ targetTypeId: 'member', targetTypeName: 'Member', relation: 'Author member profile' }],
        readRoles: ['Members (members-post)', 'Public (articles-post)'],
        writeRoles: ['Instructors / Admins'],
        rulesSummary: 'Public or member read based on collection path.',
        affectedTriggers: [],
        mirrorTargets: [],
        relatedJourneys: [],
        relatedFlows: ['client-reactivity'],
        relatedPersonas: ["student-practitioner", "anonymous-visitor", "sifu-instructor", "hq-admin"],
        enforcingPermissions: ["read:public-data", "admin:all"],
        tsInterface: `export interface Post {
  docId: string;
  title: string;
  contentMarkdown: string;
  authorMemberDocId: string;
  publishedDate: string;
  lastUpdated: string;
}`,
        initDefaults: 'initPost(): empty title and markdown',
        converterFunction: 'firestoreDocToPost',
        fields: [
            { name: 'title', type: 'string', required: true, description: 'Post title' },
            { name: 'contentMarkdown', type: 'string', required: true, description: 'Markdown body' },
        ],
    },
    {
        id: 'system',
        name: 'System',
        domain: data_type_1.DataDomainGroup.SystemInfrastructure,
        collectionPath: '/system/{doc}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/system.ts',
        summary: 'Global sequence counters, country code registries, and synchronization cache timestamps.',
        cardinality: 'Singleton documents in /system.',
        ownership: 'System-maintained; managed by HQ Admin.',
        keyRelations: [{ targetTypeId: 'member', targetTypeName: 'Member', relation: 'Generates member sequential IDs' }],
        readRoles: ['Authenticated Members (counters)', 'Admin (all)'],
        writeRoles: ['Admin / System Triggers'],
        rulesSummary: 'Read allowed for counter allocation; writes restricted to admin and triggers.',
        affectedTriggers: [],
        mirrorTargets: [],
        relatedJourneys: ['member-onboarding'],
        relatedFlows: ['trigger-mirroring'],
        relatedPersonas: ["hq-admin", "system-automation"],
        enforcingPermissions: ["manage:backups", "admin:all", "service:firebase-admin"],
        tsInterface: `export interface Counters {
  nextMemberNumber: number;
  nextInstructorNumber: number;
  lastUpdated: string;
}`,
        initDefaults: 'nextMemberNumber: 1, nextInstructorNumber: 1',
        converterFunction: 'firestoreDocToCounters',
        fields: [
            { name: 'nextMemberNumber', type: 'number', required: true, description: 'Next sequential member ID' },
        ],
    },
    {
        id: 'mail',
        name: 'MailQueueDoc',
        domain: data_type_1.DataDomainGroup.SystemInfrastructure,
        collectionPath: '/mail/{docId}',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/mail.ts',
        summary: 'Outbound transactional and scheduled email queue documents. Tracks delivery state machine (PENDING -> PROCESSING -> SUCCESS | ERROR | PAUSED), retry metadata, attempt counters, and Nodemailer SMTP message headers.',
        cardinality: 'One document per enqueued outbound email.',
        ownership: 'Created by server-side Cloud Functions (Admin SDK); inspected and managed by HQ Administrators.',
        keyRelations: [
            { targetTypeId: 'order', targetTypeName: 'Order', relation: 'Enqueued on purchase confirmations' },
            { targetTypeId: 'member', targetTypeName: 'Member', relation: 'Enqueued on member onboarding welcome emails' },
            { targetTypeId: 'ilc-event', targetTypeName: 'IlcEvent', relation: 'Enqueued for weekly/monthly event digests' },
            { targetTypeId: 'mail-settings', targetTypeName: 'MailSettings', relation: 'Global dispatch behavior governed by /system/mail-settings' },
            { targetTypeId: 'video-grant', targetTypeName: 'VideoGrant', relation: 'Enqueued when VOD access is gifted or granted (vodGiftReceived)' },
        ],
        readRoles: ['Admin (HQ)'],
        writeRoles: ['None (allow write: if false; direct client writes strictly prohibited; mediated exclusively by Cloud Functions)'],
        rulesSummary: 'Direct client writes are prohibited (allow write: if false;). Closed security model prevents open relay or malicious mail injection.',
        affectedTriggers: ['mail-processor.ts (processMailQueue)'],
        mirrorTargets: [],
        relatedJourneys: ['member-onboarding', 'event-hosting-ticketing', 'outbound-email-notifications', 'vod-streaming'],
        relatedFlows: ['ecommerce-webhooks', 'email-queue-processor'],
        relatedPersonas: ["hq-admin", "system-automation"],
        enforcingPermissions: ["admin:all", "service:firebase-admin"],
        tsInterface: `export interface MailQueueDoc {
  docId?: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  subject?: string;
  text?: string;
  html?: string;
  message?: MailMessage;
  status?: MailDeliveryState;
  delivery?: MailDeliveryInfo;
  metadata?: MailMetadata;
  templateKey?: string;
  templateData?: Record<string, string>;
  createdAt?: unknown;
}`,
        initDefaults: 'initMailDoc(): to: [], from: "", replyTo: "", status: "PENDING", delivery: { state: "PENDING", attempts: 0 }',
        converterFunction: 'initMailDoc',
        fields: [
            { name: 'to', type: 'string | string[]', required: true, description: 'Recipient email address(es)' },
            { name: 'from', type: 'string', required: false, description: 'Sender email (e.g. notifications@iliqchuan.com)' },
            { name: 'replyTo', type: 'string', required: false, description: 'Reply-to mailbox (e.g. web-helper-team@iliqchuan.com)' },
            { name: 'subject', type: 'string', required: false, description: 'Subject line' },
            { name: 'text', type: 'string', required: false, description: 'Plain-text body' },
            { name: 'html', type: 'string', required: false, description: 'Rendered HTML email body' },
            { name: 'status', type: 'MailDeliveryState', required: false, description: 'PENDING | PROCESSING | SUCCESS | ERROR | PAUSED' },
            { name: 'delivery', type: 'MailDeliveryInfo', required: false, description: 'Execution metadata, attempts count, messageId, and error trace' },
            { name: 'metadata', type: 'MailMetadata', required: false, description: 'Context tags e.g. adminTest, templateKey, orderNumber' },
        ],
    },
    {
        id: 'mail-settings',
        name: 'MailSettings',
        domain: data_type_1.DataDomainGroup.SystemInfrastructure,
        collectionPath: '/system/mail-settings',
        isSubcollection: false,
        sourceFile: 'functions/src/data-model/mail.ts',
        summary: 'Global dispatch state governing system outbound mail (Off, Paused, Active). Supports zero-write enforcement on Off, placeholder queuing on Paused, and deferred template interpretation upon activation.',
        cardinality: 'Singleton document at /system/mail-settings.',
        ownership: 'Managed by HQ Administrators via Email Notifications space.',
        keyRelations: [
            { targetTypeId: 'mail', targetTypeName: 'MailQueueDoc', relation: 'Controls queue dispatch and placeholder release' },
        ],
        readRoles: ['Public (read status indicators)', 'Admin (HQ)'],
        writeRoles: ['Admin (HQ) via callable setMailSendingState'],
        rulesSummary: 'Public read allowed for status indicators; secrets isolated in /system/mail-secrets. Write modified via secure callable Cloud Function setMailSendingState.',
        affectedTriggers: ['mail-processor.ts (processMailQueue)'],
        mirrorTargets: [],
        relatedJourneys: ['outbound-email-notifications'],
        relatedFlows: ['email-queue-processor', 'one-click-unsubscribe'],
        relatedPersonas: ["hq-admin", "system-automation"],
        enforcingPermissions: ["admin:all", "service:firebase-admin"],
        tsInterface: `export interface MailSettings {
  status: MailSendingStatus; // 'active' | 'paused' | 'off'
  sendingPaused?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  pausedAt?: string;
  resumedAt?: string;
}`,
        initDefaults: 'initMailSettings(): status: MailSendingStatus.Off, sendingPaused: false',
        converterFunction: 'initMailSettings',
        fields: [
            { name: 'status', type: 'MailSendingStatus', required: true, description: 'active | paused | off' },
            { name: 'sendingPaused', type: 'boolean', required: false, description: 'Legacy boolean flag' },
            { name: 'updatedAt', type: 'string', required: false, description: 'ISO timestamp of state change' },
            { name: 'updatedBy', type: 'string', required: false, description: 'Admin email who modified status' },
        ],
    },
];
//# sourceMappingURL=data-types-catalog.js.map