/* index.ts
 *
 * Master barrel export for the ILC database actions library.
 * Provides high-level, consistent actions for agentic and scripted
 * interaction with the ILC Firestore database.
 */

export * from './types';
export * from './context';
export * from './members';
export * from './schools';
export * from './gradings';
export * from './events';
export * from './vod';
export * from './orders';

// Re-export core domain types & enums for convenient single-import usage
export {
  Member,
  MembershipType,
  hasActiveMembership,
  hasActiveInstructorLicense,
} from '../data-model/members';
export {
  School,
  initSchool,
} from '../data-model/schools';
export {
  Grading,
  GradingStatus,
  PaymentStatus,
  initGrading,
} from '../data-model/gradings';
export {
  IlcEvent,
  EventStatus,
  initEvent,
} from '../data-model/events';
export {
  VideoItem,
  VideoGrant,
  VideoSeries,
  VodAccessTier,
  VodStatus,
  VideoGrantKind,
  initVideoItem,
  initVideoGrant,
} from '../data-model/vod';
export {
  Order,
  OrderKind,
  OrderStatus,
  SquareSpaceOrder,
  SquareSpaceLineItem,
  SquareSpaceLineItemType,
} from '../data-model/orders';
export {
  FirestoreCollection,
  FirestoreSubcollection,
} from '../data-model/collections';
export {
  StudentLevel,
  ApplicationLevel,
  MasterLevel,
} from '../data-model/curriculum';

