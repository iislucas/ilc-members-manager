/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
import * as admin from 'firebase-admin';

admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

export { getCalendarEvents } from './calendar';
export { getUserDetails } from './get-user-details';
export { nextMemberId, nextInstructorId, nextSchoolId, updateCounters } from './counters';

export { httpLogger } from './http-logger-example';

export {
  onMemberCreated,
  onMemberUpdated,
  onMemberDeleted,
} from './on-member-update';

export { onSchoolCreated, onSchoolUpdated, onSchoolDeleted } from './on-school-update';

export {
  onGradingCreated,
  onGradingUpdated,
  onGradingDeleted,
} from './on-grading-update';

export { requestGrading, requestGradingRetake } from './grading-request';

export { removeStudentFromInstructor, markStudentInactive } from './instructor-students';

export { sendPushOnNotification } from './send-push';

export { scheduledBackup, manualBackup, listBackups } from './backup';

export { syncSquarespaceOrders, processSquarespaceOrder, manualSquarespaceSync, reprocessOrder } from './squarespace-orders';

export { computeStatistics, manualComputeStatistics } from './compute-statistics';

export { checkEmailStatus } from './check-email-status';

export { refreshContentCache, manualRefreshCache, clearContentCache } from './content-cache';

export { scheduleAccountDeletion, cancelAccountDeletion, dailyAccountCleanup } from './account-deletion';

export { submitProposedEvent, onEventUpdated, onEventCreated, onEventDeleted } from './proposed-events';

export { listResources, deleteResource, getResourceDownloadUrl } from './resources';

export { socialPreview } from './social-preview';

export {
  refreshStripeProducts,
  manualRefreshStripeProducts,
} from './stripe-products';

export { createStripeCheckoutSession, getStripeCheckoutSession } from './stripe-checkout';

export {
  cancelSubscriptionRenewal,
  resumeSubscriptionRenewal,
  createCustomerPortalSession,
} from './stripe-subscriptions';

export { stripeWebhook } from './stripe-webhook';

export { transcodeVideoForVod } from './vod/transcode-video';
export { getVideoPlaybackSession } from './vod/get-playback-session';
export { deleteVideoFromCatalog } from './vod/delete-video';
export { checkVodJobStatus } from './vod/check-vod-job-status';
export { onTranscodeJobFinished } from './vod/on-transcode-finished';



