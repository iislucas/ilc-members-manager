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
export { getSquarespaceContent } from './squarespace-content';

export {
  onGradingCreated,
  onGradingUpdated,
  onGradingDeleted,
} from './on-grading-update';

export { scheduledBackup, manualBackup } from './backup';
