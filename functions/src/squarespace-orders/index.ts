/*
Barrel re-exports for the squarespace-orders module.

The four Cloud Function triggers are exported here for registration
in the top-level functions/src/index.ts.  Pure/parse functions and
interfaces are also re-exported so tests can import them.
*/

// Cloud Function triggers
export {
  syncSquarespaceOrders,
  processSquarespaceOrder,
  manualSquarespaceSync,
  reprocessOrder,
  clearOrderProcessingState,
  fetchAndSyncOrders,
  executeOrderDownstreamLogic,
} from './api';

// Shared types & utilities
export {
  MembershipPurchaseInfo,
  parseMembershipPurchaseInfo,
  computeRenewalAndExpiration,
} from './common';

// Grading
export { parseGradingOrderInfo, processGradingOrder } from './grading';

// Annual membership
export { MembershipRenewalInfo, parseMembershipRenewalInfo } from './membership';

// Life membership
export { LifeMembershipInfo, parseLifeMembershipInfo } from './life-membership';

// Instructor license
export { InstructorLicenseInfo, parseInstructorLicenseInfo } from './instructor-license';

// School license
export { SchoolLicenseInfo, parseSchoolLicenseInfo } from './school-license';

// Member ID inference
export { inferMemberIdFromOrder, lookupMembersByEmail, normalizeDateOfBirth } from './infer-member';
