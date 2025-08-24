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
export { deleteUser } from './delete-user';
export { getUserDetails } from './get-user-details';
export { getMembers } from './get-members';
