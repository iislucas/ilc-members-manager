/* flows-catalog.ts
 *
 * Authoritative registry of all end-to-end information flow pipelines (View 4).
 */

import { ArchFlowEntry, FlowCategory } from '../models/arch-flow';

export const FLOWS_CATALOG: ArchFlowEntry[] = [
  {
    id: 'client-reactivity',
    title: 'Client UI Reactivity & Real-Time Snapshot Pipeline',
    category: FlowCategory.ClientReactivity,
    summary:
      'How user gestures update Angular Signals, propagate mutations to Cloud Firestore, and reflect real-time onSnapshot changes without manual page refreshes.',
    trigger: 'User interacts with an input or form (e.g. grading status change, profile update).',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Component UI',
        targetTier: 'Angular Signals / Forms',
        action: 'Form input updates signal value or calls data manager mutation method',
        payloadDescription: 'Typed mutation object e.g. Partial<Grading>',
        codePointers: ['src/app/grading-edit/grading-edit.ts'],
      },
      {
        stepNumber: 2,
        sourceTier: 'DataManagerService',
        targetTier: 'Cloud Firestore Client SDK',
        action: 'Calls setDoc or updateDoc with serverTimestamp()',
        payloadDescription: 'Firestore document write payload',
        codePointers: ['src/app/data-manager.service.ts'],
      },
      {
        stepNumber: 3,
        sourceTier: 'Cloud Firestore',
        targetTier: 'onSnapshot Listener',
        action: 'Firestore pushes updated document snapshot via active WebSocket',
        payloadDescription: 'DocumentSnapshot containing raw data',
        codePointers: ['src/app/data-manager.service.ts'],
      },
      {
        stepNumber: 4,
        sourceTier: 'SearchableSet',
        targetTier: 'MiniSearch & Signals',
        action: 'Converter firestoreDocToXxx merges defaults; MiniSearch re-indexes; signal updates',
        payloadDescription: 'Complete immutable domain object',
        codePointers: ['src/app/searchable-set.ts'],
      },
      {
        stepNumber: 5,
        sourceTier: 'Angular View Engine',
        targetTier: 'DOM Render',
        action: 'OnPush change detection evaluates computed signals and updates template with zero zone overhead',
        payloadDescription: 'DOM updates',
        codePointers: ['src/app/app.config.ts'],
      },
    ],
    inputDataTypes: ['member', 'grading', 'ilc-event'],
    outputDataTypes: ['member', 'grading', 'ilc-event'],
    cloudFunctions: [],
    clientServices: ['DataManagerService', 'FirebaseStateService', 'NavigationTreeService'],
    mermaidDiagram: `flowchart LR
    User[User Input] --> Signal[Angular Signal Form]
    Signal --> DMS[DataManagerService]
    DMS --> FS[(Cloud Firestore)]
    FS -.-> Snap[onSnapshot Listener]
    Snap --> Set[SearchableSet / MiniSearch]
    Set --> View[OnPush Component View]`,
  },
  {
    id: 'trigger-mirroring',
    title: 'Cloud Trigger Automation & Subcollection Fan-Out Pipeline',
    category: FlowCategory.TriggerMirroring,
    summary:
      'How database writes fire background Cloud Functions to maintain ACL caches, mirror rosters to school/instructor subcollections, and dispatch notifications.',
    trigger: 'A document in /gradings/{id}, /members/{id}, or /schools/{id} is created or modified in Firestore.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Cloud Firestore',
        targetTier: 'Cloud Function Trigger',
        action: 'Document write triggers onUpdate or onCreate cloud function',
        payloadDescription: 'Change<DocumentSnapshot>',
        codePointers: ['functions/src/on-grading-update.ts', 'functions/src/on-member-update.ts'],
      },
      {
        stepNumber: 2,
        sourceTier: 'Trigger Handler',
        targetTier: 'Mirroring Subcollections',
        action: 'Mirrors document copy to /schools/{schoolId}/gradings and /instructors/{instId}/gradings',
        payloadDescription: 'Mirrored document payload',
        codePointers: ['functions/src/on-grading-update.ts'],
      },
      {
        stepNumber: 3,
        sourceTier: 'Trigger Handler',
        targetTier: 'ACL Cache',
        action: 'Rebuilds user permissions snapshot in /acl/{lowercaseEmail}',
        payloadDescription: 'ACL object',
        codePointers: ['functions/src/on-member-update.ts'],
      },
      {
        stepNumber: 4,
        sourceTier: 'Trigger Handler',
        targetTier: 'Notifications Store',
        action: 'Generates MemberNotification in /members/{targetMemberDocId}/notifications',
        payloadDescription: 'MemberNotification object',
        codePointers: ['functions/src/on-grading-update.ts'],
      },
    ],
    inputDataTypes: ['grading', 'member', 'school'],
    outputDataTypes: ['grading', 'member', 'acl'],
    cloudFunctions: ['onGradingUpdate', 'onMemberUpdate', 'onSchoolUpdate', 'mirrorInstructorsToPublicProfile'],
    clientServices: ['DataManagerService', 'NotificationService'],
    mermaidDiagram: `flowchart TD
    Write[(Firestore Write)] --> Trigger[Cloud Trigger Function]
    Trigger --> Mirror[(Subcollection Mirrors\n/schools, /instructors)]
    Trigger --> ACL[(ACL Cache\n/acl/{email})]
    Trigger --> Notif[(In-App Notification\n/members/{id}/notifications)]`,
  },
  {
    id: 'ecommerce-webhooks',
    title: 'E-Commerce Checkout & Stripe Webhook Fulfillment Pipeline',
    category: FlowCategory.ECommerceWebhooks,
    summary:
      'The flow from initiating a checkout session for memberships, tickets, or gradings through Stripe payment settlement, webhook validation, and automated fulfillment.',
    trigger: 'User completes a purchase on Stripe Checkout or recurring subscription renews.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Client',
        targetTier: 'Cloud Function Callable',
        action: 'Calls createStripeCheckoutSession with product docId or tier',
        payloadDescription: 'Product reference & return URLs',
        codePointers: ['src/app/stripe.service.ts', 'functions/src/stripe-checkout.ts'],
      },
      {
        stepNumber: 2,
        sourceTier: 'Stripe Platform',
        targetTier: 'Webhook HTTP Endpoint',
        action: 'Stripe dispatches checkout.session.completed or invoice.paid',
        payloadDescription: 'Stripe Event JSON with HMAC signature header',
        codePointers: ['functions/src/stripe-webhook.ts'],
      },
      {
        stepNumber: 3,
        sourceTier: 'Webhook Handler',
        targetTier: 'Orders Collection',
        action: 'Verifies Stripe signature, records transaction in /orders/{docId}',
        payloadDescription: 'Order document with paymentStatus: paid',
        codePointers: ['functions/src/stripe-webhook.ts'],
      },
      {
        stepNumber: 4,
        sourceTier: 'Fulfillment Engine',
        targetTier: 'Target Collections',
        action: 'Fulfills line items: extends member expiration, marks grading paid, grants VOD, issues event registration',
        payloadDescription: 'Fulfillment updates across Member, Grading, EventRegistration',
        codePointers: ['functions/src/stripe-fulfillment.ts'],
      },
    ],
    inputDataTypes: ['product', 'order'],
    outputDataTypes: ['order', 'member', 'grading', 'event-registration', 'video-grant'],
    cloudFunctions: ['createStripeCheckoutSession', 'stripeWebhook'],
    clientServices: ['StripeService', 'DataManagerService'],
    mermaidDiagram: `flowchart LR
    Client[Client App] --> Checkout[createStripeCheckoutSession]
    Checkout --> StripePlatform[Stripe Checkout]
    StripePlatform --> Webhook[stripeWebhook]
    Webhook --> Order[(Order Record)]
    Webhook --> Fulfill[stripe-fulfillment.ts]
    Fulfill --> Members[(Members / Gradings / Tickets)]`,
  },
  {
    id: 'media-transcoding',
    title: 'VOD Media Transcoding & HLS Streaming Pipeline',
    category: FlowCategory.MediaTranscoding,
    summary:
      'Automated pipeline from master video file upload in GCS to GCP Transcoder API, multi-bitrate HLS generation, access token authorization, and offline player caching.',
    trigger: 'Administrator uploads a video master file or member requests playback.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Admin / Storage',
        targetTier: 'Cloud Storage Incoming',
        action: 'Master video file uploaded to incoming storage bucket',
        payloadDescription: 'Raw MP4 master',
        codePointers: ['src/app/manage-vod/manage-vod.ts'],
      },
      {
        stepNumber: 2,
        sourceTier: 'Transcode Trigger',
        targetTier: 'GCP Cloud Transcoder API',
        action: 'Submits transcoding job generating multi-bitrate HLS streams (.m3u8 and .ts fragments)',
        payloadDescription: 'Transcoder Job Config',
        codePointers: ['functions/src/vod/transcode-video.ts'],
      },
      {
        stepNumber: 3,
        sourceTier: 'Pub/Sub',
        targetTier: 'onTranscodeFinished',
        action: 'Transcoder completion fires Pub/Sub message; updates /videos/{id} with master playlist URL',
        payloadDescription: 'Status update to ready',
        codePointers: ['functions/src/vod/on-transcode-finished.ts'],
      },
      {
        stepNumber: 4,
        sourceTier: 'Member Video Player',
        targetTier: 'getVideoPlaybackSession',
        action: 'Calls session callable; validates VideoGrant or subscription; returns signed playback token',
        payloadDescription: 'Signed token & HLS URL',
        codePointers: ['functions/src/vod/get-playback-session.ts'],
      },
      {
        stepNumber: 5,
        sourceTier: 'VideoPlayerComponent',
        targetTier: 'Hls.js / IndexedDB',
        action: 'Hls.js streams adaptive video; user can download fragments into browser IndexedDB for offline viewing',
        payloadDescription: 'HLS segment buffers',
        codePointers: ['src/app/video-player/video-player.ts', 'src/app/vod-offline-storage.service.ts'],
      },
    ],
    inputDataTypes: ['video-item', 'video-grant'],
    outputDataTypes: ['video-item', 'video-progress'],
    cloudFunctions: ['transcodeVideo', 'onTranscodeFinished', 'getVideoPlaybackSession'],
    clientServices: ['VodOfflineStorageService'],
    mermaidDiagram: `flowchart TD
    Upload[Raw Video Upload] --> Transcoder[GCP Transcoder API]
    Transcoder --> HLS[Multi-bitrate HLS Streams]
    HLS --> Ready[onTranscodeFinished Trigger]
    Ready --> VideoDoc[(/videos/{id} Ready)]
    PlayReq[Player Request] --> Session[getVideoPlaybackSession]
    Session --> Player[Hls.js Player + IndexedDB Cache]`,
  },
  {
    id: 'micro-frontends',
    title: 'Public Micro-Frontend Web Components Embedding Pipeline',
    category: FlowCategory.MicroFrontends,
    summary:
      'Packaging Angular components as standalone Web Components for embedding the event calendar and instructor directory on external affiliate websites.',
    trigger: 'A third-party website loads the embed script.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Build',
        targetTier: 'Angular Elements Bundle',
        action: 'Compiles events-viewer-wc and find-an-instructor-wc into standalone JS/CSS assets',
        payloadDescription: 'dist/events-viewer-wc/events-viewer.wc.js',
        codePointers: ['src/events-viewer.wc.ts', 'src/find-an-instructor.wc.ts'],
      },
      {
        stepNumber: 2,
        sourceTier: 'Third-Party Webpage',
        targetTier: 'Custom Element DOM',
        action: 'Includes script tag and places <events-viewer> custom element on page',
        payloadDescription: 'Custom element initialization',
        codePointers: ['src/events-viewer.wc.html'],
      },
      {
        stepNumber: 3,
        sourceTier: 'Web Component',
        targetTier: 'Public Firestore',
        action: 'Component queries public events and published instructors directly without authentication',
        payloadDescription: 'Public published snapshot streams',
        codePointers: ['src/app/events-viewer/events-viewer.component.ts'],
      },
    ],
    inputDataTypes: ['ilc-event', 'instructor-profile'],
    outputDataTypes: [],
    cloudFunctions: [],
    clientServices: ['FindInstructorsService'],
    mermaidDiagram: `flowchart LR
    Build[ng build --project events-viewer-wc] --> Bundle[Standalone Web Component]
    Bundle --> Embed[Third-Party Site <events-viewer>]
    Embed --> Read[(Public Firestore Collections)]`,
  },
];
