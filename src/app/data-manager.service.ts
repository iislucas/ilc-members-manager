import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  DocumentReference,
  getFirestore,
  onSnapshot,
  query,
  Query,
  Timestamp,
  serverTimestamp,
  orderBy,
  getDocs,
  where,
  documentId,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { FirestoreCollection } from '../../functions/src/data-model/collections';
import {
  MailQueueDoc,
  MailSettings,
  MailSendingStatus,
  initMailSettings,
  DeleteMailItemsRequest,
  DeleteMailItemsResponse,
  UpdateMailItemRequest,
  UpdateMailItemResponse,
  MailDeliveryState,
  TransactionalEmailKey,
} from '../../functions/src/data-model/mail';
import { EmailTemplates, initEmailTemplates } from '../../functions/src/data-model/content-cache';
import { GenericFsDoc } from '../../functions/src/data-model/base';
import { ResourceAccessLevel } from '../../functions/src/data-model/curriculum';
import { IlcEvent, EventStatus, initEvent, firestoreDocToIlcEvent, Product, firestoreDocToProduct } from '../../functions/src/data-model/events';
import { Grading, GradingFsDoc, firestoreDocToGrading } from '../../functions/src/data-model/gradings';
import { UploadItem, firestoreDocToUploadItem, initUploadItem } from '../../functions/src/data-model/materials';
import { Member, initMember, InstructorPublicData, initInstructor, MemberFsDoc, firestoreDocToMember, firestoreDocToInstructorPublicData } from '../../functions/src/data-model/members';
import { Order, firestoreDocToOrder, OrderFsDoc, SquareSpaceOrder, SquareSpaceLineItem, MemberOrder, firestoreDocToMemberOrder, OrderKind } from '../../functions/src/data-model/orders';
import { School, initSchool, SchoolFsDoc, firestoreDocToSchool } from '../../functions/src/data-model/schools';
import { Counters } from '../../functions/src/data-model/system';
import { VideoItem, VideoSeries, groupVideosIntoSeries, getVideoSeriesGroupingKey, firestoreDocToVideoItem, initVideoItem, VideoGrant, firestoreDocToVideoGrant, VideoProgress, firestoreDocToVideoProgress, VodStatus, VodAccessTier, VideoGrantKind, SystemTagsDoc, SystemVideoTagsDoc, VideoTagMeta, initVideoTagMeta, TagItem, VideoTimeRange, MemberVideoTimeRanges, firestoreDocToMemberVideoTimeRanges, MemberVideoTimeRangesFsDoc } from '../../functions/src/data-model/vod';
import { getStorage, ref as storageRef, deleteObject } from 'firebase/storage';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import { countryCodeList, CountryCode, CountryCodesDoc } from './country-codes';
import * as Papa from 'papaparse';
import { SearchableSet } from './searchable-set';
import { SyncedCollection } from './synced-collection';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deepObjEq, computeObjectDiff, formatFieldLabel, formatFieldSummary } from './utils';
import { FindInstructorsService } from './find-instructors.service';
import { IncrementalSyncService } from './incremental-sync.service';
import {
  ActionQueueService,
  QueuedAction,
  QueuedActionKind,
  RollbackTarget,
} from './action-queue.service';
import { NetworkStateService } from './network-state.service';

/** The state of the schools collection. */
export interface SchoolsState {
  /** The list of schools. */
  schools: School[];
  /** Whether the schools are currently being loaded. */
  loading: boolean;
  /** Any error that occurred while loading the schools. */
  error: string | null;
}

export enum DataServiceState {
  Loading = 'Loading',
  Loaded = 'Loaded',
}

function orderSortDate(order: Order): string {
  switch (order.ilcAppOrderKind) {
    case OrderKind.Squarespace:
      return order.createdOn;
    case OrderKind.Stripe:
      return order.created;
    default:
      return order.datePaid;
  }
}

export function compareOrdersByDateDesc(a: Order, b: Order): number {
  return (orderSortDate(b) || '').localeCompare(orderSortDate(a) || '');
}

export function sortOrdersByDateDesc(orders: Order[]): Order[] {
  return orders.sort(compareOrdersByDateDesc);
}

export function compareEventsByStartDesc(a: IlcEvent, b: IlcEvent): number {
  return (b.start || '').localeCompare(a.start || '');
}

export function sortEventsByStartDesc(events: IlcEvent[]): IlcEvent[] {
  return events.sort(compareEventsByStartDesc);
}

export type OrderSearchCriteriaTerm = {
  kind: 'term';
  searchField:
    | 'orderNumber'
    | 'referenceNumber'
    | 'id'
    | 'customerEmail'
    | 'email'
    | 'lastName'
    | 'billingAddress.lastName'
    | 'memberDocId'
    | 'ilcAppMemberDocId';
  term: string;
  statusFilter?: string;
  kindFilter?: string;
};

export type OrderSearchCriteriaDateRange = {
  kind: 'date';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  statusFilter?: string;
  kindFilter?: string;
};

export type OrderSearchCriteria = OrderSearchCriteriaTerm | OrderSearchCriteriaDateRange;

export type EventSearchCriteriaTerm = {
  kind: 'term';
  searchField:
    | 'title'
    | 'location'
    | 'ownerEmails'
    | 'leadingInstructorId'
    | 'ownerDocId'
    | 'memberDocId';
  term: string;
  statusFilter?: string;
};

export type EventSearchCriteriaDateRange = {
  kind: 'date';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  statusFilter?: string;
};

export type EventSearchCriteria = EventSearchCriteriaTerm | EventSearchCriteriaDateRange;

export type GradingSearchCriteriaTerm = {
  kind: 'term';
  searchField:
    | 'studentMemberDocId'
    | 'memberDocId'
    | 'studentMemberId'
    | 'memberId'
    | 'gradingInstructorId'
    | 'instructorId'
    | 'studentName'
    | 'orderId'
    | string;
  term: string;
  statusFilter?: string;
};

export type GradingSearchCriteriaDateRange = {
  kind: 'date';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  statusFilter?: string;
};

export type GradingSearchCriteria =
  | GradingSearchCriteriaTerm
  | GradingSearchCriteriaDateRange;

@Injectable({
  providedIn: 'root',
})
export class DataManagerService {
  private firebaseService = inject(FirebaseStateService);
  private findInstructorsService = inject(FindInstructorsService);
  private syncService = inject(IncrementalSyncService);
  public actionQueue = inject(ActionQueueService);
  public networkState = inject(NetworkStateService);
  private db = getFirestore(this.firebaseService.app);
  private functions = getFunctions(this.firebaseService.app);
  private schoolsCollection = collection(this.db, 'schools');
  private membersCollection = collection(this.db, 'members');
  private ordersCollection = collection(this.db, 'orders');
  private eventsCollection = collection(this.db, 'events');
  private snapshotsToUnsubscribe: (() => void)[] = [];
  loadingState = linkedSignal<DataServiceState>(() => {
    if (
      !this.members.loading() &&
      !this.schools.loading() &&
      !this.instructors.loading() &&
      !this.myStudents.loading()
    ) {
      return DataServiceState.Loaded;
    } else {
      return DataServiceState.Loading;
    }
  });

  // A signal to hold the state of the members list.
  public members = new SyncedCollection<'docId', Member>({
    collectionPath: 'members',
    cacheKey: 'members_admin',
    idField: 'docId',
    searchFields: [
      'memberId',
      'instructorId',
      'name',
      'emails',
      'publicEmail',
      'memberId',
      'city',
      'countyOrState',
      'publicRegionOrCity',
      'publicCountyOrState',
      'country',
      'tags',
    ],
    docConverter: firestoreDocToMember,
    sortFn: (a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });
  // Delegate to FindInstructorsService for a single, shared instructor cache
  // that works both in the authenticated main app and the standalone WC.
  public get instructors() {
    return this.findInstructorsService.instructors;
  }
  public myStudents = new SyncedCollection<'docId', Member>({
    collectionPath: 'members',
    cacheKey: 'instructor_my_students',
    idField: 'docId',
    searchFields: [
      'memberId',
      'name',
      'emails',
      'publicEmail',
      'memberId',
      'city',
      'countyOrState',
      'publicRegionOrCity',
      'publicCountyOrState',
      'country',
      'tags',
    ],
    docConverter: firestoreDocToMember,
    sortFn: (a, b) => (a.name || '').localeCompare(b.name || ''),
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });
  public mySchools = new SearchableSet<'schoolId', School>(
    [
      'schoolName',
      'schoolId',
      'schoolCity',
      'schoolCountyOrState',
      'schoolCountry',
    ],
    'schoolId',
  );
  public schools = new SyncedCollection<'schoolId', School>({
    collectionPath: 'schools',
    cacheKey: 'schools',
    idField: 'schoolId',
    searchFields: [
      'schoolName',
      'schoolId',
      'schoolCity',
      'schoolCountyOrState',
      'schoolCountry',
    ],
    docConverter: firestoreDocToSchool,
    sortFn: (a, b) => (b.schoolId || '').localeCompare(a.schoolId || ''),
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });
  public orders = new SyncedCollection<'docId', Order>({
    collectionPath: 'orders',
    cacheKey: 'admin_orders',
    idField: 'docId',
    searchFields: ['referenceNumber', 'lastName', 'firstName', 'email', 'externalId', 'orderNumber', 'customerEmail'],
    docConverter: firestoreDocToOrder,
    sortFn: compareOrdersByDateDesc,
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });
  public counters = signal<Counters | null>(null);
  public emailTemplates = signal<EmailTemplates | null>(null);
  public mailSettings = signal<MailSettings>(initMailSettings());
  public countries = new SearchableSet<'id', CountryCode>(['name', 'id'], 'id');
  public gradings = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );
  // The admin "Manage Gradings" list is paginated: we only subscribe to the most
  // recent N gradings (one extra beyond the 50-row display window, so the UI can
  // tell whether a "Show more" affordance is needed). `loadMoreGradings` grows
  // this, which re-subscribes with a larger `limit()`.
  gradingsQueryLimit = signal(51);
  public myGradingsAssessed = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );
  public myGradings = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );
  public myOrders = new SearchableSet<'docId', MemberOrder>(
    ['orderNumber', 'description', 'orderType', 'date', 'currency'],
    'docId',
  );
  public myVideoGrants = new SearchableSet<'docId', VideoGrant>(
    ['videoId', 'videoTitle', 'orderId'],
    'docId',
  );
  public videos = new SyncedCollection<'docId', VideoItem>({
    collectionPath: 'videos',
    cacheKey: 'admin_videos',
    idField: 'docId',
    searchFields: ['title', 'description', 'instructorName', 'tags', 'location', 'eventTitle'],
    docConverter: firestoreDocToVideoItem,
    sortFn: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });
  public events = new SyncedCollection<'docId', IlcEvent>({
    collectionPath: 'events',
    cacheKey: 'public_events',
    idField: 'docId',
    searchFields: [
      'title',
      'description',
      'location',
      'city',
      'country',
      'leadingInstructorName',
      'schoolName',
      'status',
    ],
    docConverter: firestoreDocToIlcEvent,
    sortFn: compareEventsByStartDesc,
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });

  public products = new SyncedCollection<'docId', Product>({
    collectionPath: 'products',
    cacheKey: 'products',
    idField: 'docId',
    searchFields: [
      'title',
      'descriptionMarkdown',
      'purchaseDetailsMarkdown',
      'inPersonDetailsMarkdown',
      'currency',
      'eventDocId',
    ],
    docConverter: firestoreDocToProduct,
    sortFn: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    db: this.db,
    syncService: this.syncService,
    actionQueue: this.actionQueue,
    networkState: this.networkState,
  });

  public tagsDoc = signal<Record<string, VideoTagMeta>>({});
  public tagsSet = new SearchableSet<'tag', TagItem>(
    ['tag', 'label', 'description'],
    'tag',
  );

  getTagMeta(tag: string): VideoTagMeta | undefined {
    if (!tag) return undefined;
    return this.tagsDoc()[tag.trim().toLowerCase()];
  }

  getTagDescription(tag: string): string {
    if (!tag) return '';
    return this.getTagMeta(tag)?.description || '';
  }

  getTagLabel(tag: string): string {
    if (!tag) return '';
    return this.getTagMeta(tag)?.label || tag;
  }

  // Reactive map from memberId to docId for efficient member lookups by
  // human-readable member ID.
  public memberIdToDocIdMap = computed(() => {
    const map = new Map<string, string>();
    for (const m of this.members.entries()) {
      if (m.memberId) {
        map.set(m.memberId.trim().toUpperCase(), m.docId);
      }
    }
    return map;
  });

  // Look up a member by their Firestore document ID (docId).
  getMemberByDocId(docId: string): Member | undefined {
    return this.members.get(docId);
  }

  // Look up a member by their human-readable memberId. Resolves
  // memberId → docId via memberIdToDocIdMap, then delegates to members.get().
  getMemberByMemberId(memberId: string): Member | undefined {
    const cleanId = String(memberId || '').trim().toUpperCase();
    const docId = this.memberIdToDocIdMap().get(cleanId);
    if (!docId) return undefined;
    return this.members.get(docId);
  }

  // Look up a member by either memberId or docId, trying docId first.
  getMember(idOrDocId: string): Member | undefined {
    return this.members.get(idOrDocId) ?? this.getMemberByMemberId(idOrDocId);
  }

  // Standard "(memberId) Name" display form for a member referenced by a
  // grading. Resolves the member by docId first, then by human-readable
  // memberId (some gradings have a stale/empty studentMemberDocId). When the
  // member document isn't loaded — e.g. non-admin viewers can't read the members
  // collection — falls back to the denormalized `cachedName` snapshot stored on
  // the grading (Grading.studentName), then to whatever identifier we have.
  memberDisplayName(memberDocId: string, memberId: string, cachedName?: string): string {
    const member =
      (memberDocId ? this.getMemberByDocId(memberDocId) : undefined) ??
      (memberId ? this.getMemberByMemberId(memberId) : undefined);
    if (member) {
      return member.memberId ? `(${member.memberId}) ${member.name}` : member.name;
    }
    if (cachedName) {
      return memberId ? `(${memberId}) ${cachedName}` : cachedName;
    }
    return memberId || memberDocId || '';
  }

  formatFieldSummary(key: string): string {
    return formatFieldLabel(key);
  }

  // Standard "Name [instructorId]" display form for an instructor referenced by
  // a grading. Resolves the instructor by their human-readable instructorId.
  // Falls back to the denormalized `cachedName` snapshot (Grading.gradingInstructorName)
  // and then the raw id when the instructor document isn't loaded.
  instructorDisplayName(instructorId: string, cachedName?: string): string {
    if (!instructorId) return '';
    const instructor = this.instructors.get(instructorId);
    if (instructor) return `${instructor.name} [${instructor.instructorId}]`;
    return cachedName ? `${cachedName} [${instructorId}]` : instructorId;
  }

  // Reactive map from memberId to docId for the logged-in instructor's students.
  public myStudentIdToDocIdMap = computed(() => {
    const map = new Map<string, string>();
    for (const m of this.myStudents.entries()) {
      if (m.memberId) {
        map.set(m.memberId.trim().toUpperCase(), m.docId);
      }
    }
    return map;
  });

  // Look up one of the logged-in instructor's students by either memberId or docId.
  getMyStudent(idOrDocId: string): Member | undefined {
    const byDocId = this.myStudents.get(idOrDocId);
    if (byDocId) return byDocId;
    const cleanId = String(idOrDocId || '').trim().toUpperCase();
    const docId = this.myStudentIdToDocIdMap().get(cleanId);
    if (!docId) return undefined;
    return this.myStudents.get(docId);
  }

  constructor() {
    // 1. Immediately load public schools, events, and products from IndexedDB cache and sync in background
    this.schools.loadCache();
    this.updateSchoolsSync();

    this.events.loadCache();
    this.updateEventsSync();

    this.products.loadCache();
    this.updateProductsSync();

    // 2. Setup public system listeners
    this.updateCountryCodesSync();
    this.updateSystemTagsSync();

    // 3. Reactively sync user-dependent collections whenever authenticated user changes
    effect(() => {
      const user = this.firebaseService.user();
      if (user) {
        this.updateMembersSync(user);
        this.updateMyStudentsSync(user);
        this.updateMyGradingsAssessedSync(user);
        if (user.isAdmin) {
          this.updateOrdersSync();
        } else {
          this.orders.setEntries([]);
        }
      } else {
        this.members.setEntries([]);
        this.myStudents.setEntries([]);
        this.myGradingsAssessed.setEntries([]);
        this.orders.setEntries([]);
      }
    });

    // System listeners reactive to auth status (counters, email-templates, mail-settings, videos)
    effect(() => {
      const user = this.firebaseService.user();
      this.updateCountersSync(user);
      this.updateEmailTemplatesSync(user);
      this.updateMailSettingsSync(user);
      this.updateVideosSync(user);
    });

    // Admin "Manage Gradings" subscription, kept separate so it can re-subscribe
    // when the page size (`gradingsQueryLimit`) grows without tearing down every
    // other snapshot. Reads the user + limit signals synchronously so the effect
    // re-runs on login/logout and on "Show more".
    effect(() => {
      const user = this.firebaseService.user();
      const queryLimit = this.gradingsQueryLimit();
      this.updateGradingsSync(user, queryLimit);
    });

    // Reactive effect for My Gradings: re-subscribes whenever the member's
    // gradingDocIds list changes (e.g. when a new grading is created by a
    // Firebase trigger and the member doc is updated with arrayUnion).
    effect(() => {
      const user = this.firebaseService.user();
      this.updateMyGradingsSync(user);
    });

    // Effect for My Schools
    effect(() => {
      const user = this.firebaseService.user();
      if (user) {
        const allSchools = this.schools.entries();
        const myInstructorId = user.member.instructorId;
        const mySchoolsList = allSchools.filter(
          (school) =>
            school.ownerInstructorId === myInstructorId || school.managerInstructorIds.includes(myInstructorId),
        );
        this.mySchools.setEntries(mySchoolsList);
      } else {
        this.mySchools.setEntries([]);
      }
    });

    // Reactive effect for My Orders & Subscriptions
    effect(() => {
      const user = this.firebaseService.user();
      if (user?.member?.docId) {
        this.listenToMemberOrders(user.member.docId);
      } else {
        this.listenToMemberOrders('');
      }
    });

    // Reactive effect for My Video Grants
    effect(() => {
      const user = this.firebaseService.user();
      if (user?.member?.docId) {
        this.listenToMemberVideoGrants(user.member.docId);
      } else {
        this.listenToMemberVideoGrants('');
      }
    });

    // Reactive effect for System Video Tags
    effect(() => {
      const docMap = this.tagsDoc();
      const docKeys = Object.keys(docMap);
      const fromVideos = this.videos.entries().flatMap((v) => v.tags || []);
      const uniqueKeys = Array.from(
        new Set(
          [...docKeys, ...fromVideos]
            .map((t) => t.trim().toLowerCase())
            .filter((t) => Boolean(t)),
        ),
      ).sort((a, b) => a.localeCompare(b));

      const items: TagItem[] = uniqueKeys.map((key) => {
        const meta = docMap[key];
        return {
          tag: key,
          label: meta?.label || key,
          description: meta?.description || '',
        };
      });

      this.tagsSet.setEntries(items);
    });

    // 4. Register rollback handler for offline action queue discards / undo
    this.actionQueue.registerRollbackHandler(async (action, targetState) => {
      await this.rollbackQueuedAction(action, targetState);
    });
  }

  private myOrdersUnsubscribe: (() => void) | null = null;
  private myVideoGrantsUnsubscribe: (() => void) | null = null;

  public listenToMemberOrders(memberDocId: string) {
    if (this.myOrdersUnsubscribe) {
      this.myOrdersUnsubscribe();
      this.myOrdersUnsubscribe = null;
    }

    if (!memberDocId) {
      this.myOrders.setEntries([]);
      return;
    }

    const ordersSubcollection = collection(
      this.db,
      'members',
      memberDocId,
      'orders',
    );
    const q = query(ordersSubcollection, orderBy('date', 'desc'));

    this.myOrdersUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const orders = snapshot.docs.map(firestoreDocToMemberOrder);
        this.myOrders.setEntries(orders);
      },
      (error) => {
        console.error('Error listening to member orders:', error);
        this.myOrders.setError(error.message);
      },
    );
  }

  public listenToMemberVideoGrants(memberDocId: string) {
    if (this.myVideoGrantsUnsubscribe) {
      this.myVideoGrantsUnsubscribe();
      this.myVideoGrantsUnsubscribe = null;
    }

    if (!memberDocId) {
      this.myVideoGrants.setEntries([]);
      return;
    }

    const grantsSubcollection = collection(
      this.db,
      'members',
      memberDocId,
      'videoGrants',
    );

    this.myVideoGrantsUnsubscribe = onSnapshot(
      grantsSubcollection,
      (snapshot) => {
        const grants = snapshot.docs.map(firestoreDocToVideoGrant);
        this.myVideoGrants.setEntries(grants);
      },
      (error) => {
        console.error('Error listening to member video grants:', error);
        this.myVideoGrants.setError(error.message);
      },
    );
  }

  unsubscribeSnapshots() {
    this.snapshotsToUnsubscribe.forEach((unsubscribe) => unsubscribe());
    this.snapshotsToUnsubscribe = [];
    if (this.myGradingsAssessedUnsubscribe) {
      this.myGradingsAssessedUnsubscribe();
      this.myGradingsAssessedUnsubscribe = null;
    }
    if (this.myOrdersUnsubscribe) {
      this.myOrdersUnsubscribe();
      this.myOrdersUnsubscribe = null;
    }
    if (this.myVideoGrantsUnsubscribe) {
      this.myVideoGrantsUnsubscribe();
      this.myVideoGrantsUnsubscribe = null;
    }
    if (this.gradingsUnsubscribe) {
      this.gradingsUnsubscribe();
      this.gradingsUnsubscribe = null;
    }
    if (this.countersUnsubscribe) {
      this.countersUnsubscribe();
      this.countersUnsubscribe = null;
    }
    if (this.emailTemplatesUnsubscribe) {
      this.emailTemplatesUnsubscribe();
      this.emailTemplatesUnsubscribe = null;
    }
    if (this.mailSettingsUnsubscribe) {
      this.mailSettingsUnsubscribe();
      this.mailSettingsUnsubscribe = null;
    }
    if (this.videosUnsubscribe) {
      this.videosUnsubscribe();
      this.videosUnsubscribe = null;
    }
  }

  async updateMembersSync(user: UserDetails, forceFullRefresh = false) {
    if (user.isAdmin) {
      const cacheKey = `members_admin_${user.firebaseUser?.uid || 'admin'}`;
      await this.members.sync({
        cacheKey,
        collectionPath: 'members',
        forceFullRefresh,
      });
    } else if (user.schoolsManaged.length > 0) {
      const allMembers = new Map<string, Member>();

      for (const schoolId of user.schoolsManaged) {
        const cacheKey = `school_members_${schoolId}`;
        const tempSet = new SearchableSet<'docId', Member>(
          this.members.fieldsToSearch,
          'docId',
        );
        this.syncService.loadCachedData(cacheKey, tempSet);
        await this.syncService.syncCollection({
          cacheKey,
          collectionPath: `schools/${schoolId}/members`,
          idField: 'docId',
          targetSet: tempSet,
          docConverter: firestoreDocToMember,
          sortFn: (a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
          forceFullRefresh,
        });
        tempSet.entries().forEach((m) => allMembers.set(m.docId, m));
      }
      this.members.setEntries(Array.from(allMembers.values()));
    } else {
      this.members.setEntries([]);
    }
  }

  async updateSchoolsSync(forceFullRefresh = false) {
    await this.schools.sync(forceFullRefresh);
    return this.schools;
  }

  // Instructor data is now managed by FindInstructorsService.

  async updateOrdersSync(forceFullRefresh = false) {
    await this.orders.sync(forceFullRefresh);
    return this.orders;
  }

  async updateEventsSync(forceFullRefresh = false) {
    await this.events.sync(forceFullRefresh);
    return this.events;
  }

  async updateProductsSync(forceFullRefresh = false) {
    await this.products.sync(forceFullRefresh);
    return this.products;
  }

  async getRecentOrders(limitCount: number = 1000, status?: string, kindFilter?: string): Promise<Order[]> {
    if (this.orders.entries().length > 0) {
      let filtered = this.orders.entries();
      if (status) {
        filtered = filtered.filter((o) => o.ilcAppOrderStatus === status);
      }
      if (kindFilter === 'squarespace') {
        filtered = filtered.filter((o) => o.ilcAppOrderKind === OrderKind.Squarespace);
      }
      return filtered.slice(0, limitCount);
    }
    try {
      let q = query(
        this.ordersCollection,
        orderBy('lastUpdated', 'desc'),
        limit(limitCount),
      );
      
      if (status) {
        q = query(q, where('ilcAppOrderStatus', '==', status));
      }
      if (kindFilter === 'squarespace') {
        q = query(q, where('ilcAppOrderKind', '==', OrderKind.Squarespace));
      }
      
      const snapshot = await getDocs(q);
      return sortOrdersByDateDesc(snapshot.docs.map(firestoreDocToOrder));
    } catch (error: any) {
      console.error('Failed to get recent orders', error);
      return [];
    }
  }

  async searchOrders(criteria: OrderSearchCriteria): Promise<Order[]> {
    const status = criteria.statusFilter;
    const kindFilter = criteria.kindFilter;

    if (this.orders.entries().length > 0) {
      if (criteria.kind === 'term') {
        const term = criteria.term.trim().toLowerCase();
        const field = criteria.searchField;
        if (!term) return [];

        let results = this.orders.entries().filter((o) => {
          const recO = o as Record<string, unknown>;
          if (field === 'email' || field === 'customerEmail') {
            const ce = (('customerEmail' in o && typeof o.customerEmail === 'string' ? o.customerEmail : '') || '').toLowerCase();
            const em = (('email' in o && typeof o.email === 'string' ? o.email : '') || '').toLowerCase();
            return ce.includes(term) || em.includes(term);
          } else if (field === 'memberDocId' || field === 'ilcAppMemberDocId') {
            const mid = (('ilcAppMemberDocId' in o && typeof o.ilcAppMemberDocId === 'string' ? o.ilcAppMemberDocId : '') || '').toLowerCase();
            return mid === term;
          } else if (field === 'orderNumber') {
            const on = ('orderNumber' in o && typeof o.orderNumber === 'string' ? o.orderNumber : '') || '';
            return on.toLowerCase().includes(term);
          } else if (field === 'referenceNumber') {
            const rn = ('referenceNumber' in o && typeof o.referenceNumber === 'string' ? o.referenceNumber : '') || '';
            return rn.toLowerCase().includes(term);
          } else if (field === 'id') {
            const id = ('id' in o && typeof o.id === 'string' ? o.id : '') || '';
            return id.toLowerCase().includes(term) || o.docId.toLowerCase().includes(term);
          } else if (field === 'lastName' || field === 'billingAddress.lastName') {
            const ln = (('lastName' in o && typeof o.lastName === 'string' ? o.lastName : '') ||
              ('billingAddress' in o && o.billingAddress && typeof o.billingAddress === 'object' && 'lastName' in o.billingAddress ? String((o.billingAddress as Record<string, unknown>)['lastName'] || '') : '')).toLowerCase();
            return ln.includes(term);
          } else {
            const val = String(recO[field] || '').toLowerCase();
            return val.includes(term);
          }
        });

        if (status) {
          results = results.filter((o) => o.ilcAppOrderStatus === status);
        }
        if (kindFilter === 'squarespace') {
          results = results.filter((o) => o.ilcAppOrderKind === OrderKind.Squarespace);
        }

        return sortOrdersByDateDesc(results);
      } else if (criteria.kind === 'date') {
        let results = this.orders.entries().filter((o) => {
          const orderDate = orderSortDate(o);
          if (criteria.startDate && (!orderDate || orderDate < criteria.startDate)) return false;
          if (criteria.endDate && (!orderDate || orderDate > criteria.endDate + 'T23:59:59.999Z')) return false;
          return true;
        });

        if (status) {
          results = results.filter((o) => o.ilcAppOrderStatus === status);
        }
        if (kindFilter === 'squarespace') {
          results = results.filter((o) => o.ilcAppOrderKind === OrderKind.Squarespace);
        }

        return sortOrdersByDateDesc(results);
      }
    }

    if (criteria.kind === 'term') {
      const term = criteria.term.trim();
      const field = criteria.searchField;
      if (!term) return [];

      const results = new Map<string, Order>();

      if (field === 'email' || field === 'customerEmail') {
        const qCustomer = query(this.ordersCollection, where('customerEmail', '==', term));
        const qEmail = query(this.ordersCollection, where('email', '==', term));
        const [snapC, snapE] = await Promise.all([getDocs(qCustomer), getDocs(qEmail)]);
        snapC.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as unknown as GenericFsDoc);
          results.set(order.docId, order);
        });
        snapE.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as unknown as GenericFsDoc);
          results.set(order.docId, order);
        });
      } else if (field === 'memberDocId' || field === 'ilcAppMemberDocId') {
        const q = query(this.ordersCollection, where('ilcAppMemberDocId', '==', term));
        const snap = await getDocs(q);
        snap.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as unknown as GenericFsDoc);
          results.set(order.docId, order);
        });
      } else {
        // Search only the specifically requested field
        let q = query(this.ordersCollection, where(field, '==', term));

        if (status) {
          q = query(q, where('ilcAppOrderStatus', '==', status));
        }
        if (kindFilter === 'squarespace') {
          q = query(q, where('ilcAppOrderKind', '==', OrderKind.Squarespace));
        }

        const snap = await getDocs(q);
        snap.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as unknown as GenericFsDoc);
          results.set(order.docId, order);
        });
      }

      let orderList = Array.from(results.values());
      if (status) {
        orderList = orderList.filter((o) => o.ilcAppOrderStatus === status);
      }
      if (kindFilter === 'squarespace') {
        orderList = orderList.filter((o) => o.ilcAppOrderKind === OrderKind.Squarespace);
      }

      return sortOrdersByDateDesc(orderList);
    } else if (criteria.kind === 'date') {
      let qSquareSpace = query(this.ordersCollection);
      let qSheetsImport = query(this.ordersCollection);

      if (criteria.startDate) {
        qSquareSpace = query(qSquareSpace, where('createdOn', '>=', criteria.startDate));
        qSheetsImport = query(qSheetsImport, where('datePaid', '>=', criteria.startDate));
      }

      if (criteria.endDate) {
        // createdOn is an ISO string, so we append the end of the day
        qSquareSpace = query(qSquareSpace, where('createdOn', '<=', criteria.endDate + 'T23:59:59.999Z'));
        // datePaid is YYYY-MM-DD
        qSheetsImport = query(qSheetsImport, where('datePaid', '<=', criteria.endDate));
      }

      qSquareSpace = query(qSquareSpace, orderBy('createdOn', 'desc'), limit(500));
      qSheetsImport = query(qSheetsImport, orderBy('datePaid', 'desc'), limit(500));

      try {
        const [snapS, snapH] = await Promise.all([getDocs(qSquareSpace), getDocs(qSheetsImport)]);
        const results: Order[] = [];

        snapS.docs.forEach((docSnap) => results.push(firestoreDocToOrder(docSnap as unknown as GenericFsDoc)));
        snapH.docs.forEach((docSnap) => results.push(firestoreDocToOrder(docSnap as unknown as GenericFsDoc)));

        return sortOrdersByDateDesc(results);
      } catch (error) {
        console.error('Error searching orders by date bounds:', error);
        return [];
      }
    }

    return [];
  }

  async getRecentEvents(limitCount: number = 100, status?: string): Promise<IlcEvent[]> {
    if (this.events.entries().length > 0) {
      let evs = this.events.entries();
      if (status) {
        evs = evs.filter((e) => e.status === status);
      }
      evs = [...evs].sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
      return evs.slice(0, limitCount);
    }
    try {
      let q = query(
        this.eventsCollection,
        orderBy('lastUpdated', 'desc'),
        limit(limitCount),
      );
      
      if (status) {
        q = query(q, where('status', '==', status));
      }
      
      const recentPromise = getDocs(q);

      // When no status filter is active, also fetch all proposed events so
      // they always surface on the default page even if they haven't been
      // recently updated.
      if (!status) {
        const proposedQ = query(
          this.eventsCollection,
          where('status', '==', EventStatus.Proposed),
        );
        const [recentSnap, proposedSnap] = await Promise.all([recentPromise, getDocs(proposedQ)]);
        const merged = new Map<string, IlcEvent>();
        for (const d of recentSnap.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        for (const d of proposedSnap.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        return Array.from(merged.values());
      }

      const snapshot = await recentPromise;
      return snapshot.docs.map(d => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent));
    } catch (error: any) {
      console.error('Failed to get recent events', error);
      return [];
    }
  }

  async getEvents(limitCount: number = 500): Promise<IlcEvent[]> {
    return this.getRecentEvents(limitCount);
  }

  async searchEvents(criteria: EventSearchCriteria): Promise<IlcEvent[]> {
    const status = criteria.statusFilter;

    if (this.events.entries().length > 0) {
      if (criteria.kind === 'term') {
        const term = criteria.term.trim().toLowerCase();
        const field = criteria.searchField;
        if (!term) return [];

        let results = this.events.entries().filter((e) => {
          if (field === 'ownerEmails') {
            return (e.ownerEmails || []).some((em) => em.toLowerCase().includes(term));
          } else if (field === 'ownerDocId' || field === 'memberDocId') {
            return (
              (e.ownerDocId || '').toLowerCase() === term ||
              (e.managerDocIds || []).some((mId) => mId.toLowerCase() === term)
            );
          } else {
            const val = String((e as Record<string, unknown>)[field] || '').toLowerCase();
            return val.includes(term);
          }
        });

        if (status) {
          results = results.filter((e) => e.status === status);
        }
        return results;
      } else if (criteria.kind === 'date') {
        let results = this.events.entries().filter((e) => {
          if (criteria.startDate && (!e.start || e.start < criteria.startDate)) return false;
          if (criteria.endDate && (!e.start || e.start > criteria.endDate + 'T23:59:59.999Z')) return false;
          return true;
        });

        if (status) {
          results = results.filter((e) => e.status === status);
        }
        return sortEventsByStartDesc(results);
      }
    }

    if (criteria.kind === 'term') {
      const term = criteria.term.trim();
      const field = criteria.searchField;
      if (!term) return [];

      let results: IlcEvent[] = [];
      if (field === 'ownerEmails') {
        const qOwner = query(this.eventsCollection, where('ownerEmails', 'array-contains', term));
        const qManager = query(this.eventsCollection, where('managerEmails', 'array-contains', term));
        const [snapOwner, snapManager] = await Promise.all([
          getDocs(qOwner),
          getDocs(qManager),
        ]);
        const merged = new Map<string, IlcEvent>();
        for (const d of snapOwner.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        for (const d of snapManager.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        results = Array.from(merged.values());
      } else if (field === 'ownerDocId' || field === 'memberDocId') {
        const qOwner = query(this.eventsCollection, where('ownerDocId', '==', term));
        const qManager = query(this.eventsCollection, where('managerDocIds', 'array-contains', term));
        const [snapOwner, snapManager] = await Promise.all([
          getDocs(qOwner),
          getDocs(qManager),
        ]);
        const merged = new Map<string, IlcEvent>();
        for (const d of snapOwner.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        for (const d of snapManager.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
        results = Array.from(merged.values());
      } else {
        let q = query(this.eventsCollection, where(field, '==', term));
        if (status) {
          q = query(q, where('status', '==', status));
        }
        const snap = await getDocs(q);
        results = snap.docs.map(d => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent));
      }

      if (status && (field === 'ownerEmails' || field === 'ownerDocId' || field === 'memberDocId')) {
        results = results.filter((e) => e.status === status);
      }
      return results;
    } else if (criteria.kind === 'date') {
      let q = query(this.eventsCollection);

      if (criteria.startDate) {
        q = query(q, where('start', '>=', criteria.startDate));
      }

      if (criteria.endDate) {
        q = query(q, where('start', '<=', criteria.endDate + 'T23:59:59.999Z'));
      }

      q = query(q, orderBy('start', 'desc'), limit(500));

      try {
        const snap = await getDocs(q);
        let results = snap.docs.map(d => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent));
        // Apply the status filter client-side: adding `where('status', '==', …)`
        // to the date-range query would require a composite index, so filter the
        // fetched page instead.
        if (status) {
          results = results.filter((e) => e.status === status);
        }
        return results;
      } catch (error) {
        console.error('Error searching events by date bounds:', error);
        return [];
      }
    }

    return [];
  }

  async getOrderByIdOrRef(idOrRef: string): Promise<Order | undefined> {
    if (!idOrRef) return undefined;

    // Try in-memory cached orders first
    const inMemory =
      this.orders.get(idOrRef) ||
      this.orders.entries().find(
        (o) =>
          o.docId === idOrRef ||
          ('id' in o && o.id === idOrRef) ||
          ('orderNumber' in o && o.orderNumber === idOrRef) ||
          ('referenceNumber' in o && o.referenceNumber === idOrRef),
      );
    if (inMemory) return inMemory;

    // Try direct doc lookup
    const directDoc = await getDoc(doc(this.db, 'orders', idOrRef));
    if (directDoc.exists()) {
      return firestoreDocToOrder(directDoc as unknown as GenericFsDoc);
    }

    // Try query by id (Squarespace ID) or orderNumber or referenceNumber
    const q1 = query(this.ordersCollection, where('id', '==', idOrRef), limit(1));
    const q2 = query(this.ordersCollection, where('orderNumber', '==', idOrRef), limit(1));
    const q3 = query(this.ordersCollection, where('referenceNumber', '==', idOrRef), limit(1));

    for (const q of [q1, q2, q3]) {
      const snap = await getDocs(q);
      if (!snap.empty) {
        return firestoreDocToOrder(snap.docs[0] as unknown as GenericFsDoc);
      }
    }

    return undefined;
  }

  async getEventById(id: string): Promise<IlcEvent | undefined> {
    return await this.events.getById(id);
  }

  async saveEvent(event: IlcEvent): Promise<string> {
    return await this.events.save(event);
  }

  async updateEvent(id: string, updates: Partial<IlcEvent>): Promise<void> {
    return await this.events.update(id, updates);
  }

  async deleteEvent(id: string): Promise<void> {
    return await this.events.delete(id);
  }

  async saveProduct(product: Product): Promise<string> {
    const docId = await this.products.save(product);

    if (product.eventDocId) {
      const eventUpdates: Partial<IlcEvent> = {
        productId: docId,
      };
      if (product.onlineJoiningLink !== undefined) {
        eventUpdates.onlineJoiningLink = product.onlineJoiningLink;
      }
      if (product.purchaseDetailsMarkdown !== undefined) {
        eventUpdates.purchaseDetailsMarkdown = product.purchaseDetailsMarkdown;
      }
      if (product.inPersonDetailsMarkdown !== undefined) {
        eventUpdates.inPersonDetailsMarkdown = product.inPersonDetailsMarkdown;
      }
      if (product.recordedVideoId !== undefined) {
        eventUpdates.recordedVideoId = product.recordedVideoId;
      }
      if (product.recordedVideoUrl !== undefined) {
        eventUpdates.recordedVideoUrl = product.recordedVideoUrl;
      }
      await this.events.update(product.eventDocId, eventUpdates);
    }
    return docId;
  }

  async deleteProduct(productId: string): Promise<void> {
    if (!productId) return;
    const product = this.products.get(productId) || (await this.products.getById(productId));
    if (product?.eventDocId) {
      await this.events.update(product.eventDocId, { productId: '' });
    }
    await this.products.delete(productId);
  }

  async getProductForEvent(eventId: string): Promise<Product | undefined> {
    if (!eventId) return undefined;
    const event = await this.events.getById(eventId);
    if (event?.productId) {
      return await this.products.getById(event.productId);
    }
    const memoryMatch = this.products.entries().find((p) => p.eventDocId === eventId);
    if (memoryMatch) return memoryMatch;

    try {
      const q = query(collection(this.db, 'products'), where('eventDocId', '==', eventId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const prod = firestoreDocToProduct(snap.docs[0]);
        this.products.upsert(prod);
        await this.syncService.upsertCachedEntry('products', 'docId', prod);
        if (event && !event.productId) {
          await this.events.update(eventId, { productId: prod.docId });
        }
        return prod;
      }
    } catch (err) {
      console.error('Error in getProductForEvent:', err);
    }
    return undefined;
  }

  async getEventAndProduct(
    eventId: string,
  ): Promise<{ event: IlcEvent | undefined; product: Product | undefined }> {
    if (!eventId) return { event: undefined, product: undefined };
    const event = await this.events.getById(eventId);
    let product: Product | undefined;
    if (event?.productId) {
      product = await this.products.getById(event.productId);
    }
    if (!product) {
      product = await this.getProductForEvent(eventId);
    }
    return { event, product };
  }

  // Returns the forthcoming listed events the given instructor is involved in,
  // either as the leading instructor (matched by human-readable instructorId)
  // or as the event owner/manager (matched by their member document ID).
  // Only events that have not yet ended are returned, sorted soonest-first.
  // Uses three equality queries (no composite index required) and merges them.
  async getUpcomingEventsForInstructor(
    instructorId: string,
    instructorDocId: string,
  ): Promise<IlcEvent[]> {
    if (!instructorId && !instructorDocId) return [];

    if (this.events.entries().length > 0) {
      const now = new Date().toISOString();
      return this.events.entries()
        .filter((ev) => {
          const matches =
            (instructorId && ev.leadingInstructorId === instructorId) ||
            (instructorDocId && (ev.ownerDocId === instructorDocId || (ev.managerDocIds && ev.managerDocIds.includes(instructorDocId))));
          return matches && ev.status === EventStatus.Listed && (ev.end || ev.start) >= now;
        })
        .sort((a, b) => a.start.localeCompare(b.start));
    }

    const queries = [];
    if (instructorId) {
      queries.push(query(this.eventsCollection, where('leadingInstructorId', '==', instructorId)));
    }
    if (instructorDocId) {
      queries.push(query(this.eventsCollection, where('ownerDocId', '==', instructorDocId)));
      queries.push(query(this.eventsCollection, where('managerDocIds', 'array-contains', instructorDocId)));
    }

    try {
      const snaps = await Promise.all(queries.map((q) => getDocs(q)));
      const merged = new Map<string, IlcEvent>();
      for (const snap of snaps) {
        for (const d of snap.docs) {
          merged.set(d.id, { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent);
        }
      }
      const now = new Date().toISOString();
      return Array.from(merged.values())
        .filter((ev) => ev.status === EventStatus.Listed && (ev.end || ev.start) >= now)
        .sort((a, b) => a.start.localeCompare(b.start));
    } catch (error) {
      console.error('Error getting upcoming events for instructor:', error);
      return [];
    }
  }

  // Fetches all events associated with the given human-readable schoolId and
  // splits them into upcoming and past (relative to now). Events are publicly
  // readable, so this works on the public school profile page. `pastLimit`
  // caps the number of past events returned (most-recent first).
  async getEventsForSchool(
    schoolId: string,
    pastLimit = 5,
  ): Promise<{ upcoming: IlcEvent[]; past: IlcEvent[]; pastTotal: number }> {
    if (!schoolId) return { upcoming: [], past: [], pastTotal: 0 };

    if (this.events.entries().length > 0) {
      const events = this.events
        .entries()
        .filter((ev) => ev.schoolId === schoolId && ev.status === EventStatus.Listed);
      const now = new Date().toISOString();
      const upcoming = events
        .filter((ev) => (ev.end || ev.start) >= now)
        .sort((a, b) => a.start.localeCompare(b.start));
      const pastAll = events
        .filter((ev) => (ev.end || ev.start) < now)
        .sort((a, b) => b.start.localeCompare(a.start));
      const past = pastAll.slice(0, pastLimit);
      return { upcoming, past, pastTotal: pastAll.length };
    }
    try {
      const q = query(this.eventsCollection, where('schoolId', '==', schoolId));
      const snap = await getDocs(q);
      const events = snap.docs
        .map((d) => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent))
        .filter((ev) => ev.status === EventStatus.Listed);
      const now = new Date().toISOString();
      const upcoming = events
        .filter((ev) => (ev.end || ev.start) >= now)
        .sort((a, b) => a.start.localeCompare(b.start));
      const pastAll = events
        .filter((ev) => (ev.end || ev.start) < now)
        .sort((a, b) => b.start.localeCompare(a.start));
      return { upcoming, past: pastAll.slice(0, pastLimit), pastTotal: pastAll.length };
    } catch (error) {
      console.error('Error getting events for school:', error);
      return { upcoming: [], past: [], pastTotal: 0 };
    }
  }

  // Returns the schools the given instructor owns or manages, matched by their
  // human-readable instructorId. Schools are publicly readable, so this works
  // on the public instructor profile page without an authenticated session.
  // Uses two equality queries (no composite index required) and merges them.
  async getSchoolsForInstructor(instructorId: string): Promise<School[]> {
    if (!instructorId) return [];
    try {
      const ownerQ = query(this.schoolsCollection, where('ownerInstructorId', '==', instructorId));
      const managerQ = query(this.schoolsCollection, where('managerInstructorIds', 'array-contains', instructorId));
      const [ownerSnap, managerSnap] = await Promise.all([getDocs(ownerQ), getDocs(managerQ)]);
      const merged = new Map<string, School>();
      for (const snap of [ownerSnap, managerSnap]) {
        for (const d of snap.docs) {
          merged.set(d.id, firestoreDocToSchool(d));
        }
      }
      return Array.from(merged.values()).sort((a, b) => a.schoolName.localeCompare(b.schoolName));
    } catch (error) {
      console.error('Error getting schools for instructor:', error);
      return [];
    }
  }

  async getGradingById(id: string): Promise<Grading | undefined> {
    if (!id) return undefined;
    const cached = this.gradings.get(id) ?? this.myGradings.get(id) ?? this.myGradingsAssessed.get(id);
    if (cached) return cached;

    try {
      const docRef = doc(this.db, 'gradings', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return firestoreDocToGrading(docSnap as any);
      }
    } catch (error) {
      console.error('Error getting grading by ID:', error);
    }
    return undefined;
  }



  async updateMyStudentsSync(user: UserDetails, forceFullRefresh = false) {
    // If the user is an instructor (has an instructorId), load their students.
    if (user.member.instructorId && user.member.docId) {
      const instructorIdUpper = user.member.instructorId.trim().toUpperCase();
      const cacheKey = `my_students_${user.member.docId}`;
      const isStudentOfInstructor = (m: Member) =>
        Boolean(m.primaryInstructorId && m.primaryInstructorId.trim().toUpperCase() === instructorIdUpper);

      await this.myStudents.sync({
        cacheKey,
        collectionPath: `instructors/${user.member.docId}/members`,
        additionalFilter: isStudentOfInstructor,
        forceFullRefresh,
      });
    } else {
      this.myStudents.setEntries([]);
    }
  }


  private countersUnsubscribe: (() => void) | null = null;

  updateCountersSync(user: UserDetails | null) {
    if (this.countersUnsubscribe) {
      this.countersUnsubscribe();
      this.countersUnsubscribe = null;
    }
    if (user?.isAdmin) {
      const countersRef = doc(this.db, 'system', 'counters');
      this.countersUnsubscribe = onSnapshot(countersRef, (doc) => {
        if (doc.exists()) {
          this.counters.set(doc.data() as Counters);
        } else {
          // Don't write to Firestore here — creating/resetting counters is an
          // admin-only operation. Just provide a local default so the UI
          // doesn't hang.
          console.warn('system/counters document does not exist.');
          this.counters.set({
            memberIdCounters: {},
            instructorIdCounter: 100,
            schoolIdCounter: 100,
          });
        }
      }, (error) => {
        console.error('Error fetching counters:', error);
      });
    } else {
      this.counters.set(null);
    }
  }

  async updateCountryCodesSync() {
    const countryCodesRef = doc(this.db, 'system', 'country-codes');
    this.snapshotsToUnsubscribe.push(
      onSnapshot(countryCodesRef, (doc) => {
        if (doc.exists()) {
          const countryCodeDoc = doc.data() as CountryCodesDoc;
          this.countries.setEntries(countryCodeDoc.codes);
        } else {
          // If the doc doesn't exist, provide a default list so it doesn't hang.
          const countryCodes: CountryCodesDoc = { codes: countryCodeList };
          this.countries.setEntries(countryCodeList);
          // Only attempt to initialize the doc in Firestore if the user is an admin
          if (this.firebaseService.user()?.isAdmin) {
            setDoc(countryCodesRef, countryCodes).catch((e) => {
              console.warn('Could not initialize country-codes document (possibly not admin).', e);
            });
          }
        }
      }, (error) => {
        console.error('Error fetching country codes:', error);
        this.countries.setError(error.message);
      }),
    );
  }

  async updateSystemTagsSync() {
    const tagsRef = doc(this.db, 'system', 'video-tags');
    this.snapshotsToUnsubscribe.push(
      onSnapshot(
        tagsRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const rawData = docSnap.data() as Partial<SystemVideoTagsDoc> & {
              tags?: Record<string, VideoTagMeta> | string[];
            };
            const tagsRecord: Record<string, VideoTagMeta> = {};

            if (rawData && rawData.tags) {
              if (Array.isArray(rawData.tags)) {
                for (const t of rawData.tags) {
                  if (typeof t === 'string' && t.trim()) {
                    const norm = t.trim().toLowerCase();
                    tagsRecord[norm] = initVideoTagMeta(norm, '', norm);
                  }
                }
              } else if (typeof rawData.tags === 'object') {
                for (const [key, val] of Object.entries(rawData.tags)) {
                  if (val && typeof val === 'object') {
                    tagsRecord[key] = {
                      tag: val.tag || key,
                      label: val.label || key,
                      description: val.description || '',
                      category: val.category || '',
                      createdAt: val.createdAt || '',
                      lastUpdated: val.lastUpdated || '',
                    };
                  } else if (typeof val === 'string') {
                    tagsRecord[key] = initVideoTagMeta(key, val, key);
                  }
                }
              }
            }
            this.tagsDoc.set(tagsRecord);
          }
        },
        (error) => {
          console.warn('Error fetching system video tags:', error);
        },
      ),
    );
  }

  async saveSystemTags(
    tags: (string | Partial<VideoTagMeta>)[],
  ): Promise<void> {
    const current = { ...this.tagsDoc() };
    const nowIso = new Date().toISOString();

    for (const item of tags) {
      if (typeof item === 'string') {
        const norm = item.trim().toLowerCase();
        if (!norm) continue;
        if (!current[norm]) {
          current[norm] = initVideoTagMeta(norm, '', norm);
        }
      } else if (item && item.tag) {
        const norm = item.tag.trim().toLowerCase();
        if (!norm) continue;
        const existing = current[norm] || initVideoTagMeta(norm, '', norm);
        current[norm] = {
          ...existing,
          ...item,
          tag: norm,
          lastUpdated: nowIso,
        };
      }
    }

    const tagsRef = doc(this.db, 'system', 'video-tags');
    await setDoc(
      tagsRef,
      {
        tags: current,
        lastUpdated: nowIso,
      },
      { merge: true },
    ).catch((err) => {
      console.warn('Failed to save system video tags:', err);
    });
  }

  async saveVideoTagMeta(meta: VideoTagMeta): Promise<void> {
    await this.saveSystemTags([meta]);
  }

  private emailTemplatesUnsubscribe: (() => void) | null = null;

  updateEmailTemplatesSync(user: UserDetails | null) {
    if (this.emailTemplatesUnsubscribe) {
      this.emailTemplatesUnsubscribe();
      this.emailTemplatesUnsubscribe = null;
    }
    if (user?.isAdmin) {
      const emailTemplatesRef = doc(this.db, 'system', 'email-templates');
      this.emailTemplatesUnsubscribe = onSnapshot(emailTemplatesRef, (doc) => {
        if (doc.exists()) {
          this.emailTemplates.set(doc.data() as EmailTemplates);
        } else {
          console.warn('system/email-templates document does not exist, using defaults.');
          this.emailTemplates.set(initEmailTemplates());
        }
      }, (error) => {
        console.error('Error fetching email templates:', error);
      });
    } else {
      this.emailTemplates.set(null);
    }
  }

  private mailSettingsUnsubscribe: (() => void) | null = null;

  updateMailSettingsSync(user: UserDetails | null) {
    if (this.mailSettingsUnsubscribe) {
      this.mailSettingsUnsubscribe();
      this.mailSettingsUnsubscribe = null;
    }
    const mailSettingsRef = doc(this.db, 'system', 'mail-settings');
    this.mailSettingsUnsubscribe = onSnapshot(
      mailSettingsRef,
      (snap) => {
        if (snap.exists()) {
          this.mailSettings.set({
            ...initMailSettings(),
            ...(snap.data() as Partial<MailSettings>),
          });
        } else {
          this.mailSettings.set(initMailSettings());
        }
      },
      (error) => {
        console.error('Error fetching mail settings:', error);
      },
    );
  }

  private gradingsUnsubscribe: (() => void) | null = null;

  updateGradingsSync(user: UserDetails | null, queryLimit: number) {
    // Tear down any previous subscription first so growing the page size (or a
    // login/logout) doesn't leave a stale listener attached.
    if (this.gradingsUnsubscribe) {
      this.gradingsUnsubscribe();
      this.gradingsUnsubscribe = null;
    }
    if (user?.isAdmin) {
      const gradingsCollection = collection(this.db, 'gradings');
      const q = query(gradingsCollection, orderBy('lastUpdated', 'desc'), limit(queryLimit));
      this.gradingsUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const gradingsList = snapshot.docs.map(firestoreDocToGrading);
          this.gradings.setEntries(gradingsList);
        },
        (error) => {
          console.error('Error fetching gradings:', error);
          this.gradings.setError(error.message);
        },
      );
    } else {
      this.gradings.setEntries([]);
    }
  }

  // Grow the admin gradings page size, re-subscribing to pull the next page. The
  // effect watching `gradingsQueryLimit` handles the re-subscription.
  loadMoreGradings() {
    this.gradingsQueryLimit.update((n) => n + 50);
  }

  // Fetch every grading matching a given event date + primary grading instructor,
  // used when opening an "implicit event" group so the filtered view is complete
  // even when the paginated list only loaded part of the day. Queries the admin
  // top-level `gradings` collection, or an instructor's `gradings` subcollection
  // when `instructorMemberDocId` is provided.
  async searchGradingsByDateAndInstructor(
    date: string,
    instructorId: string,
    opts?: { instructorMemberDocId?: string },
  ): Promise<Grading[]> {
    if (!date || !instructorId) return [];
    const gradingsRef = opts?.instructorMemberDocId
      ? collection(this.db, `instructors/${opts.instructorMemberDocId}/gradings`)
      : collection(this.db, 'gradings');
    const q = query(
      gradingsRef,
      where('gradingEventDate', '==', date),
      where('gradingInstructorId', '==', instructorId),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(firestoreDocToGrading);
  }

  async searchGradings(criteria: GradingSearchCriteria): Promise<Grading[]> {
    const status = criteria.statusFilter;

    if (criteria.kind === 'term') {
      const term = criteria.term.trim();
      const field = criteria.searchField;
      if (!term) return [];

      const results = new Map<string, Grading>();

      if (field === 'studentMemberDocId' || field === 'memberDocId') {
        let qDoc = query(
          collection(this.db, 'gradings'),
          where('studentMemberDocId', '==', term),
        );
        const snap = await getDocs(qDoc);
        snap.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
      } else if (field === 'studentMemberId' || field === 'memberId') {
        let qId = query(
          collection(this.db, 'gradings'),
          where('studentMemberId', '==', term),
        );
        const snap = await getDocs(qId);
        snap.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
      } else if (field === 'gradingInstructorId' || field === 'instructorId') {
        const qLead = query(
          collection(this.db, 'gradings'),
          where('gradingInstructorId', '==', term),
        );
        const qMgr = query(
          collection(this.db, 'gradings'),
          where('gradingManagerIds', 'array-contains', term),
        );
        const [snapLead, snapMgr] = await Promise.all([
          getDocs(qLead),
          getDocs(qMgr),
        ]);
        snapLead.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
        snapMgr.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
      } else if (field === 'orderId') {
        const qOrder = query(
          collection(this.db, 'gradings'),
          where('orderId', '==', term),
        );
        const snap = await getDocs(qOrder);
        snap.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
      } else {
        const q = query(
          collection(this.db, 'gradings'),
          where(field, '==', term),
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => results.set(d.id, firestoreDocToGrading(d)));
      }

      let gradingList = Array.from(results.values());
      if (status) {
        gradingList = gradingList.filter((g) => g.status === status);
      }
      return gradingList;
    } else if (criteria.kind === 'date') {
      let q = query(collection(this.db, 'gradings'));
      if (criteria.startDate) {
        q = query(q, where('gradingEventDate', '>=', criteria.startDate));
      }
      if (criteria.endDate) {
        q = query(q, where('gradingEventDate', '<=', criteria.endDate));
      }
      q = query(q, orderBy('gradingEventDate', 'desc'), limit(500));
      const snap = await getDocs(q);
      let results = snap.docs.map(firestoreDocToGrading);
      if (status) {
        results = results.filter((g) => g.status === status);
      }
      return results;
    }
    return [];
  }

  private myGradingsAssessedUnsubscribe: (() => void) | null = null;

  updateMyGradingsAssessedSync(user: UserDetails) {
    if (this.myGradingsAssessedUnsubscribe) {
      this.myGradingsAssessedUnsubscribe();
      this.myGradingsAssessedUnsubscribe = null;
    }

    if (user.member.instructorId && user.member.docId) {
      const q = query(
        collection(this.db, `instructors/${user.member.docId}/gradings`),
        orderBy('lastUpdated', 'desc'),
      );
      this.myGradingsAssessedUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const gradingsList = snapshot.docs.map(firestoreDocToGrading);
          this.myGradingsAssessed.setEntries(gradingsList);
        },
        (error) => {
          console.error('Error fetching my gradings assessed:', error);
          this.myGradingsAssessed.setError(error.message);
        },
      );
    } else {
      this.myGradingsAssessed.setEntries([]);
    }
  }

  private myGradingsUnsubscribes: (() => void)[] = [];

  // Called reactively from an effect whenever the user's member data changes.
  // Re-subscribes to gradings whenever the member's gradingDocIds list changes.
  updateMyGradingsSync(user: UserDetails | null) {
    this.myGradingsUnsubscribes.forEach((unsub) => unsub());
    this.myGradingsUnsubscribes = [];

    const memberDocId = user?.member?.docId ?? '';
    const gradingDocIds = user?.member?.gradingDocIds ?? [];

    if (memberDocId && gradingDocIds.length > 0) {
      const chunkSize = 10;
      const gradingsMap = new Map<string, Grading>();

      for (let i = 0; i < gradingDocIds.length; i += chunkSize) {
        const chunk = gradingDocIds.slice(i, i + chunkSize);
        const q = query(
          collection(this.db, 'gradings'),
          where(documentId(), 'in', chunk),
        );

        const unsub = onSnapshot(
          q,
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === 'removed') {
                gradingsMap.delete(change.doc.id);
              } else {
                gradingsMap.set(change.doc.id, firestoreDocToGrading(change.doc));
              }
            });
            this.myGradings.setEntries(Array.from(gradingsMap.values()));
          },
          (error) => {
            console.error('Error fetching my gradings:', error);
            this.myGradings.setError(error.message);
          },
        );
        this.myGradingsUnsubscribes.push(unsub);
      }
    } else {
      this.myGradings.setEntries([]);
    }
  }

  private async persistMemberLocally(member: Member): Promise<void> {
    this.members.upsert(member);
    const user = this.firebaseService.user();
    const userInstructorId = user?.member?.instructorId
      ? user.member.instructorId.trim().toUpperCase()
      : '';
    const memberInstructorId = member.primaryInstructorId
      ? member.primaryInstructorId.trim().toUpperCase()
      : '';
    const isMyStudent =
      Boolean(userInstructorId && memberInstructorId && memberInstructorId === userInstructorId);

    if (isMyStudent) {
      this.myStudents.upsert(member);
      if (user?.member?.docId) {
        const instructorCacheKey = `my_students_${user.member.docId}`;
        await this.syncService.upsertCachedEntry(instructorCacheKey, 'docId', member);
      }
    } else {
      this.myStudents.delete(member.docId);
      if (user?.member?.docId) {
        const instructorCacheKey = `my_students_${user.member.docId}`;
        await this.syncService.deleteCachedEntry(instructorCacheKey, 'docId', member.docId);
      }
    }

    if (user?.isAdmin) {
      const adminCacheKey = `members_admin_${user.firebaseUser?.uid || 'admin'}`;
      await this.syncService.upsertCachedEntry(adminCacheKey, 'docId', member);
    }
    if (member.primarySchoolId) {
      const schoolCacheKey = `school_members_${member.primarySchoolId}`;
      await this.syncService.upsertCachedEntry(schoolCacheKey, 'docId', member);
    }
    if (typeof this.firebaseService.updateCachedMemberProfile === 'function') {
      await this.firebaseService.updateCachedMemberProfile(member);
    }
  }

  private async removeMemberLocally(memberDocId: string, primarySchoolId?: string): Promise<void> {
    this.members.deleteLocal(memberDocId);
    this.myStudents.deleteLocal(memberDocId);
    const user = this.firebaseService.user();
    if (user?.isAdmin) {
      const adminCacheKey = `members_admin_${user.firebaseUser?.uid || 'admin'}`;
      await this.syncService.deleteCachedEntry(adminCacheKey, 'docId', memberDocId);
    }
    if (primarySchoolId) {
      const schoolCacheKey = `school_members_${primarySchoolId}`;
      await this.syncService.deleteCachedEntry(schoolCacheKey, 'docId', memberDocId);
    }
    if (user?.member?.docId) {
      const instructorCacheKey = `my_students_${user.member.docId}`;
      await this.syncService.deleteCachedEntry(instructorCacheKey, 'docId', memberDocId);
    }
  }

  async persistSchoolLocally(school: School): Promise<void> {
    this.schools.upsert(school);
    if (this.mySchools.get(school.schoolId)) {
      this.mySchools.upsert(school);
    }
    await this.syncService.upsertCachedEntry('schools', 'schoolId', school);
  }

  private async removeSchoolLocally(schoolId: string): Promise<void> {
    this.schools.deleteLocal(schoolId);
    this.mySchools.delete(schoolId);
    await this.syncService.deleteCachedEntry('schools', 'schoolId', schoolId);
  }

  async persistEventLocally(event: IlcEvent): Promise<void> {
    this.events.upsert(event);
    await this.syncService.upsertCachedEntry('public_events', 'docId', event);
  }

  async rollbackQueuedAction(
    action: QueuedAction,
    targetState: RollbackTarget = RollbackTarget.Baseline,
  ): Promise<void> {
    const docId = action.entityDocId;
    const isRemote = targetState === RollbackTarget.Remote;
    const targetSnapshot = isRemote && action.conflictDetails?.remoteState
      ? action.conflictDetails.remoteState
      : (action.baselineSnapshot ?? action.oldState);

    if (!targetSnapshot) return;

    switch (action.kind) {
      case QueuedActionKind.UpdateMember:
      case 'update_member': {
        const existing = this.members.get(docId);
        const restored: Member = {
          ...(existing ?? initMember()),
          ...targetSnapshot,
          docId,
          lastUpdated: new Date().toISOString(),
        } as Member;
        await this.persistMemberLocally(restored);
        break;
      }
      case QueuedActionKind.UpdateSchool:
      case 'update_school': {
        const existing = this.schools.entries().find((s) => s.docId === docId || s.schoolId === docId);
        const restored: School = {
          ...(existing ?? initSchool()),
          ...targetSnapshot,
          docId,
          schoolId: (targetSnapshot['schoolId'] as string) || existing?.schoolId || docId,
          lastUpdated: new Date().toISOString(),
        } as School;
        await this.persistSchoolLocally(restored);
        break;
      }
      case QueuedActionKind.UpdateEvent:
      case 'update_event': {
        const existing = this.events.get(docId);
        const restored: IlcEvent = {
          ...(existing ?? initEvent()),
          ...targetSnapshot,
          docId,
          lastUpdated: new Date().toISOString(),
        } as IlcEvent;
        await this.persistEventLocally(restored);
        break;
      }
      case QueuedActionKind.UpdateGrading:
      case 'update_grading': {
        const existing =
          this.gradings.get(docId) ??
          this.myGradings.get(docId) ??
          this.myGradingsAssessed.get(docId);
        const restored: Grading = {
          ...(existing ?? {}),
          ...targetSnapshot,
          docId,
          lastUpdated: new Date().toISOString(),
        } as Grading;
        this.applyLocalGradingUpdate(restored);
        break;
      }
      default: {
        if (action.collectionPath === FirestoreCollection.Members || action.collectionPath === 'members') {
          const existing = this.members.get(docId);
          const restored = {
            ...(existing ?? initMember()),
            ...targetSnapshot,
            docId,
            lastUpdated: new Date().toISOString(),
          } as Member;
          await this.persistMemberLocally(restored);
        } else if (action.collectionPath === FirestoreCollection.Schools || action.collectionPath === 'schools') {
          const existing = this.schools.entries().find((s) => s.docId === docId || s.schoolId === docId);
          const restored = {
            ...(existing ?? initSchool()),
            ...targetSnapshot,
            docId,
            schoolId: (targetSnapshot['schoolId'] as string) || existing?.schoolId || docId,
            lastUpdated: new Date().toISOString(),
          } as School;
          await this.persistSchoolLocally(restored);
        } else if (action.collectionPath === FirestoreCollection.Events || action.collectionPath === 'events') {
          const existing = this.events.get(docId);
          const restored = {
            ...(existing ?? initEvent()),
            ...targetSnapshot,
            docId,
            lastUpdated: new Date().toISOString(),
          } as IlcEvent;
          await this.persistEventLocally(restored);
        } else if (action.collectionPath === FirestoreCollection.Gradings || action.collectionPath === 'gradings') {
          const existing = this.gradings.get(docId) ?? this.myGradings.get(docId);
          const restored = {
            ...(existing ?? {}),
            ...targetSnapshot,
            docId,
            lastUpdated: new Date().toISOString(),
          } as Grading;
          this.applyLocalGradingUpdate(restored);
        }
        break;
      }
    }
  }

  async removeEventLocally(eventId: string): Promise<void> {
    await this.events.delete(eventId);
  }

  async addMember(member: Member): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'members');
    const newDocRef = doc(collectionRef);
    const cleanMember: Member = {
      ...member,
      memberId: member.memberId ? member.memberId.trim().toUpperCase() : member.memberId,
      instructorId: member.instructorId ? member.instructorId.trim().toUpperCase() : member.instructorId,
      primaryInstructorId: member.primaryInstructorId ? member.primaryInstructorId.trim().toUpperCase() : member.primaryInstructorId,
    };
    const memberWithNewTimestamp: MemberFsDoc = {
      ...cleanMember,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(newDocRef, memberWithNewTimestamp);
    const addedMember: Member = {
      ...cleanMember,
      docId: newDocRef.id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistMemberLocally(addedMember);
    return newDocRef;
  }

  async updateMember(id: string, newMember: Member, oldMember?: Member): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    const cleanMember: Member = {
      ...newMember,
      memberId: newMember.memberId ? newMember.memberId.trim().toUpperCase() : newMember.memberId,
      instructorId: newMember.instructorId ? newMember.instructorId.trim().toUpperCase() : newMember.instructorId,
      primaryInstructorId: newMember.primaryInstructorId ? newMember.primaryInstructorId.trim().toUpperCase() : newMember.primaryInstructorId,
    };
    let originalMember = oldMember;
    if (!originalMember) {
      originalMember = this.members.get(cleanMember.docId);
    }

    if (this.networkState.isOffline()) {
      const diff = computeObjectDiff<Member>(originalMember, cleanMember, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      const summary = formatFieldSummary(diff.changedKeys, `profile for ${cleanMember.name || id}`);

      await this.actionQueue.enqueueAction<Partial<Member>>({
        kind: QueuedActionKind.UpdateMember,
        entityDocId: id,
        entityTitle: this.memberDisplayName(id, cleanMember.memberId, cleanMember.name),
        description: summary,
        collectionPath: FirestoreCollection.Members,
        oldState: diff.changedOldState,
        newState: diff.changedNewState,
        baselineSnapshot: originalMember ? structuredClone(originalMember) : undefined,
      });
      const updatedMember: Member = {
        ...cleanMember,
        docId: id,
        lastUpdated: new Date().toISOString(),
      };
      await this.persistMemberLocally(updatedMember);
      return;
    }

    // If the member is found in the current list of members, only update the 
    // fields that have changed. This is more efficient than updating the entire
    // member document, and also it is necessary to stop small oddnesses in 
    // the firestore database content (e.g. old field names, etc.) from breaking 
    // member updates to themselves. By only asking to update fields that changed, 
    // we avoid firestore rules from rejecting the update due to the presence of 
    // fields that are not allowed.
    if (originalMember) {
      const diff = computeObjectDiff<Member>(originalMember, cleanMember, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      const changes: Partial<MemberFsDoc> = {
        ...diff.changedNewState,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      await setDoc(docRef, changes, { merge: true });
    } else {
      // Fallback if no old member is found
      const memberWithNewTimestamp: MemberFsDoc = {
        ...cleanMember,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      delete (memberWithNewTimestamp as { docId?: string }).docId;
      await setDoc(docRef, memberWithNewTimestamp, { merge: true });
    }

    // Optimistically update in-memory SearchableSet and IndexedDB cache immediately!
    const updatedMember: Member = {
      ...cleanMember,
      docId: id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistMemberLocally(updatedMember);
  }

  async updateMemberAndStudentInstructorIds(id: string, member: Member, oldInstructorId: string): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    const cleanOldInstructorId = (oldInstructorId || '').trim().toUpperCase();
    const cleanNewInstructorId = (member.instructorId || '').trim().toUpperCase();
    const cleanMember: Member = {
      ...member,
      memberId: member.memberId ? member.memberId.trim().toUpperCase() : member.memberId,
      instructorId: cleanNewInstructorId,
      primaryInstructorId: member.primaryInstructorId ? member.primaryInstructorId.trim().toUpperCase() : member.primaryInstructorId,
    };
    const memberWithNewTimestamp: MemberFsDoc = {
      ...cleanMember,
      lastUpdated: serverTimestamp() as Timestamp,
    };

    const qOld = query(this.membersCollection, where('primaryInstructorId', '==', cleanOldInstructorId));
    const snapOld = await getDocs(qOld);

    const qNew = query(this.membersCollection, where('primaryInstructorId', '==', cleanNewInstructorId));
    const snapNew = await getDocs(qNew);

    const batch = writeBatch(this.db);
    batch.set(docRef, memberWithNewTimestamp, { merge: true });

    snapOld.docs.forEach((d) => {
      batch.update(d.ref, { primaryInstructorId: cleanNewInstructorId, lastUpdated: serverTimestamp() });
    });

    snapNew.docs.forEach((d) => {
      const subDocRef = doc(this.db, 'instructors', id, 'members', d.id);
      batch.set(subDocRef, { ...d.data(), primaryInstructorId: cleanNewInstructorId, lastUpdated: serverTimestamp() }, { merge: true });
    });

    await batch.commit();

    const updatedMember: Member = {
      ...member,
      docId: id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistMemberLocally(updatedMember);

    // Update affected students locally as well
    for (const d of snapOld.docs) {
      const m = this.members.get(d.id);
      if (m) {
        const updatedStudent: Member = {
          ...m,
          primaryInstructorId: member.instructorId,
          lastUpdated: new Date().toISOString(),
        };
        await this.persistMemberLocally(updatedStudent);
      }
    }
  }

  async deleteMember(emailId: string): Promise<void> {
    const docRef = doc(this.db, 'members', emailId);
    const existing = this.members.get(emailId);
    await deleteDoc(docRef);
    await this.removeMemberLocally(emailId, existing?.primarySchoolId);
  }

  async setSchool(school: School, oldSchool?: School): Promise<void> {
    let docRef: DocumentReference;
    if (school.docId) {
      docRef = doc(this.db, 'schools', school.docId);
    } else {
      docRef = doc(collection(this.db, 'schools'));
    }

    if (this.networkState.isOffline()) {
      const docId = school.docId || school.schoolId;
      const diff = computeObjectDiff<School>(oldSchool, school, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      const summary = formatFieldSummary(diff.changedKeys, `school ${school.schoolName || docId}`);

      await this.actionQueue.enqueueAction<Partial<School>>({
        kind: QueuedActionKind.UpdateSchool,
        entityDocId: docId,
        entityTitle: school.schoolName || docId,
        description: summary,
        collectionPath: FirestoreCollection.Schools,
        oldState: diff.changedOldState,
        newState: diff.changedNewState,
        baselineSnapshot: oldSchool ? structuredClone(oldSchool) : undefined,
      });
      const updatedSchool: School = {
        ...school,
        docId,
        lastUpdated: new Date().toISOString(),
      };
      await this.persistSchoolLocally(updatedSchool);
      return;
    }

    // When we have the original school, only send changed fields.
    // This is necessary for school managers who are restricted by
    // firestore rules to only update specific fields via affectedKeys().hasOnly(...).
    if (oldSchool) {
      const diff = computeObjectDiff<School>(oldSchool, school, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      const changes: Partial<SchoolFsDoc> = {
        ...diff.changedNewState,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      await setDoc(docRef, changes, { merge: true });
    } else {
      // Fallback: send everything (for new schools or when no original is available)
      const schoolWithNewTimestamp: SchoolFsDoc = {
        ...school,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      await setDoc(docRef, schoolWithNewTimestamp, { merge: true });
    }

    const updatedSchool: School = {
      ...school,
      docId: docRef.id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistSchoolLocally(updatedSchool);
  }

  async setSchoolAndUpdateMembers(school: School, oldSchoolId: string): Promise<void> {
    const schoolWithNewTimestamp: SchoolFsDoc = {
      ...school,
      lastUpdated: serverTimestamp() as Timestamp,
    };

    let schoolDocRef: DocumentReference;
    if (school.docId) {
      schoolDocRef = doc(this.db, 'schools', school.docId);
    } else {
      schoolDocRef = doc(collection(this.db, 'schools'));
    }

    const qOld = query(this.membersCollection, where('primarySchoolId', '==', oldSchoolId));
    const snapOld = await getDocs(qOld);

    const qNew = query(this.membersCollection, where('primarySchoolId', '==', school.schoolId));
    const snapNew = await getDocs(qNew);

    const batch = writeBatch(this.db);
    batch.set(schoolDocRef, schoolWithNewTimestamp, { merge: true });

    snapOld.docs.forEach((d) => {
      batch.update(d.ref, { primarySchoolId: school.schoolId, lastUpdated: serverTimestamp() });
    });

    snapNew.docs.forEach((d) => {
      const subDocRef = doc(this.db, 'schools', schoolDocRef.id, 'members', d.id);
      batch.set(subDocRef, { ...d.data(), primarySchoolId: school.schoolId, lastUpdated: serverTimestamp() }, { merge: true });
    });

    await batch.commit();

    const updatedSchool: School = {
      ...school,
      docId: schoolDocRef.id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistSchoolLocally(updatedSchool);

    for (const d of snapOld.docs) {
      const m = this.members.get(d.id);
      if (m) {
        const updatedMember: Member = {
          ...m,
          primarySchoolId: school.schoolId,
          lastUpdated: new Date().toISOString(),
        };
        await this.persistMemberLocally(updatedMember);
      }
    }
  }

  async deleteSchool(id: string, onProgress?: (msg: string) => void): Promise<void> {
    const membersRef = collection(this.db, 'schools', id, 'members');
    const membersSnap = await getDocs(membersRef);
    if (!membersSnap.empty) {
      if (onProgress) onProgress(`Deleting ${membersSnap.docs.length} members from school...`);
      for (const mDoc of membersSnap.docs) {
        await deleteDoc(mDoc.ref);
      }
    }
    if (onProgress) onProgress('Deleting school...');
    await deleteDoc(doc(this.db, 'schools', id));
    const school = this.schools.entries().find(s => s.docId === id || s.schoolId === id);
    if (school) {
      await this.removeSchoolLocally(school.schoolId);
    }
  }

  async addGrading(grading: Grading): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'gradings');
    const newDocRef = doc(collectionRef);
    const gradingWithNewTimestamp: GradingFsDoc = {
      ...grading,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(newDocRef, gradingWithNewTimestamp);
    const addedGrading: Grading = {
      ...grading,
      docId: newDocRef.id,
      lastUpdated: new Date().toISOString(),
    };
    this.gradings.upsert(addedGrading);
    return newDocRef;
  }

  async updateGrading(id: string, newGrading: Grading, oldGrading?: Grading): Promise<void> {
    const docRef = doc(this.db, 'gradings', id);
    let originalGrading = oldGrading;
    if (!originalGrading) {
      originalGrading = this.gradings.get(id)
        ?? this.myGradings.get(id)
        ?? this.myGradingsAssessed.get(id);
    }

    if (this.networkState.isOffline()) {
      const diff = computeObjectDiff<Grading>(originalGrading, newGrading, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      const summary = formatFieldSummary(diff.changedKeys, `grading for ${newGrading.studentName || id}`);

      await this.actionQueue.enqueueAction<Partial<Grading>>({
        kind: QueuedActionKind.UpdateGrading,
        entityDocId: id,
        entityTitle: `Grading for ${newGrading.studentName || id}`,
        description: summary,
        collectionPath: FirestoreCollection.Gradings,
        oldState: diff.changedOldState,
        newState: diff.changedNewState,
        baselineSnapshot: originalGrading ? structuredClone(originalGrading) : undefined,
      });
      const updatedGrading: Grading = {
        ...newGrading,
        docId: id,
        lastUpdated: new Date().toISOString(),
      };
      this.applyLocalGradingUpdate(updatedGrading);
      return;
    }

    // Only send changed fields. This is critical for non-admin users (e.g.
    // instructors) whose Firestore rules restrict updates to a subset of
    // fields. Sending unchanged fields would cause rule violations.
    if (originalGrading) {
      const diff = computeObjectDiff<Grading>(originalGrading, newGrading, {
        ignoreKeys: ['docId', 'lastUpdated'],
      });
      for (const key of diff.changedKeys) {
        console.log(`updateGrading diff: field "${key}" changed:`,
          JSON.stringify(originalGrading[key]), '→', JSON.stringify(newGrading[key]));
      }
      const changes: Partial<GradingFsDoc> = {
        ...diff.changedNewState,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      console.log('updateGrading: sending changes:', Object.keys(changes));
      await setDoc(docRef, changes, { merge: true });
    } else {
      // Fallback: send everything (for new gradings or when no original is available)
      const gradingWithNewTimestamp: GradingFsDoc = {
        ...newGrading,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      delete (gradingWithNewTimestamp as { docId?: string }).docId;
      await setDoc(docRef, gradingWithNewTimestamp, { merge: true });
    }

    const updatedGrading: Grading = {
      ...newGrading,
      docId: id,
      lastUpdated: new Date().toISOString(),
    };
    this.applyLocalGradingUpdate(updatedGrading);
  }

  /**
   * Optimistically apply a saved grading to whichever local cache currently
   * holds it, so a reactive view reflects the change immediately. The main
   * `gradings` set (admins) updates live from its own snapshot, but the
   * per-instructor `myGradingsAssessed` mirror only refreshes once the
   * `onGradingUpdated` Cloud Function re-syncs it — so without this patch a
   * grading manager's view would appear unchanged after saving. The next real
   * snapshot reconciles any difference.
   */
  applyLocalGradingUpdate(grading: Grading): void {
    for (const set of [this.gradings, this.myGradings, this.myGradingsAssessed]) {
      if (set.get(grading.docId)) set.upsert(grading);
    }
  }

  async deleteGrading(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'gradings', id));
    this.gradings.delete(id);
    this.myGradings.delete(id);
    this.myGradingsAssessed.delete(id);
  }



  async addOrder(order: Order): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'orders');
    const newDocRef = doc(collectionRef);
    const orderWithNewTimestamp: OrderFsDoc = {
      ...order,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(newDocRef, orderWithNewTimestamp);
    const addedOrder: Order = {
      ...order,
      docId: newDocRef.id,
      lastUpdated: new Date().toISOString(),
    };
    this.orders.upsert(addedOrder);
    await this.syncService.upsertCachedEntry('admin_orders', 'docId', addedOrder);
    return newDocRef;
  }

  async updateOrder(id: string, order: Order): Promise<void> {
    const docRef = doc(this.db, 'orders', id);
    const orderWithNewTimestamp: OrderFsDoc = {
      ...order,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(docRef, orderWithNewTimestamp, { merge: true });
    const updatedOrder: Order = {
      ...order,
      docId: id,
      lastUpdated: new Date().toISOString(),
    };
    this.orders.upsert(updatedOrder);
    await this.syncService.upsertCachedEntry('admin_orders', 'docId', updatedOrder);
  }

  /**
   * Set (or clear) the ilcAppMemberIdInferred field on a specific line item
   * within an order document. This allows admins to manually associate a
   * member with a particular line item in an order.
   */
  async setOrderLineItemInferredMemberId(
    orderId: string, lineItemId: string, memberId: string
  ): Promise<void> {
    const docRef = doc(this.db, 'orders', orderId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error('Order not found');

    const orderData = docSnap.data() as SquareSpaceOrder;
    const lineItems = orderData.lineItems || [];
    const item = lineItems.find((li: SquareSpaceLineItem) => li.id === lineItemId);
    if (!item) throw new Error(`Line item ${lineItemId} not found in order`);

    item.ilcAppMemberIdInferred = memberId;
    await updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
    const existing = this.orders.get(orderId);
    if (existing && 'lineItems' in existing) {
      const updated = { ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order;
      this.orders.upsert(updated);
      await this.syncService.upsertCachedEntry('admin_orders', 'docId', updated);
    }
  }

  /**
   * Set (or clear) the ilcAppSchoolIdInferred field on a specific line item
   * within an order document. This allows admins to manually associate a
   * school with a particular line item in an order.
   */
  async setOrderLineItemInferredSchoolId(
    orderId: string, lineItemId: string, schoolId: string
  ): Promise<void> {
    const docRef = doc(this.db, 'orders', orderId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error('Order not found');

    const orderData = docSnap.data() as SquareSpaceOrder;
    const lineItems = orderData.lineItems || [];
    const item = lineItems.find((li: SquareSpaceLineItem) => li.id === lineItemId);
    if (!item) throw new Error(`Line item ${lineItemId} not found in order`);

    item.ilcAppSchoolIdInferred = schoolId;
    await updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
    const existing = this.orders.get(orderId);
    if (existing && 'lineItems' in existing) {
      const updated = { ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order;
      this.orders.upsert(updated);
      await this.syncService.upsertCachedEntry('admin_orders', 'docId', updated);
    }
  }

  /**
   * Set (or clear) the ilcAppCountryOverride field on a specific line item
   * within an order document. This allows admins to manually set the country
   * name (from the approved list) for generating a member ID.
   */
  async setOrderLineItemCountryOverride(
    orderId: string, lineItemId: string, country: string
  ): Promise<void> {
    const docRef = doc(this.db, 'orders', orderId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error('Order not found');

    const orderData = docSnap.data() as SquareSpaceOrder;
    const lineItems = orderData.lineItems || [];
    const item = lineItems.find((li: SquareSpaceLineItem) => li.id === lineItemId);
    if (!item) throw new Error(`Line item ${lineItemId} not found in order`);

    item.ilcAppCountryOverride = country;
    await updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
    const existing = this.orders.get(orderId);
    if (existing && 'lineItems' in existing) {
      const updated = { ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order;
      this.orders.upsert(updated);
      await this.syncService.upsertCachedEntry('admin_orders', 'docId', updated);
    }
  }

  /**
   * Look up members whose emails array contains the given email address.
   * Uses the client-side members cache for admins, falls back to Firestore query.
   */
  lookupMembersByEmail(email: string): Member[] {
    if (!email) return [];
    const emailLower = email.toLowerCase().trim();
    return this.members.entries().filter(m =>
      m.emails.some(e => e.toLowerCase() === emailLower)
    );
  }

  /** Update the ilcAppNotes field on an order document. */
  async updateOrderNotes(orderId: string, notes: string): Promise<void> {
    const docRef = doc(this.db, 'orders', orderId);
    await updateDoc(docRef, {
      ilcAppNotes: notes,
      lastUpdated: serverTimestamp(),
    });
    const existing = this.orders.get(orderId);
    if (existing) {
      const updated = { ...existing, ilcAppNotes: notes, lastUpdated: new Date().toISOString() } as Order;
      this.orders.upsert(updated);
      await this.syncService.upsertCachedEntry('admin_orders', 'docId', updated);
    }
  }

  async clearSchoolMembers(schoolDocId: string): Promise<void> {
    const membersRef = collection(this.db, 'schools', schoolDocId, 'members');
    const membersSnap = await getDocs(membersRef);
    if (!membersSnap.empty) {
      const batch = writeBatch(this.db);
      membersSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  async countMembersWithSchoolId(schoolId: string): Promise<number> {
    const q = query(this.membersCollection, where('primarySchoolId', '==', schoolId));
    const snap = await getDocs(q);
    return snap.size;
  }

  async clearInstructorMembers(instructorDocId: string): Promise<void> {
    const membersRef = collection(this.db, 'instructors', instructorDocId, 'members');
    const membersSnap = await getDocs(membersRef);
    if (!membersSnap.empty) {
      const batch = writeBatch(this.db);
      membersSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  async countMembersWithInstructorId(instructorId: string): Promise<number> {
    const cleanId = (instructorId || '').trim().toUpperCase();
    const q = query(this.membersCollection, where('primaryInstructorId', '==', cleanId));
    const snap = await getDocs(q);
    return snap.size;
  }

  async syncSquarespaceOrders(): Promise<void> {
    const fn = httpsCallable<undefined, { success: boolean }>(
      this.functions,
      'manualSquarespaceSync',
    );
    await fn();
  }

  // Request a new (unpaid) grading for the member's next level via the guarded
  // Cloud Function. Returns the new grading's doc ID.
  async requestGrading(memberDocId: string): Promise<string> {
    const fn = httpsCallable<{ memberDocId: string }, { gradingDocId: string }>(
      this.functions,
      'requestGrading',
    );
    const result = await fn({ memberDocId });
    return result.data.gradingDocId;
  }

  // Request a free retake grading for a level the student previously did not pass.
  // Returns the newly created grading doc ID.
  async requestGradingRetake(
    memberDocId: string,
    level?: string,
  ): Promise<string> {
    const fn = httpsCallable<
      { memberDocId: string; level?: string },
      { gradingDocId: string; level: string }
    >(this.functions, 'requestGradingRetake');
    const result = await fn({ memberDocId, level });
    return result.data.gradingDocId;
  }

  // Remove a student who lists the signed-in instructor as their primary
  // instructor. Guarded by a Cloud Function because instructors have no write
  // access to their students' member documents.
  async removeStudentFromInstructor(studentMemberDocId: string): Promise<void> {
    const fn = httpsCallable<
      { studentMemberDocId: string },
      { success: boolean }
    >(this.functions, 'removeStudentFromInstructor');
    await fn({ studentMemberDocId });
  }

  // Record a student's lapsed membership as Inactive, so they drop out of the
  // default view of the signed-in instructor's My Students list. Guarded by the
  // same Cloud Function as the removal, for the same reason.
  async markStudentInactive(studentMemberDocId: string): Promise<void> {
    const fn = httpsCallable<
      { studentMemberDocId: string },
      { success: boolean }
    >(this.functions, 'markStudentInactive');
    await fn({ studentMemberDocId });
  }

  async reprocessOrder(docId: string): Promise<void> {
    const fn = httpsCallable<{ docId: string }, { success: boolean }>(
      this.functions,
      'reprocessOrder',
    );
    await fn({ docId });
  }

  async fulfillOrder(docId: string): Promise<void> {
    const fn = httpsCallable<{ docId: string }, { success: boolean }>(
      this.functions,
      'fulfillOrder',
    );
    await fn({ docId });
  }

  async createNextMemberId(countryCode: string): Promise<string> {
    const nextMemberId = httpsCallable<
      { countryCode: string },
      { newId: string }
    >(this.functions, 'nextMemberId');
    const result = await nextMemberId({ countryCode });
    return result.data.newId;
  }

  async createNextInstructorId(): Promise<number> {
    const nextInstructorId = httpsCallable<unknown, { newId: number }>(
      this.functions,
      'nextInstructorId',
    );
    const result = await nextInstructorId();
    return result.data.newId;
  }

  async createNextSchoolId(): Promise<string> {
    const nextSchoolId = httpsCallable<unknown, { newId: string }>(
      this.functions,
      'nextSchoolId',
    );
    const result = await nextSchoolId();
    return result.data.newId;
  }

  async updateCounters(counters: {
    memberIdCounters?: { [key: string]: number };
    instructorIdCounter?: number;
    schoolIdCounter?: number;
  }): Promise<void> {
    const updateCounters = httpsCallable<
      {
        memberIdCounters?: { [key: string]: number };
        instructorIdCounter?: number;
        schoolIdCounter?: number;
      },
      void
    >(this.functions, 'updateCounters');
    await updateCounters(counters);
  }

  downloadMembersAsCsv() {
    const memberFields = Object.keys(initMember()) as Array<keyof Member>;
    const members = this.members.entries().map((m) => {
      const member: Partial<Member> = {};
      for (const key of memberFields) {
        (member as any)[key] = m[key];
      }
      if (m.mastersLevels) {
        (member as any).mastersLevels = m.mastersLevels.join(',');
      }
      return member;
    });
    const csv = Papa.unparse(members);
    this.downloadFile('members.csv', csv, 'text/csv');
  }

  downloadMembersAsJsonL() {
    const memberFields = Object.keys(initMember()) as Array<keyof Member>;
    const members = this.members.entries().map((m) => {
      const member: Partial<Member> = {};
      for (const key of memberFields) {
        (member as any)[key] = m[key];
      }
      return member;
    });
    const jsonl = members.map((member) => JSON.stringify(member)).join('\n');
    this.downloadFile('members.jsonl', jsonl, 'application/jsonl');
  }

  downloadSchoolsAsCsv() {
    const schoolFields = Object.keys(initSchool()) as Array<keyof School>;
    const schools = this.schools.entries().map((s) => {
      const school: Partial<School> = {};
      for (const key of schoolFields) {
        (school as any)[key] = s[key];
      }
      if (s.managerInstructorIds) {
        (school as any).managerInstructorIds = s.managerInstructorIds.join(',');
      }
      return school;
    });
    const csv = Papa.unparse(schools);
    this.downloadFile('schools.csv', csv, 'text/csv');
  }

  async listBackups() {
    const listBackupsFn = httpsCallable<
      undefined,
      { backups: { name: string; timeCreated: string; size: string; downloadUrl: string }[] }
    >(this.functions, 'listBackups');
    const result = await listBackupsFn();
    return result.data.backups;
  }

  async listResources() {
    const listResourcesFn = httpsCallable<
      undefined,
      { resources: { name: string; fullPath: string; contentType: string; timeCreated: string; size: string; accessLevel: ResourceAccessLevel }[] }
    >(this.functions, 'listResources');
    const result = await listResourcesFn();
    return result.data.resources;
  }

  async deleteResource(fullPath: string) {
    const deleteResourceFn = httpsCallable<
      { fullPath: string },
      { success: boolean }
    >(this.functions, 'deleteResource');
    await deleteResourceFn({ fullPath });
  }

  // Generates a signed download URL for a single resource file on-demand.
  async getResourceDownloadUrl(fullPath: string): Promise<string> {
    const fn = httpsCallable<
      { fullPath: string },
      { downloadUrl: string }
    >(this.functions, 'getResourceDownloadUrl');
    const result = await fn({ fullPath });
    return result.data.downloadUrl;
  }

  async saveCounters(data: Counters) {
    return setDoc(doc(this.db, 'system', 'counters'), data);
  }

  async saveCountryCodes(data: CountryCodesDoc) {
    return setDoc(doc(this.db, 'system', 'country-codes'), data);
  }

  async saveEmailTemplates(data: EmailTemplates) {
    return setDoc(doc(this.db, 'system', 'email-templates'), data);
  }

  async sendAdminTestEmail(options: {
    to: string;
    subject: string;
    bodyMarkdown: string;
    fromName?: string;
    replyTo?: string;
    name?: string;
    replacements?: Record<string, string>;
  }): Promise<{
    success: boolean;
    messageId?: string;
    simulated?: boolean;
    error?: string;
    docId?: string;
  }> {
    const fn = httpsCallable<
      {
        to: string;
        subject: string;
        bodyMarkdown: string;
        fromName?: string;
        replyTo?: string;
        name?: string;
        replacements?: Record<string, string>;
      },
      {
        success: boolean;
        messageId?: string;
        simulated?: boolean;
        error?: string;
        docId?: string;
      }
    >(this.functions, 'sendAdminTestEmail');
    const result = await fn(options);
    return result.data;
  }

  /**
   * Deletes a single mail queue document directly using client SDK (permitted for admins by Firestore security rules).
   */
  async deleteMailItemDirect(mailId: string): Promise<void> {
    const mailRef = doc(this.db, FirestoreCollection.Mail, mailId);
    await deleteDoc(mailRef);
  }

  /**
   * Fetches recent mail queue documents from /mail for admin inspection.
   */
  async getRecentMailDocs(maxCount = 50): Promise<MailQueueDoc[]> {
    const mailCol = collection(this.db, FirestoreCollection.Mail);
    const q = query(mailCol, limit(maxCount));
    const snap = await getDocs(q);
    const docs: MailQueueDoc[] = [];

    for (const d of snap.docs) {
      const data = d.data() as MailQueueDoc;
      docs.push({
        ...data,
        docId: d.id,
      });
    }

    // Sort descending by timestamp
    docs.sort((a, b) => {
      const timeA = this.resolveMailTimestamp(a);
      const timeB = this.resolveMailTimestamp(b);
      return timeB - timeA;
    });

    return docs;
  }

  /**
   * Fetches a single mail document by ID from /mail.
   */
  async getMailDoc(mailId: string): Promise<MailQueueDoc | null> {
    if (!mailId) return null;
    try {
      const docRef = doc(this.db, FirestoreCollection.Mail, mailId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      return {
        ...(snap.data() as MailQueueDoc),
        docId: snap.id,
      };
    } catch (e) {
      console.error('Error fetching mail doc', mailId, e);
      return null;
    }
  }

  private resolveMailTimestamp(doc: MailQueueDoc): number {
    if (doc.createdAt) {
      if (typeof (doc.createdAt as { toMillis?: () => number }).toMillis === 'function') {
        return (doc.createdAt as { toMillis: () => number }).toMillis();
      }
      if (typeof doc.createdAt === 'string') {
        return new Date(doc.createdAt).getTime();
      }
    }
    if (doc.delivery?.startTime) {
      if (typeof (doc.delivery.startTime as { toMillis?: () => number }).toMillis === 'function') {
        return (doc.delivery.startTime as { toMillis: () => number }).toMillis();
      }
      if (typeof doc.delivery.startTime === 'string') {
        return new Date(doc.delivery.startTime).getTime();
      }
    }
    const sentAt = doc.metadata?.['sentAt'];
    if (typeof sentAt === 'string') {
      return new Date(sentAt).getTime();
    }
    return 0;
  }

  /**
   * Admin-only callable to safely reset an email document to PENDING for retry.
   */
  async retryMailItem(mailId: string): Promise<{ success: boolean; docId: string; error?: string }> {
    const fn = httpsCallable<{ mailId: string }, { success: boolean; docId: string; error?: string }>(
      this.functions,
      'retryMailItem',
    );
    const res = await fn({ mailId });
    return res.data;
  }

  /**
   * Admin-only callable to set outbound mail sending state ('active' | 'paused' | 'off').
   * Supports fine-grained targeting per templateKey or 'all' for system-wide status.
   * When transitioning to 'active', transitions matching documents in /mail with status: 'PAUSED' to 'PENDING'.
   */
  async setMailSendingState(
    status: MailSendingStatus,
    templateKey?: TransactionalEmailKey | 'all',
  ): Promise<{ success: boolean; status: MailSendingStatus; resumedCount: number; templateKey?: string }> {
    const fn = httpsCallable<
      { status: MailSendingStatus; templateKey?: TransactionalEmailKey | 'all' },
      { success: boolean; status: MailSendingStatus; resumedCount: number; templateKey?: string }
    >(this.functions, 'setMailSendingState');
    const res = await fn({ status, templateKey });
    return res.data;
  }

  /**
   * Admin-only callable to toggle pause on global outbound mail sending.
   * When unpausing, transitions all documents in /mail with status: 'PAUSED' to 'PENDING'.
   */
  async setMailSendingPaused(
    paused: boolean,
  ): Promise<{ success: boolean; paused: boolean; resumedCount: number }> {
    const fn = httpsCallable<
      { paused: boolean },
      { success: boolean; paused: boolean; resumedCount: number }
    >(this.functions, 'setMailSendingPaused');
    const res = await fn({ paused });
    return res.data;
  }

  /**
   * Admin-only callable to delete multiple mail items from the queue in batch.
   */
  async deleteMailItems(mailIds: string[]): Promise<DeleteMailItemsResponse> {
    const fn = httpsCallable<DeleteMailItemsRequest, DeleteMailItemsResponse>(
      this.functions,
      'deleteMailItems',
    );
    const res = await fn({ mailIds });
    return res.data;
  }

  /**
   * Admin-only callable to update a queued mail item (recipient, subject, text, templateData, status).
   */
  async updateMailItem(request: UpdateMailItemRequest): Promise<UpdateMailItemResponse> {
    const fn = httpsCallable<UpdateMailItemRequest, UpdateMailItemResponse>(
      this.functions,
      'updateMailItem',
    );
    const res = await fn(request);
    return res.data;
  }


  downloadSchoolsAsJsonL() {
    const schoolFields = Object.keys(initSchool()) as Array<keyof School>;
    const schools = this.schools.entries().map((s) => {
      const school: Partial<School> = {};
      for (const key of schoolFields) {
        (school as any)[key] = s[key];
      }
      return school;
    });
    const jsonl = schools.map((school) => JSON.stringify(school)).join('\n');
    this.downloadFile('schools.jsonl', jsonl, 'application/jsonl');
  }

  async scheduleAccountDeletion(memberDocId: string): Promise<{ success: boolean; scheduledDeletionDate: string }> {
    const fn = httpsCallable<{ memberDocId: string }, { success: boolean; scheduledDeletionDate: string }>(
      this.functions,
      'scheduleAccountDeletion',
    );
    const result = await fn({ memberDocId });
    return result.data;
  }

  async cancelAccountDeletion(memberDocId: string): Promise<{ success: boolean }> {
    const fn = httpsCallable<{ memberDocId: string }, { success: boolean }>(
      this.functions,
      'cancelAccountDeletion',
    );
    const result = await fn({ memberDocId });
    return result.data;
  }

  // --- Uploads & Materials Management ---------------------------------------

  /**
   * Fetches all uploaded materials for a specific member from their subcollection.
   */
  async getMemberUploads(memberDocId: string): Promise<UploadItem[]> {
    if (!memberDocId) return [];
    const colRef = collection(this.db, 'members', memberDocId, 'uploads');
    const q = query(colRef);
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => firestoreDocToUploadItem(d));
    // Sort newest first by date or createdAt
    items.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
    return items;
  }

  /**
   * Admin-only: fetches uploaded materials across all instructors via collection group.
   * Supports server-side filtering by startDate, endDate, date, eventDocId, or instructorId.
   */
  async getAllUploads(options?: {
    startDate?: string;
    endDate?: string;
    date?: string;
    eventDocId?: string;
    instructorId?: string;
    limitCount?: number;
  }): Promise<UploadItem[]> {
    const colGroup = collectionGroup(this.db, 'uploads');
    let q: Query = colGroup;

    if (options?.startDate || options?.endDate) {
      const startIso = options.startDate
        ? (options.startDate.length === 10 ? `${options.startDate}T00:00:00.000Z` : options.startDate)
        : '';
      const endIso = options.endDate
        ? (options.endDate.length === 10 ? `${options.endDate}T23:59:59.999Z` : options.endDate)
        : '';

      if (startIso && endIso) {
        q = query(
          colGroup,
          where('createdAt', '>=', startIso),
          where('createdAt', '<=', endIso),
          orderBy('createdAt', 'desc'),
        );
      } else if (startIso) {
        q = query(colGroup, where('createdAt', '>=', startIso), orderBy('createdAt', 'desc'));
      } else if (endIso) {
        q = query(colGroup, where('createdAt', '<=', endIso), orderBy('createdAt', 'desc'));
      }
    } else if (options?.date) {
      const dateStr = options.date.trim();
      const startIso = `${dateStr}T00:00:00.000Z`;
      const endIso = `${dateStr}T23:59:59.999Z`;
      q = query(
        colGroup,
        where('createdAt', '>=', startIso),
        where('createdAt', '<=', endIso),
        orderBy('createdAt', 'desc'),
      );
    } else if (options?.eventDocId) {
      q = query(colGroup, where('eventDocId', '==', options.eventDocId));
    } else if (options?.instructorId) {
      q = query(colGroup, where('instructorId', '==', options.instructorId));
    } else {
      q = query(colGroup, orderBy('createdAt', 'desc'));
    }

    if (options?.limitCount && options.limitCount > 0) {
      q = query(q, limit(options.limitCount));
    }

    const snap = await getDocs(q);
    const items = snap.docs.map((d) => firestoreDocToUploadItem(d));
    items.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
    return items;
  }

  /**
   * Fetches all uploaded materials linked to a specific event via collection group.
   */
  async getEventUploads(eventDocId: string): Promise<UploadItem[]> {
    if (!eventDocId) return [];
    const colGroup = collectionGroup(this.db, 'uploads');
    const q = query(colGroup, where('eventDocId', '==', eventDocId));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => firestoreDocToUploadItem(d));
    items.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
    return items;
  }

  /**
   * Creates a new UploadItem document in the member's /uploads subcollection.
   */
  async createUploadItem(upload: Omit<UploadItem, 'docId'>): Promise<string> {
    if (!upload.memberDocId) {
      throw new Error('Cannot create upload item without memberDocId.');
    }
    const colRef = collection(this.db, 'members', upload.memberDocId, 'uploads');
    const now = new Date().toISOString();
    const payload = {
      ...upload,
      createdAt: upload.createdAt || now,
      lastUpdated: now,
    };
    const docRef = await addDoc(colRef, payload);
    return docRef.id;
  }

  /**
   * Updates metadata for an existing UploadItem document.
   */
  async updateUploadMetadata(
    memberDocId: string,
    uploadDocId: string,
    patch: Partial<UploadItem>,
  ): Promise<void> {
    if (!memberDocId || !uploadDocId) {
      throw new Error('memberDocId and uploadDocId are required to update upload metadata.');
    }
    const docRef = doc(this.db, 'members', memberDocId, 'uploads', uploadDocId);
    const payload = {
      ...patch,
      lastUpdated: new Date().toISOString(),
    };
    await updateDoc(docRef, payload);
  }

  /**
   * Deletes an UploadItem metadata document and its corresponding files in Cloud Storage.
   */
  async deleteUploadItem(upload: UploadItem): Promise<void> {
    if (!upload.memberDocId || !upload.docId) {
      throw new Error('Cannot delete upload item without memberDocId and docId.');
    }

    // 1. Delete Firestore document
    const docRef = doc(this.db, 'members', upload.memberDocId, 'uploads', upload.docId);
    await deleteDoc(docRef);

    // 2. Delete storage files if paths are recorded
    const storage = getStorage(this.firebaseService.app);
    if (upload.storagePath) {
      try {
        await deleteObject(storageRef(storage, upload.storagePath));
      } catch (err) {
        console.warn(`Failed to delete original file at ${upload.storagePath}:`, err);
      }
    }
    if (upload.previewStoragePath) {
      try {
        await deleteObject(storageRef(storage, upload.previewStoragePath));
      } catch (err) {
        console.warn(`Failed to delete preview file at ${upload.previewStoragePath}:`, err);
      }
    }
  }

  private downloadFile(filename: string, content: string, mimeType: string) {

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.click();
    document.body.removeChild(link);
  }

  private videosUnsubscribe: (() => void) | null = null;

  /**
   * Syncs the /videos collection with local IndexedDB cache and Firestore delta queries.
   * If the current user is an admin, queries all videos (published and draft/processing) into 'admin_videos'.
   * Otherwise (public or non-admin member), queries only published videos into 'public_videos'.
   */
  async updateVideosSync(user: UserDetails | null, forceFullRefresh = false) {
    const isAdmin = Boolean(user?.isAdmin);
    const cacheKey = isAdmin ? 'admin_videos' : 'public_videos';
    const queryConstraints = isAdmin ? undefined : [where('isPublished', '==', true)];

    await this.videos.sync({
      cacheKey,
      queryConstraints,
      forceFullRefresh,
    });
    return this.videos;
  }

  /**
   * Look up a video by its docId.
   */
  async getVideoById(videoId: string): Promise<VideoItem | null> {
    return (await this.videos.getById(videoId)) ?? null;
  }

  /**
   * Save or update a VideoItem document in /videos.
   */
  async saveVideo(video: VideoItem): Promise<void> {
    const videoRef = doc(this.db, 'videos', video.docId);
    const payload = {
      ...video,
      lastUpdated: serverTimestamp(),
    };
    await setDoc(videoRef, payload, { merge: true });

    const updatedVideo: VideoItem = {
      ...video,
      lastUpdated: new Date().toISOString(),
    };
    this.videos.upsert(updatedVideo);
    await Promise.all([
      this.syncService.upsertCachedEntry('admin_videos', 'docId', updatedVideo),
      ...(updatedVideo.isPublished
        ? [this.syncService.upsertCachedEntry('public_videos', 'docId', updatedVideo)]
        : [this.syncService.deleteCachedEntry('public_videos', 'docId', updatedVideo.docId)]),
    ]);
  }

  /**
   * Deletes a video from the catalog via Cloud Function.
   */
  async deleteVideo(videoId: string): Promise<void> {
    const fn = httpsCallable<{ videoId: string }, { success: boolean }>(
      getFunctions(this.firebaseService.app),
      'deleteVideoFromCatalog',
    );
    await fn({ videoId });
    const videoRef = doc(this.db, 'videos', videoId);
    await deleteDoc(videoRef).catch(() => {});

    this.videos.delete(videoId);
    await Promise.all([
      this.syncService.deleteCachedEntry('admin_videos', 'docId', videoId),
      this.syncService.deleteCachedEntry('public_videos', 'docId', videoId),
    ]);
  }

  /**
   * Triggers transcoding of an instructor upload to VOD via Cloud Function.
   */
  async transcodeVideoForVod(
    uploadDocId: string,
    memberDocId: string,
    vodConfig: Partial<VideoItem>,
  ): Promise<{ success: boolean; videoId: string; vodStatus: VodStatus; jobId?: string }> {
    const fn = httpsCallable<
      { uploadDocId: string; memberDocId: string; vodConfig: Partial<VideoItem> },
      { success: boolean; videoId: string; vodStatus: VodStatus; jobId?: string }
    >(getFunctions(this.firebaseService.app), 'transcodeVideoForVod');
    const result = await fn({ uploadDocId, memberDocId, vodConfig });
    if (vodConfig.tags && vodConfig.tags.length > 0) {
      this.saveSystemTags(vodConfig.tags);
    }
    return result.data;
  }

  /**
   * Checks the live status of a VOD transcoding job via Cloud Function.
   */
  async checkVodJobStatus(
    videoId: string,
  ): Promise<{
    success: boolean;
    videoId: string;
    vodStatus: VodStatus;
    vodJobId?: string;
    vodError?: string;
  }> {
    const fn = httpsCallable<
      { videoId: string },
      {
        success: boolean;
        videoId: string;
        vodStatus: VodStatus;
        vodJobId?: string;
        vodError?: string;
      }
    >(getFunctions(this.firebaseService.app), 'checkVodJobStatus');
    const result = await fn({ videoId });
    return result.data;
  }

  /**
   * Grants access to a video or entire series to a member or email address via Cloud Function.
   */
  async grantVideoAccess(req: {
    targetType: 'video' | 'series';
    targetId: string;
    recipientEmail: string;
    recipientMemberDocId?: string;
    recipientName?: string;
    grantKind?: VideoGrantKind;
    notes?: string;
    expiresAt?: string;
    sendNotification?: boolean;
  }): Promise<{
    success: boolean;
    grantedCount: number;
    recipientEmail: string;
    recipientMemberDocId?: string;
  }> {
    const fn = httpsCallable<
      {
        targetType: 'video' | 'series';
        targetId: string;
        recipientEmail: string;
        recipientMemberDocId?: string;
        recipientName?: string;
        grantKind?: VideoGrantKind;
        notes?: string;
        expiresAt?: string;
        sendNotification?: boolean;
      },
      {
        success: boolean;
        grantedCount: number;
        recipientEmail: string;
        recipientMemberDocId?: string;
      }
    >(getFunctions(this.firebaseService.app), 'grantVideoAccess');

    const result = await fn(req);
    return result.data;
  }

  /**
   * Updates metadata for an existing VideoItem (title, description, tags, tier, price, isPublished).
   */
  async updateVideoMetadata(
    videoId: string,
    patch: Partial<VideoItem>,
  ): Promise<void> {
    const videoRef = doc(this.db, 'videos', videoId);
    await updateDoc(videoRef, {
      ...patch,
      lastUpdated: serverTimestamp(),
    });
    if (patch.tags && patch.tags.length > 0) {
      this.saveSystemTags(patch.tags);
    }
    const existing = this.videos.get(videoId);
    if (existing) {
      const updated: VideoItem = {
        ...existing,
        ...patch,
        lastUpdated: new Date().toISOString(),
      };
      this.videos.upsert(updated);
      await Promise.all([
        this.syncService.upsertCachedEntry('admin_videos', 'docId', updated),
        ...(updated.isPublished
          ? [this.syncService.upsertCachedEntry('public_videos', 'docId', updated)]
          : [this.syncService.deleteCachedEntry('public_videos', 'docId', updated.docId)]),
      ]);
    }
  }

  /**
   * Extracts and groups all VideoSeries from the active video catalog.
   */
  getVideoSeriesList(): VideoSeries[] {
    const { seriesList } = groupVideosIntoSeries(this.videos.entries());
    return seriesList.sort((a, b) => (b.recordedDate || '').localeCompare(a.recordedDate || '') || a.title.localeCompare(b.title));
  }

  /**
   * Updates metadata for an entire VideoSeries across all constituent videos in Firestore.
   */
  async updateVideoSeries(
    seriesId: string,
    patch: Partial<VideoSeries>,
    orderedVideoIds?: string[],
  ): Promise<void> {
    const allVideos = this.videos.entries();
    const targetVideos = allVideos.filter(
      (v) =>
        v.seriesId === seriesId ||
        v.forVodPageId === seriesId ||
        (orderedVideoIds && orderedVideoIds.includes(v.docId)),
    );

    if (targetVideos.length === 0 && (!orderedVideoIds || orderedVideoIds.length === 0)) return;

    const batch = writeBatch(this.db);
    const nowIso = new Date().toISOString();

    const videoIdsToProcess = orderedVideoIds && orderedVideoIds.length > 0
      ? orderedVideoIds
      : targetVideos.map((v) => v.docId);

    const updatedVideosList: VideoItem[] = [];

    for (let i = 0; i < videoIdsToProcess.length; i++) {
      const vId = videoIdsToProcess[i];
      const videoRef = doc(this.db, 'videos', vId);
      const updates: Record<string, any> = {
        lastUpdated: serverTimestamp(),
      };

      if (patch.title !== undefined) {
        updates['seriesTitle'] = patch.title;
        updates['forVodSeriesTitle'] = patch.title;
      }
      if (patch.description !== undefined) updates['seriesDescription'] = patch.description;
      if (patch.priceCents !== undefined) {
        updates['seriesPriceCents'] = patch.priceCents;
        updates['priceCents'] = patch.priceCents;
        updates['isBuyable'] = patch.priceCents > 0;
      }
      if (patch.currency !== undefined) updates['currency'] = patch.currency;
      if (patch.stripePriceId !== undefined) updates['seriesStripePriceId'] = patch.stripePriceId;
      if (patch.stripeProductId !== undefined) updates['seriesStripeProductId'] = patch.stripeProductId;
      if (patch.accessTier !== undefined) updates['accessTier'] = patch.accessTier;
      if (patch.accessTiers !== undefined) updates['accessTiers'] = patch.accessTiers;
      if (patch.isPublished !== undefined) updates['isPublished'] = patch.isPublished;
      if (patch.featured !== undefined) updates['featured'] = patch.featured;
      if (patch.tags !== undefined) updates['tags'] = patch.tags;

      // Assign sequence part index
      updates['seriesId'] = seriesId;
      updates['seriesPartIndex'] = i + 1;

      batch.update(videoRef, updates);

      const existing = this.videos.get(vId);
      if (existing) {
        const updated: VideoItem = {
          ...existing,
          ...(patch.title !== undefined ? { seriesTitle: patch.title, forVodSeriesTitle: patch.title } : {}),
          ...(patch.description !== undefined ? { seriesDescription: patch.description } : {}),
          ...(patch.priceCents !== undefined ? {
            seriesPriceCents: patch.priceCents,
            priceCents: patch.priceCents,
            isBuyable: patch.priceCents > 0,
          } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.stripePriceId !== undefined ? { seriesStripePriceId: patch.stripePriceId } : {}),
          ...(patch.stripeProductId !== undefined ? { seriesStripeProductId: patch.stripeProductId } : {}),
          ...(patch.accessTier !== undefined ? { accessTier: patch.accessTier } : {}),
          ...(patch.accessTiers !== undefined ? { accessTiers: patch.accessTiers } : {}),
          ...(patch.isPublished !== undefined ? { isPublished: patch.isPublished } : {}),
          ...(patch.featured !== undefined ? { featured: patch.featured } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          seriesId,
          seriesPartIndex: i + 1,
          lastUpdated: nowIso,
        };
        updatedVideosList.push(updated);
      }
    }

    await batch.commit();

    if (updatedVideosList.length > 0) {
      this.videos.upsertMany(updatedVideosList);
      await Promise.all(
        updatedVideosList.flatMap((updated) => [
          this.syncService.upsertCachedEntry('admin_videos', 'docId', updated),
          ...(updated.isPublished
            ? [this.syncService.upsertCachedEntry('public_videos', 'docId', updated)]
            : [this.syncService.deleteCachedEntry('public_videos', 'docId', updated.docId)]),
        ]),
      );
    }

    if (patch.tags && patch.tags.length > 0) {
      this.saveSystemTags(patch.tags);
    }
  }

  /**
   * Adds specified video IDs into a series with incremental part indices.
   */
  async addVideosToSeries(
    seriesId: string,
    videoIds: string[],
    seriesData?: Partial<VideoSeries>,
  ): Promise<void> {
    if (!seriesId || videoIds.length === 0) return;
    const existingSeries = this.getVideoSeriesList().find((s) => s.seriesId === seriesId);
    const startIndex = existingSeries ? existingSeries.videos.length : 0;

    const batch = writeBatch(this.db);
    const updatedVideosList: VideoItem[] = [];
    const nowIso = new Date().toISOString();

    for (let i = 0; i < videoIds.length; i++) {
      const vId = videoIds[i];
      const videoRef = doc(this.db, 'videos', vId);
      const updates: Record<string, any> = {
        seriesId,
        seriesPartIndex: startIndex + i + 1,
        lastUpdated: serverTimestamp(),
      };

      if (seriesData?.title || existingSeries?.title) {
        const t = seriesData?.title || existingSeries?.title;
        updates['seriesTitle'] = t;
        updates['forVodSeriesTitle'] = t;
      }
      if (seriesData?.description || existingSeries?.description) {
        updates['seriesDescription'] = seriesData?.description || existingSeries?.description;
      }
      if (seriesData?.priceCents !== undefined || existingSeries?.priceCents !== undefined) {
        const p = seriesData?.priceCents !== undefined ? seriesData.priceCents : existingSeries?.priceCents;
        updates['seriesPriceCents'] = p;
        updates['priceCents'] = p;
        updates['isBuyable'] = (p || 0) > 0;
      }

      batch.update(videoRef, updates);

      const existing = this.videos.get(vId);
      if (existing) {
        const updated: VideoItem = {
          ...existing,
          seriesId,
          seriesPartIndex: startIndex + i + 1,
          ...(seriesData?.title || existingSeries?.title ? { seriesTitle: seriesData?.title || existingSeries?.title, forVodSeriesTitle: seriesData?.title || existingSeries?.title } : {}),
          ...(seriesData?.description || existingSeries?.description ? { seriesDescription: seriesData?.description || existingSeries?.description } : {}),
          ...(seriesData?.priceCents !== undefined || existingSeries?.priceCents !== undefined ? {
            seriesPriceCents: seriesData?.priceCents !== undefined ? seriesData.priceCents : existingSeries?.priceCents,
            priceCents: seriesData?.priceCents !== undefined ? seriesData.priceCents : existingSeries?.priceCents,
            isBuyable: ((seriesData?.priceCents !== undefined ? seriesData.priceCents : existingSeries?.priceCents) || 0) > 0,
          } : {}),
          lastUpdated: nowIso,
        };
        updatedVideosList.push(updated);
      }
    }

    await batch.commit();

    if (updatedVideosList.length > 0) {
      this.videos.upsertMany(updatedVideosList);
      await Promise.all(
        updatedVideosList.flatMap((updated) => [
          this.syncService.upsertCachedEntry('admin_videos', 'docId', updated),
          ...(updated.isPublished
            ? [this.syncService.upsertCachedEntry('public_videos', 'docId', updated)]
            : [this.syncService.deleteCachedEntry('public_videos', 'docId', updated.docId)]),
        ]),
      );
    }
  }

  /**
   * Renames a video tag in /system/video-tags and updates all videos referencing oldTag.
   */
  async renameVideoTag(
    oldTag: string,
    newTag: string,
    metaPatch?: Partial<VideoTagMeta>,
  ): Promise<{ updatedVideos: number }> {
    const cleanOld = oldTag.trim().toLowerCase();
    const cleanNew = newTag.trim().toLowerCase();
    if (!cleanOld || !cleanNew) return { updatedVideos: 0 };

    const currentDoc = { ...this.tagsDoc() };
    const oldMeta = currentDoc[cleanOld] || initVideoTagMeta(cleanOld, '', cleanOld);
    delete currentDoc[cleanOld];

    const updatedMeta: VideoTagMeta = {
      ...oldMeta,
      ...metaPatch,
      tag: cleanNew,
      label: metaPatch?.label || (oldMeta.label === cleanOld ? cleanNew : oldMeta.label),
      lastUpdated: new Date().toISOString(),
    };
    currentDoc[cleanNew] = updatedMeta;

    const tagsRef = doc(this.db, 'system', 'video-tags');
    await setDoc(tagsRef, { tags: currentDoc, lastUpdated: new Date().toISOString() });

    // Update in-memory tagsDoc signal immediately
    this.tagsDoc.set(currentDoc);

    // Update all videos in Firestore that reference cleanOld
    let updatedVideos = 0;
    const affectedVideos = this.videos
      .entries()
      .filter((v) => v.tags && v.tags.includes(cleanOld));

    const updatedVideosList: VideoItem[] = [];
    const nowIso = new Date().toISOString();

    for (const v of affectedVideos) {
      const updatedTags = Array.from(new Set(v.tags.map((t) => (t === cleanOld ? cleanNew : t))));
      const videoRef = doc(this.db, 'videos', v.docId);
      await updateDoc(videoRef, {
        tags: updatedTags,
        lastUpdated: serverTimestamp(),
      }).catch((err) => {
        console.warn(`Failed to update tags on video ${v.docId}:`, err);
      });
      const updated: VideoItem = {
        ...v,
        tags: updatedTags,
        lastUpdated: nowIso,
      };
      updatedVideosList.push(updated);
      updatedVideos++;
    }

    if (updatedVideosList.length > 0) {
      this.videos.upsertMany(updatedVideosList);
      await Promise.all(
        updatedVideosList.flatMap((updated) => [
          this.syncService.upsertCachedEntry('admin_videos', 'docId', updated),
          ...(updated.isPublished
            ? [this.syncService.upsertCachedEntry('public_videos', 'docId', updated)]
            : [this.syncService.deleteCachedEntry('public_videos', 'docId', updated.docId)]),
        ]),
      );
    }

    return { updatedVideos };
  }

  /**
   * Deletes a video tag from /system/video-tags.
   */
  async deleteVideoTag(tag: string): Promise<void> {
    const clean = tag.trim().toLowerCase();
    if (!clean) return;

    const currentDoc = { ...this.tagsDoc() };
    delete currentDoc[clean];

    const tagsRef = doc(this.db, 'system', 'video-tags');
    await setDoc(tagsRef, { tags: currentDoc, lastUpdated: new Date().toISOString() });
    this.tagsDoc.set(currentDoc);
  }

  /**
   * Requests a secure streaming playback session.
   */
  async getVideoPlaybackSession(videoId: string): Promise<{
    authorized: boolean;
    manifestUrl?: string;
    title?: string;
    durationSeconds?: number;
    reason?: 'unauthenticated' | 'subscription_required' | 'instructor_required' | 'class_sub_required' | 'purchase_required';
    priceCents?: number;
    stripePriceId?: string;
    trailerVideoId?: string;
    trailerManifestUrl?: string;
  }> {
    const fn = httpsCallable<{ videoId: string }, {
      authorized: boolean;
      manifestUrl?: string;
      title?: string;
      durationSeconds?: number;
      reason?: 'unauthenticated' | 'subscription_required' | 'instructor_required' | 'class_sub_required' | 'purchase_required';
      priceCents?: number;
      stripePriceId?: string;
      trailerVideoId?: string;
      trailerManifestUrl?: string;
    }>(getFunctions(this.firebaseService.app), 'getVideoPlaybackSession');
    const result = await fn({ videoId });
    return result.data;
  }

  /**
   * Saves member video watch progress.
   */
  async saveVideoProgress(
    videoId: string,
    lastPositionSeconds: number,
    durationSeconds: number,
    completed = false,
  ): Promise<void> {
    const user = this.firebaseService.user();
    if (!user?.member?.docId) return;

    const progressRef = doc(
      this.db,
      'members',
      user.member.docId,
      'videoProgress',
      videoId,
    );
    const payload: VideoProgress = {
      docId: videoId,
      videoId,
      memberDocId: user.member.docId,
      lastPositionSeconds,
      durationSeconds,
      completed,
      lastWatchedAt: new Date().toISOString(),
      ...(completed ? { completedAt: new Date().toISOString() } : {}),
    };
    await setDoc(progressRef, payload, { merge: true });
  }

  /**
   * Retrieves playback progress for a specific video.
   */
  async getVideoProgress(videoId: string): Promise<VideoProgress | null> {
    const user = this.firebaseService.user();
    if (!user?.member?.docId) return null;

    const progressRef = doc(
      this.db,
      'members',
      user.member.docId,
      'videoProgress',
      videoId,
    );
    const snap = await getDoc(progressRef);
    if (!snap.exists()) return null;
    return firestoreDocToVideoProgress(snap);
  }

  /**
   * Retrieves list of recently watched videos for the member.
   */
  async getMyVideoProgressList(): Promise<VideoProgress[]> {
    const user = this.firebaseService.user();
    if (!user?.member?.docId) return [];

    const colRef = collection(this.db, 'members', user.member.docId, 'videoProgress');
    const q = query(colRef, orderBy('lastWatchedAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    return snap.docs.map(firestoreDocToVideoProgress);
  }

  /**
   * Retrieves all individual video grants purchased or assigned to the member.
   */
  async getMyVideoGrants(): Promise<VideoGrant[]> {
    const user = this.firebaseService.user();
    if (!user?.member?.docId) return [];

    const grantsRef = collection(this.db, 'members', user.member.docId, 'videoGrants');
    const snap = await getDocs(grantsRef);
    return snap.docs.map(firestoreDocToVideoGrant);
  }

  /**
   * Retrieves all individual video grants purchased or assigned to an arbitrary member (admin only).
   */
  async getMemberVideoGrants(memberDocId: string): Promise<VideoGrant[]> {
    if (!memberDocId) return [];
    const grantsRef = collection(this.db, 'members', memberDocId, 'videoGrants');
    const snap = await getDocs(grantsRef);
    return snap.docs.map(firestoreDocToVideoGrant);
  }

  /**
   * Retrieves personal time ranges / annotations for a specific video.
   * Checks Firestore for authenticated members and falls back / merges with localStorage.
   */
  async getVideoTimeRanges(videoId: string): Promise<VideoTimeRange[]> {
    const user = this.firebaseService.user();
    if (user?.member?.docId) {
      try {
        const timeRangesRef = doc(
          this.db,
          'members',
          user.member.docId,
          'videoTimeRanges',
          videoId,
        );
        const snap = await getDoc(timeRangesRef);
        if (snap.exists()) {
          const docData = firestoreDocToMemberVideoTimeRanges(snap);
          // Sync to localStorage for offline cache
          if (typeof window !== 'undefined' && window.localStorage) {
            try {
              localStorage.setItem(
                `ilc_time_ranges_${videoId}`,
                JSON.stringify(docData.ranges),
              );
            } catch {
              // Ignore localStorage write quota errors
            }
          }
          return docData.ranges;
        }
      } catch (err) {
        console.warn('Could not load video time ranges from Firestore, falling back to local storage:', err);
      }
    }

    // Fallback to localStorage (for unauthenticated users or offline mode)
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const local = localStorage.getItem(`ilc_time_ranges_${videoId}`);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    return [];
  }

  /**
   * Saves personal time ranges / annotations for a specific video.
   * Persists to local storage first, then syncs to Firestore if the user is authenticated.
   */
  async saveVideoTimeRanges(videoId: string, ranges: VideoTimeRange[]): Promise<void> {
    // 1. Local-first storage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(`ilc_time_ranges_${videoId}`, JSON.stringify(ranges));
      } catch (err) {
        console.warn('Could not write time ranges to localStorage:', err);
      }
    }

    // 2. Cloud sync if member is authenticated
    const user = this.firebaseService.user();
    if (!user?.member?.docId) return;

    const timeRangesRef = doc(
      this.db,
      'members',
      user.member.docId,
      'videoTimeRanges',
      videoId,
    );
    const payload: MemberVideoTimeRangesFsDoc = {
      videoId,
      memberDocId: user.member.docId,
      ranges,
      lastUpdated: new Date().toISOString(),
    };
    await setDoc(timeRangesRef, payload, { merge: true });
  }

  async clearAllLocalCaches(): Promise<void> {
    await this.syncService.clearAllCaches();
  }

  async forceRefreshAllData(user: UserDetails): Promise<void> {
    const promises: Promise<unknown>[] = [
      this.updateMembersSync(user, true),
      this.updateSchoolsSync(true),
      this.updateEventsSync(true),
      this.updateProductsSync(true),
      this.updateVideosSync(user, true),
      this.updateMyStudentsSync(user, true),
      this.findInstructorsService.updateInstructorsSync(true),
    ];
    if (user.isAdmin) {
      promises.push(this.updateOrdersSync(true));
    }
    await Promise.all(promises);
  }
}
