/**
 * Cloud Functions entrypoint.
 *
 * Each export is registered as an enumerable lazy getter so that:
 * - At deploy time (`firebase deploy`), Firebase CLI enumerates `exports` and
 *   discovers every trigger manifest identically to static re-exports.
 * - At runtime on Cloud Run (`FUNCTION_TARGET=<name>`), `@google-cloud/functions-framework`
 *   accesses only `exports[FUNCTION_TARGET]`, loading just that function's
 *   module instead of all 80+ triggers and heavy SDKs (Stripe, Nodemailer,
 *   Axios, WebPush, Firestore gRPC). This keeps latency-critical triggers like
 *   Identity Platform's `beforeSignIn` / `beforeCreate` (7s hard deadline) fast
 *   on cold start.
 */
import * as admin from 'firebase-admin';

let firebaseInitialized = false;
function ensureFirebaseInitialized(): void {
  if (firebaseInitialized) return;
  firebaseInitialized = true;
  if (admin.apps.length === 0) {
    admin.initializeApp();
    admin.firestore().settings({ ignoreUndefinedProperties: true });
  }
}

function lazy<M, K extends keyof M & string>(
  load: () => M,
  key: K,
  options?: { skipFirebaseInit?: boolean },
): void {
  Object.defineProperty(exports, key, {
    enumerable: true,
    configurable: true,
    get(): M[K] {
      if (!options?.skipFirebaseInit) {
        ensureFirebaseInitialized();
      }
      return load()[key];
    },
  });
}

function lazyAll<M extends Record<string, unknown>>(
  load: () => M,
  keys: readonly (keyof M & string)[],
  options?: { skipFirebaseInit?: boolean },
): void {
  for (const key of keys) {
    lazy(load, key, options);
  }
}

lazy(() => require('./calendar') as typeof import('./calendar'), 'getCalendarEvents');
lazy(() => require('./get-user-details') as typeof import('./get-user-details'), 'getUserDetails');
lazyAll(() => require('./counters') as typeof import('./counters'), [
  'nextMemberId',
  'nextInstructorId',
  'nextSchoolId',
  'updateCounters',
]);

lazy(() => require('./http-logger-example') as typeof import('./http-logger-example'), 'httpLogger');

lazyAll(() => require('./on-member-update') as typeof import('./on-member-update'), [
  'onMemberCreated',
  'onMemberUpdated',
  'onMemberDeleted',
]);

lazyAll(() => require('./on-school-update') as typeof import('./on-school-update'), [
  'onSchoolCreated',
  'onSchoolUpdated',
  'onSchoolDeleted',
]);

lazyAll(() => require('./on-grading-update') as typeof import('./on-grading-update'), [
  'onGradingCreated',
  'onGradingUpdated',
  'onGradingDeleted',
]);

lazyAll(() => require('./grading-request') as typeof import('./grading-request'), [
  'requestGrading',
  'requestGradingRetake',
]);

lazyAll(() => require('./instructor-students') as typeof import('./instructor-students'), [
  'removeStudentFromInstructor',
  'markStudentInactive',
]);

lazy(() => require('./send-push') as typeof import('./send-push'), 'sendPushOnNotification');

lazyAll(() => require('./backup') as typeof import('./backup'), [
  'scheduledBackup',
  'manualBackup',
  'listBackups',
]);

lazyAll(() => require('./squarespace-orders') as typeof import('./squarespace-orders'), [
  'syncSquarespaceOrders',
  'processSquarespaceOrder',
  'manualSquarespaceSync',
  'reprocessOrder',
]);

lazyAll(() => require('./compute-statistics') as typeof import('./compute-statistics'), [
  'computeStatistics',
  'manualComputeStatistics',
]);

lazy(() => require('./check-email-status') as typeof import('./check-email-status'), 'checkEmailStatus');
lazyAll(
  () => require('./auth-blocking') as typeof import('./auth-blocking'),
  ['beforeCreate', 'beforeSignIn'],
  { skipFirebaseInit: true },
);
lazy(() => require('./auth-blocking') as typeof import('./auth-blocking'), 'setAccountPassword');

lazyAll(() => require('./content-cache') as typeof import('./content-cache'), [
  'refreshContentCache',
  'manualRefreshCache',
  'clearContentCache',
]);

lazyAll(() => require('./account-deletion') as typeof import('./account-deletion'), [
  'scheduleAccountDeletion',
  'cancelAccountDeletion',
  'dailyAccountCleanup',
]);

lazyAll(() => require('./proposed-events') as typeof import('./proposed-events'), [
  'submitProposedEvent',
  'onEventUpdated',
  'onEventCreated',
  'onEventDeleted',
]);

lazyAll(() => require('./resources') as typeof import('./resources'), [
  'listResources',
  'deleteResource',
  'getResourceDownloadUrl',
]);

lazy(() => require('./social-preview') as typeof import('./social-preview'), 'socialPreview');

lazyAll(() => require('./stripe-products') as typeof import('./stripe-products'), [
  'refreshStripeProducts',
  'manualRefreshStripeProducts',
]);

lazyAll(() => require('./stripe-checkout') as typeof import('./stripe-checkout'), [
  'createStripeCheckoutSession',
  'getStripeCheckoutSession',
]);
lazy(() => require('./grading-checkout') as typeof import('./grading-checkout'), 'createGradingCheckoutSession');
lazyAll(() => require('./stripe-product-checkout') as typeof import('./stripe-product-checkout'), [
  'createProductCheckoutSession',
  'updateProductRegistration',
  'registerEventInPerson',
  'markEventRegistrationPaid',
  'unmarkEventRegistrationPaid',
  'adminUpdateEventRegistration',
]);
lazy(
  () => require('./on-event-registration-update') as typeof import('./on-event-registration-update'),
  'onEventRegistrationWritten',
);

lazyAll(() => require('./stripe-subscriptions') as typeof import('./stripe-subscriptions'), [
  'cancelSubscriptionRenewal',
  'resumeSubscriptionRenewal',
  'createCustomerPortalSession',
  'getManagedSchoolsBilling',
  'updateSubscriptionRenewalDate',
  'createSubscriptionPaymentMethodSession',
  'removeSubscriptionPaymentMethod',
]);

lazy(() => require('./stripe-webhook') as typeof import('./stripe-webhook'), 'stripeWebhook');

lazy(() => require('./vod/transcode-video') as typeof import('./vod/transcode-video'), 'transcodeVideoForVod');
lazy(
  () => require('./vod/get-playback-session') as typeof import('./vod/get-playback-session'),
  'getVideoPlaybackSession',
);
lazy(() => require('./vod/delete-video') as typeof import('./vod/delete-video'), 'deleteVideoFromCatalog');
lazy(
  () => require('./vod/check-vod-job-status') as typeof import('./vod/check-vod-job-status'),
  'checkVodJobStatus',
);
lazy(
  () => require('./vod/on-transcode-finished') as typeof import('./vod/on-transcode-finished'),
  'onTranscodeJobFinished',
);
lazy(() => require('./vod/grant-video') as typeof import('./vod/grant-video'), 'grantVideoAccess');
lazy(
  () => require('./vod/create-vod-checkout-session') as typeof import('./vod/create-vod-checkout-session'),
  'createVodCheckoutSession',
);

lazyAll(() => require('./event-digest-scheduler') as typeof import('./event-digest-scheduler'), [
  'sendWeeklyEventDigest',
  'sendMonthlyEventDigest',
]);

lazyAll(() => require('./mail-processor') as typeof import('./mail-processor'), [
  'processMailQueue',
  'sendAdminTestEmail',
  'retryMailItem',
  'setMailSendingPaused',
  'setMailSendingState',
  'deleteMailItems',
  'updateMailItem',
]);

lazy(() => require('./unsubscribe-handler') as typeof import('./unsubscribe-handler'), 'unsubscribeHandler');

lazy(() => require('./manage-admin') as typeof import('./manage-admin'), 'setAdminPrivilege');

Object.defineProperty(exports, 'actions', {
  enumerable: true,
  configurable: true,
  get(): typeof import('./actions') {
    ensureFirebaseInitialized();
    return require('./actions') as typeof import('./actions');
  },
});
