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
import {
  Member,
  initMember,
  School,
  initSchool,
  InstructorPublicData,
  initInstructor,
  Counters,
  MemberFsDoc,
  SchoolFsDoc,
  firestoreDocToMember,
  firestoreDocToSchool,
  firestoreDocToInstructorPublicData,
  Order,
  firestoreDocToOrder,
  OrderFsDoc,
  Grading,
  GradingFsDoc,
  firestoreDocToGrading,
  SquareSpaceOrder,
  SquareSpaceLineItem,
  IlcEvent,
  EventStatus,
  initEvent,
  ResourceAccessLevel,
  EmailTemplates,
  initEmailTemplates,
  UploadItem,
  firestoreDocToUploadItem,
  initUploadItem,
  MemberOrder,
  firestoreDocToMemberOrder,
  OrderKind,
  VideoItem,
  firestoreDocToVideoItem,
  initVideoItem,
  VideoGrant,
  firestoreDocToVideoGrant,
  VideoProgress,
  firestoreDocToVideoProgress,
  VodStatus,
  VodAccessTier,
  VideoGrantKind,
  SystemTagsDoc,
  SystemVideoTagsDoc,
  VideoTagMeta,
  initVideoTagMeta,
  TagItem,
} from '../../functions/src/data-model';
import { getStorage, ref as storageRef, deleteObject } from 'firebase/storage';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import { countryCodeList, CountryCode, CountryCodesDoc } from './country-codes';
import * as Papa from 'papaparse';
import { SearchableSet } from './searchable-set';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deepObjEq } from './utils';
import { FindInstructorsService } from './find-instructors.service';
import { IncrementalSyncService } from './incremental-sync.service';

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

export function sortOrdersByDateDesc(orders: Order[]): Order[] {
  return orders.sort((a, b) => {
    return (orderSortDate(b) || '').localeCompare(orderSortDate(a) || '');
  });
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
  public members = new SearchableSet<'docId', Member>(
    [
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
    'docId',
  );
  // Delegate to FindInstructorsService for a single, shared instructor cache
  // that works both in the authenticated main app and the standalone WC.
  public get instructors() {
    return this.findInstructorsService.instructors;
  }
  public myStudents = new SearchableSet<'docId', Member>(
    [
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
    'docId',
  );
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
  public schools = new SearchableSet<'schoolId', School>(
    [
      'schoolName',
      'schoolId',
      'schoolCity',
      'schoolCountyOrState',
      'schoolCountry',
    ],
    'schoolId',
  );
  public orders = new SearchableSet<'docId', Order>(
    ['referenceNumber', 'lastName', 'firstName', 'email', 'externalId', 'orderNumber', 'customerEmail'],
    'docId',
  );
  public counters = signal<Counters | null>(null);
  public emailTemplates = signal<EmailTemplates | null>(null);
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
  public videos = new SearchableSet<'docId', VideoItem>(
    ['title', 'description', 'instructorName', 'tags', 'location', 'eventTitle'],
    'docId',
  );

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
        map.set(m.memberId, m.docId);
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
    const docId = this.memberIdToDocIdMap().get(memberId);
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
        map.set(m.memberId, m.docId);
      }
    }
    return map;
  });

  // Look up one of the logged-in instructor's students by either memberId or docId.
  getMyStudent(idOrDocId: string): Member | undefined {
    const byDocId = this.myStudents.get(idOrDocId);
    if (byDocId) return byDocId;
    const docId = this.myStudentIdToDocIdMap().get(idOrDocId);
    if (!docId) return undefined;
    return this.myStudents.get(docId);
  }

  constructor() {
    // 1. Immediately load public schools from IndexedDB cache and sync in background
    this.syncService.loadCachedData('schools', this.schools, (a, b) =>
      (b.schoolId || '').localeCompare(a.schoolId || ''),
    );
    this.updateSchoolsSync();

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
      } else {
        this.members.setEntries([]);
        this.myStudents.setEntries([]);
        this.myGradingsAssessed.setEntries([]);
      }
    });

    // System listeners reactive to auth status (counters, email-templates, videos)
    effect(() => {
      const user = this.firebaseService.user();
      this.updateCountersSync(user);
      this.updateEmailTemplatesSync(user);
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
  }

  private myOrdersUnsubscribe: (() => void) | null = null;

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
    if (this.videosUnsubscribe) {
      this.videosUnsubscribe();
      this.videosUnsubscribe = null;
    }
  }

  async updateMembersSync(user: UserDetails, forceFullRefresh = false) {
    if (user.isAdmin) {
      const cacheKey = `members_admin_${user.firebaseUser?.uid || 'admin'}`;
      this.syncService.loadCachedData(cacheKey, this.members, (a, b) =>
        (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
      );
      await this.syncService.syncCollection({
        cacheKey,
        collectionPath: 'members',
        idField: 'docId',
        targetSet: this.members,
        docConverter: firestoreDocToMember,
        sortFn: (a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
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
    this.syncService.loadCachedData('schools', this.schools, (a, b) =>
      (b.schoolId || '').localeCompare(a.schoolId || ''),
    );
    await this.syncService.syncCollection({
      cacheKey: 'schools',
      collectionPath: 'schools',
      idField: 'schoolId',
      targetSet: this.schools,
      docConverter: firestoreDocToSchool,
      sortFn: (a, b) => (b.schoolId || '').localeCompare(a.schoolId || ''),
      forceFullRefresh,
    });
  }

  // Instructor data is now managed by FindInstructorsService.

  async updateOrdersSync() {
    try {
      const q = query(this.ordersCollection, orderBy('lastUpdated', 'desc'));
      const snapshot = await getDocs(q);
      const orders = sortOrdersByDateDesc(snapshot.docs.map(firestoreDocToOrder));
      this.orders.setEntries(orders);
      return this.orders;
    } catch (error: any) {
      this.orders.setError(error.message);
      throw error;
    }
  }

  async getRecentOrders(limitCount: number = 1000, status?: string, kindFilter?: string): Promise<Order[]> {
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
          const order = firestoreDocToOrder(docSnap as any);
          results.set(order.docId, order);
        });
        snapE.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as any);
          results.set(order.docId, order);
        });
      } else if (field === 'memberDocId' || field === 'ilcAppMemberDocId') {
        const q = query(this.ordersCollection, where('ilcAppMemberDocId', '==', term));
        const snap = await getDocs(q);
        snap.docs.forEach((docSnap) => {
          const order = firestoreDocToOrder(docSnap as any);
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
          const order = firestoreDocToOrder(docSnap as any);
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

        snapS.docs.forEach((docSnap) => results.push(firestoreDocToOrder(docSnap as any)));
        snapH.docs.forEach((docSnap) => results.push(firestoreDocToOrder(docSnap as any)));

        return sortOrdersByDateDesc(results);
      } catch (error) {
        console.error('Error searching orders by date bounds:', error);
        return [];
      }
    }

    return [];
  }

  async getRecentEvents(limitCount: number = 100, status?: string): Promise<IlcEvent[]> {
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

  async searchEvents(criteria: EventSearchCriteria): Promise<IlcEvent[]> {
    const status = criteria.statusFilter;

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

    // Try direct doc lookup
    const directDoc = await getDoc(doc(this.db, 'orders', idOrRef));
    if (directDoc.exists()) {
      return firestoreDocToOrder(directDoc as any);
    }

    // Try query by id (Squarespace ID) or orderNumber or referenceNumber
    const q1 = query(this.ordersCollection, where('id', '==', idOrRef), limit(1));
    const q2 = query(this.ordersCollection, where('orderNumber', '==', idOrRef), limit(1));
    const q3 = query(this.ordersCollection, where('referenceNumber', '==', idOrRef), limit(1));

    for (const q of [q1, q2, q3]) {
      const snap = await getDocs(q);
      if (!snap.empty) {
        return firestoreDocToOrder(snap.docs[0] as any);
      }
    }

    return undefined;
  }

  async getEventById(id: string): Promise<IlcEvent | undefined> {
    if (!id) return undefined;
    try {
      const docRef = doc(this.db, 'events', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { ...initEvent(), ...docSnap.data(), docId: docSnap.id } as IlcEvent;
      }

      const q = query(
        this.eventsCollection,
        where('sourceId', '==', id)
      );
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
        const d = querySnap.docs[0];
        return { ...initEvent(), ...d.data(), docId: d.id } as IlcEvent;
      }
      return undefined;
    } catch (error) {
      console.error('Error getting event by ID:', error);
      return undefined;
    }
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
    // Note: We check if they have a numeric instructorId, as that indicates they are an instructor.
    if (user.member.instructorId && user.member.docId) {
      const cacheKey = `my_students_${user.member.docId}`;
      this.syncService.loadCachedData(cacheKey, this.myStudents, (a, b) =>
        (a.name || '').localeCompare(b.name || ''),
      );
      await this.syncService.syncCollection({
        cacheKey,
        collectionPath: `instructors/${user.member.docId}/members`,
        idField: 'docId',
        targetSet: this.myStudents,
        docConverter: firestoreDocToMember,
        sortFn: (a, b) => (a.name || '').localeCompare(b.name || ''),
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
          // Try to init the doc for the whole system, but gracefully ignore if permission denied
          setDoc(countryCodesRef, countryCodes).catch((e) => {
            console.warn('Could not initialize country-codes document (possibly not admin).', e);
          });
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
    if (this.myStudents.get(member.docId)) {
      this.myStudents.upsert(member);
    }
    const user = this.firebaseService.user();
    if (user?.isAdmin) {
      const adminCacheKey = `members_admin_${user.firebaseUser?.uid || 'admin'}`;
      await this.syncService.upsertCachedEntry(adminCacheKey, 'docId', member);
    }
    if (member.primarySchoolId) {
      const schoolCacheKey = `school_members_${member.primarySchoolId}`;
      await this.syncService.upsertCachedEntry(schoolCacheKey, 'docId', member);
    }
    if (user?.member?.docId) {
      const instructorCacheKey = `my_students_${user.member.docId}`;
      await this.syncService.upsertCachedEntry(instructorCacheKey, 'docId', member);
    }
  }

  private async removeMemberLocally(memberDocId: string, primarySchoolId?: string): Promise<void> {
    this.members.delete(memberDocId);
    this.myStudents.delete(memberDocId);
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

  private async persistSchoolLocally(school: School): Promise<void> {
    this.schools.upsert(school);
    if (this.mySchools.get(school.schoolId)) {
      this.mySchools.upsert(school);
    }
    await this.syncService.upsertCachedEntry('schools', 'schoolId', school);
  }

  private async removeSchoolLocally(schoolId: string): Promise<void> {
    this.schools.delete(schoolId);
    this.mySchools.delete(schoolId);
    await this.syncService.deleteCachedEntry('schools', 'schoolId', schoolId);
  }

  async addMember(member: Member): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'members');
    const newDocRef = doc(collectionRef);
    const memberWithNewTimestamp: MemberFsDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(newDocRef, memberWithNewTimestamp);
    const addedMember: Member = {
      ...member,
      docId: newDocRef.id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistMemberLocally(addedMember);
    return newDocRef;
  }

  async updateMember(id: string, newMember: Member, oldMember?: Member): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    let originalMember = oldMember;
    if (!originalMember) {
      originalMember = this.members.get(newMember.docId);
    }

    // If the member is found in the current list of members, only update the 
    // fields that have changed. This is more efficient than updating the entire
    // member document, and also it is necessary to stop small oddnesses in 
    // the firestore database content (e.g. old field names, etc.) from breaking 
    // member updates to themselves. By only asking to update fields that changed, 
    // we avoid firestore rules from rejecting the update due to the presence of 
    // fields that are not allowed.
    if (originalMember) {
      const changes: Partial<MemberFsDoc> = {};
      for (const key of Object.keys(newMember) as Array<keyof Member>) {
        if (key === 'docId' || key === 'lastUpdated') continue;
        if (!deepObjEq(newMember[key], originalMember[key])) {
          // @ts-ignore
          changes[key] = newMember[key];
        }
      }
      changes.lastUpdated = serverTimestamp() as Timestamp;
      await setDoc(docRef, changes, { merge: true });
    } else {
      // Fallback if no old member is found
      const memberWithNewTimestamp: MemberFsDoc = {
        ...newMember,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      delete (memberWithNewTimestamp as { docId?: string }).docId;
      await setDoc(docRef, memberWithNewTimestamp, { merge: true });
    }

    // Optimistically update in-memory SearchableSet and IndexedDB cache immediately!
    const updatedMember: Member = {
      ...newMember,
      docId: id,
      lastUpdated: new Date().toISOString(),
    };
    await this.persistMemberLocally(updatedMember);
  }

  async updateMemberAndStudentInstructorIds(id: string, member: Member, oldInstructorId: string): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    const memberWithNewTimestamp: MemberFsDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };

    const qOld = query(this.membersCollection, where('primaryInstructorId', '==', oldInstructorId));
    const snapOld = await getDocs(qOld);

    const qNew = query(this.membersCollection, where('primaryInstructorId', '==', member.instructorId));
    const snapNew = await getDocs(qNew);

    const batch = writeBatch(this.db);
    batch.set(docRef, memberWithNewTimestamp, { merge: true });

    snapOld.docs.forEach((d) => {
      batch.update(d.ref, { primaryInstructorId: member.instructorId, lastUpdated: serverTimestamp() });
    });

    snapNew.docs.forEach((d) => {
      const subDocRef = doc(this.db, 'instructors', id, 'members', d.id);
      batch.set(subDocRef, { ...d.data(), primaryInstructorId: member.instructorId, lastUpdated: serverTimestamp() }, { merge: true });
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

    // When we have the original school, only send changed fields.
    // This is necessary for school managers who are restricted by
    // firestore rules to only update specific fields via affectedKeys().hasOnly(...).
    if (oldSchool) {
      const changes: Partial<SchoolFsDoc> = {};
      for (const key of Object.keys(school) as Array<keyof School>) {
        if (key === 'docId' || key === 'lastUpdated') continue;
        if (!deepObjEq(school[key], oldSchool[key])) {
          // @ts-ignore
          changes[key] = school[key];
        }
      }
      changes.lastUpdated = serverTimestamp() as Timestamp;
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

    // Only send changed fields. This is critical for non-admin users (e.g.
    // instructors) whose Firestore rules restrict updates to a subset of
    // fields. Sending unchanged fields would cause rule violations.
    if (originalGrading) {
      const changes: Partial<GradingFsDoc> = {};
      for (const key of Object.keys(newGrading) as Array<keyof Grading>) {
        if (key === 'docId' || key === 'lastUpdated') continue;
        if (!deepObjEq(newGrading[key], originalGrading[key])) {
          console.log(`updateGrading diff: field "${key}" changed:`,
            JSON.stringify(originalGrading[key]), '→', JSON.stringify(newGrading[key]));
          // @ts-ignore
          changes[key] = newGrading[key];
        }
      }
      changes.lastUpdated = serverTimestamp() as Timestamp;
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
      this.orders.upsert({ ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order);
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
      this.orders.upsert({ ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order);
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
      this.orders.upsert({ ...existing, lineItems, lastUpdated: new Date().toISOString() } as Order);
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
      this.orders.upsert({ ...existing, ilcAppNotes: notes, lastUpdated: new Date().toISOString() });
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
    const q = query(this.membersCollection, where('primaryInstructorId', '==', instructorId));
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
   * Subscribes to the /videos collection.
   * If the current user is an admin, queries all videos (published and draft/processing).
   * Otherwise (public or non-admin member), queries only published videos (isPublished == true)
   * to comply with Firestore security rules.
   */
  updateVideosSync(user: UserDetails | null) {
    if (this.videosUnsubscribe) {
      this.videosUnsubscribe();
      this.videosUnsubscribe = null;
    }
    const videosRef = collection(this.db, 'videos');
    const q = user?.isAdmin
      ? query(videosRef)
      : query(videosRef, where('isPublished', '==', true));

    this.videosUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map(firestoreDocToVideoItem);
        this.videos.setEntries(items);
      },
      (error) => {
        console.error('Error fetching videos:', error);
        this.videos.setError(error.message);
      },
    );
  }

  /**
   * Look up a video by its docId.
   */
  async getVideoById(videoId: string): Promise<VideoItem | null> {
    const cached = this.videos.get(videoId);
    if (cached) return cached;
    const videoRef = doc(this.db, 'videos', videoId);
    const snap = await getDoc(videoRef);
    if (!snap.exists()) return null;
    return firestoreDocToVideoItem(snap);
  }

  /**
   * Save or update a VideoItem document in /videos.
   */
  async saveVideo(video: VideoItem): Promise<void> {
    const videoRef = doc(this.db, 'videos', video.docId);
    const payload = {
      ...video,
      lastUpdated: new Date().toISOString(),
    };
    await setDoc(videoRef, payload, { merge: true });
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
   * Updates metadata for an existing VideoItem (title, description, tags, tier, price, isPublished).
   */
  async updateVideoMetadata(
    videoId: string,
    patch: Partial<VideoItem>,
  ): Promise<void> {
    const videoRef = doc(this.db, 'videos', videoId);
    const nowIso = new Date().toISOString();
    await updateDoc(videoRef, {
      ...patch,
      lastUpdated: nowIso,
    });
    if (patch.tags && patch.tags.length > 0) {
      this.saveSystemTags(patch.tags);
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

    for (const v of affectedVideos) {
      const updatedTags = v.tags.map((t) => (t === cleanOld ? cleanNew : t));
      const videoRef = doc(this.db, 'videos', v.docId);
      await updateDoc(videoRef, {
        tags: Array.from(new Set(updatedTags)),
        lastUpdated: new Date().toISOString(),
      }).catch((err) => {
        console.warn(`Failed to update tags on video ${v.docId}:`, err);
      });
      updatedVideos++;
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

  async clearAllLocalCaches(): Promise<void> {
    await this.syncService.clearAllCaches();
  }

  async forceRefreshAllData(user: UserDetails): Promise<void> {
    await Promise.all([
      this.updateMembersSync(user, true),
      this.updateSchoolsSync(true),
      this.updateMyStudentsSync(user, true),
      this.findInstructorsService.updateInstructorsSync(true),
    ]);
  }
}
