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

export { getCalendarEvents } from './calendar';
export { getUserDetails } from './get-user-details';
export { nextMemberId, nextInstructorId, nextSchoolId, updateCounters } from './counters';

export { httpLogger } from './http-logger-example';

export {
  onMemberCreated,
  onMemberUpdated,
  onMemberDeleted,
} from './on-member-update';

export { onSchoolCreated, onSchoolUpdated } from './on-school-update';

export {
  onGradingCreated,
  onGradingUpdated,
  onGradingDeleted,
} from './on-grading-update';

export { scheduledBackup, manualBackup, listBackups } from './backup';

export { syncSquarespaceOrders, processSquarespaceOrder, manualSquarespaceSync, reprocessOrder } from './squarespace-orders';

export { computeStatistics, manualComputeStatistics } from './compute-statistics';

export { checkEmailStatus } from './check-email-status';

export { refreshContentCache, manualRefreshCache, clearContentCache } from './content-cache';

export { scheduleAccountDeletion, cancelAccountDeletion, dailyAccountCleanup } from './account-deletion';

export { submitProposedEvent, onEventUpdated, onEventCreated, onEventDeleted } from './proposed-events';

export { listResources, deleteResource } from './resources';

