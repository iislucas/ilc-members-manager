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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  DocumentReference,
  getFirestore,
  onSnapshot,
  query,
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
  MemberFirestoreDoc,
  SchoolFirebaseDoc,
  firestoreDocToMember,
  firestoreDocToSchool,
  firestoreDocToInstructorPublicData,
  Order,
  firestoreDocToOrder,
  OrderFirebaseDoc,
  Grading,
  GradingFirebaseDoc,
  firestoreDocToGrading,
  SquareSpaceOrder,
  SquareSpaceLineItem,
  IlcEvent,
  EventStatus,
  initEvent,
  ResourceAccessLevel,
} from '../../functions/src/data-model';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import { countryCodeList, CountryCode, CountryCodesDoc } from './country-codes';
import * as Papa from 'papaparse';
import { SearchableSet } from './searchable-set';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deepObjEq } from './utils';
import { FindInstructorsService } from './find-instructors.service';

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

export function sortOrdersByDateDesc(orders: Order[]): Order[] {
  return orders.sort((a, b) => {
    const dateA = a.ilcAppOrderKind === 'https://api.squarespace.com/1.0/commerce/orders' ? a.createdOn : a.datePaid;
    const dateB = b.ilcAppOrderKind === 'https://api.squarespace.com/1.0/commerce/orders' ? b.createdOn : b.datePaid;
    return (dateB || '').localeCompare(dateA || '');
  });
}

export type OrderSearchCriteriaTerm = {
  kind: 'term';
  searchField: 'orderNumber' | 'referenceNumber' | 'id' | 'customerEmail' | 'email' | 'lastName' | 'billingAddress.lastName';
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
  searchField: 'title' | 'location' | 'ownerEmails' | 'leadingInstructorId';
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

@Injectable({
  providedIn: 'root',
})
export class DataManagerService {
  private firebaseService = inject(FirebaseStateService);
  private findInstructorsService = inject(FindInstructorsService);
  private db = getFirestore(this.firebaseService.app);
  private functions = getFunctions(this.firebaseService.app);
  private schoolsCollection = collection(this.db, 'schools');
  private membersCollection = collection(this.db, 'members');
  private ordersCollection = collection(this.db, 'orders');
  private eventsCollection = collection(this.db, 'events');
  private snapshotsToUnsubscribe: (() => void)[] = [];
  loadingState = linkedSignal<DataServiceState>(() => {
    if (
      this.members.loaded() &&
      this.schools.loaded() &&
      this.instructors.loaded() &&
      this.myStudents.loaded()
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
  public countries = new SearchableSet<'id', CountryCode>(['name', 'id'], 'id');
  public gradings = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );
  public myGradingsAssessed = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );
  public myGradings = new SearchableSet<'docId', Grading>(
    ['studentMemberId', 'gradingInstructorId', 'schoolId', 'status', 'level', 'notes', 'gradingEvent'],
    'docId',
  );

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
    effect(async () => {
      this.unsubscribeSnapshots();
      const user = await this.firebaseService.loggedIn();
      this.updateMembersSync(user);
      // Instructors are loaded by FindInstructorsService (no auth required).
      this.updateMyStudentsSync(user);
      this.updateSchoolsSync();
      this.updateCountersSync();
      this.updateCountryCodesSync();
      this.updateGradingsSync(user);
      this.updateMyGradingsAssessedSync(user);
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
  }

  unsubscribeSnapshots() {
    this.snapshotsToUnsubscribe.forEach((unsubscribe) => unsubscribe());
  }

  async updateMembersSync(user: UserDetails) {
    if (user.isAdmin) {
      const q = query(this.membersCollection, orderBy('lastUpdated', 'desc'));
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          q,
          (snapshot) => {
            const members = snapshot.docs.map(firestoreDocToMember);
            this.members.setEntries(members);
          },
          (error) => {
            console.error(error);
            this.members.setError(error.message);
          },
        ),
      );
    } else if (user.schoolsManaged.length > 0) {
      const allMembers = new Map<string, Member>();

      user.schoolsManaged.forEach((schoolId) => {
        const membersQuery = query(
          collection(this.db, `schools/${schoolId}/members`),
          orderBy('lastUpdated', 'desc'),
        );
        const unsubscribe = onSnapshot(
          membersQuery,
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === 'removed') {
                // Avoids race condition when someone is moved from one school
                // you own to another. Without this, we might add/update the
                // member due to the new school, but then remove them from the
                // old school, which, without this check would remove them from
                // the global set.
                const mem = allMembers.get(change.doc.id);
                if (mem?.primarySchoolId === schoolId) {
                  allMembers.delete(change.doc.id);
                }
              } else {
                allMembers.set(change.doc.id, firestoreDocToMember(change.doc));
              }
            });
            this.members.setEntries(Array.from(allMembers.values()));
          },
          (error) => {
            console.error(
              `Error fetching members for school ${schoolId}:`,
              error,
            );
            this.members.setError(
              `Error fetching members for school ${schoolId}.`,
            );
          },
        );
        this.snapshotsToUnsubscribe.push(unsubscribe);
      });
    } else {
      this.members.setEntries([]);
    }
  }

  async updateSchoolsSync() {
    const q = query(this.schoolsCollection, orderBy('schoolId', 'desc'));
    this.snapshotsToUnsubscribe.push(
      onSnapshot(
        q,
        (snapshot) => {
          const schools = snapshot.docs.map(firestoreDocToSchool);
          this.schools.setEntries(schools);
        },
        (error) => {
          this.schools.setError(error.message);
        },
      ),
    );
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
        q = query(q, where('ilcAppOrderKind', '==', 'https://api.squarespace.com/1.0/commerce/orders'));
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

      // Search only the specifically requested field
      let q = query(this.ordersCollection, where(field, '==', term));
      
      if (status) {
        q = query(q, where('ilcAppOrderStatus', '==', status));
      }
      if (kindFilter === 'squarespace') {
        q = query(q, where('ilcAppOrderKind', '==', 'https://api.squarespace.com/1.0/commerce/orders'));
      }

      const snap = await getDocs(q);
      snap.docs.forEach((docSnap) => {
        const order = firestoreDocToOrder(docSnap as any);
        results.set(order.docId, order);
      });

      return sortOrdersByDateDesc(Array.from(results.values()));
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

      let q;
      if (field === 'ownerEmails') {
        q = query(this.eventsCollection, where('ownerEmails', 'array-contains', term));
      } else {
        q = query(this.eventsCollection, where(field, '==', term));
      }
      
      if (status) {
        q = query(q, where('status', '==', status));
      }

      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent));
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
        return snap.docs.map(d => ({ ...initEvent(), ...d.data(), docId: d.id } as IlcEvent));
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

  async updateMyStudentsSync(user: UserDetails) {
    // If the user is an instructor (has an instructorId), load their students.
    // Note: We check if they have a numeric instructorId, as that indicates they are an instructor.
    if (user.member.instructorId) {
      const q = query(
        collection(this.db, `instructors/${user.member.docId}/members`),
        orderBy('name', 'asc'),
      );
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          q,
          (snapshot) => {
            const students = snapshot.docs.map(firestoreDocToMember);
            this.myStudents.setEntries(students);
          },
          (error) => {
            console.error('Error fetching my students:', error);
            this.myStudents.setError(`Error fetching students: ${error.message}`);
          },
        ),
      );
    } else {
      this.myStudents.setEntries([]);
    }
  }


  async updateCountersSync() {
    const countersRef = doc(this.db, 'system', 'counters');
    this.snapshotsToUnsubscribe.push(
      onSnapshot(countersRef, (doc) => {
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
        // Counters is a regular signal, not a SearchableSet, but we could handle the error somehow,
        // e.g. setting an error symbol or empty counters if needed to avoid hanging.
      }),
    );
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

  async updateGradingsSync(user: UserDetails) {
    if (user.isAdmin) {
      const gradingsCollection = collection(this.db, 'gradings');
      const q = query(gradingsCollection, orderBy('lastUpdated', 'desc'));
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          q,
          (snapshot) => {
            const gradingsList = snapshot.docs.map(firestoreDocToGrading);
            this.gradings.setEntries(gradingsList);
          },
          (error) => {
            console.error('Error fetching gradings:', error);
            this.gradings.setError(error.message);
          },
        ),
      );
    } else {
      this.gradings.setEntries([]);
    }
  }

  async updateMyGradingsAssessedSync(user: UserDetails) {
    if (user.member.instructorId) {
      const q = query(
        collection(this.db, `instructors/${user.member.docId}/gradings`),
        orderBy('lastUpdated', 'desc'),
      );
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          q,
          (snapshot) => {
            const gradingsList = snapshot.docs.map(firestoreDocToGrading);
            this.myGradingsAssessed.setEntries(gradingsList);
          },
          (error) => {
            console.error('Error fetching my gradings assessed:', error);
            this.myGradingsAssessed.setError(error.message);
          },
        ),
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

  async addMember(member: Member): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'members');
    const newDocRef = doc(collectionRef);
    const memberWithNewTimestamp: MemberFirestoreDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(newDocRef, memberWithNewTimestamp).then(() => newDocRef);
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
    // we avoid firestore rules from rejecting the update due to the precense of 
    // fields that are not allowed.
    if (originalMember) {
      const changes: Partial<MemberFirestoreDoc> = {};
      for (const key of Object.keys(newMember) as Array<keyof Member>) {
        if (key === 'docId' || key === 'lastUpdated') continue;
        if (!deepObjEq(newMember[key], originalMember[key])) {
          // @ts-ignore
          changes[key] = newMember[key];
        }
      }
      changes.lastUpdated = serverTimestamp() as Timestamp;
      return setDoc(docRef, changes, { merge: true });
    } else {
      // Fallback if no old member is found
      const memberWithNewTimestamp: MemberFirestoreDoc = {
        ...newMember,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      delete (memberWithNewTimestamp as { docId?: string }).docId;
      return setDoc(docRef, memberWithNewTimestamp, { merge: true });
    }
  }

  async updateMemberAndStudentInstructorIds(id: string, member: Member, oldInstructorId: string): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    const memberWithNewTimestamp: MemberFirestoreDoc = {
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
  }

  async deleteMember(emailId: string): Promise<void> {
    const docRef = doc(this.db, 'members', emailId);
    return deleteDoc(docRef);
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
      const changes: Partial<SchoolFirebaseDoc> = {};
      for (const key of Object.keys(school) as Array<keyof School>) {
        if (key === 'docId' || key === 'lastUpdated') continue;
        if (!deepObjEq(school[key], oldSchool[key])) {
          // @ts-ignore
          changes[key] = school[key];
        }
      }
      changes.lastUpdated = serverTimestamp() as Timestamp;
      return setDoc(docRef, changes, { merge: true });
    }

    // Fallback: send everything (for new schools or when no original is available)
    const schoolWithNewTimestamp: SchoolFirebaseDoc = {
      ...school,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(docRef, schoolWithNewTimestamp, { merge: true });
  }

  async setSchoolAndUpdateMembers(school: School, oldSchoolId: string): Promise<void> {
    const schoolWithNewTimestamp: SchoolFirebaseDoc = {
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
    return deleteDoc(doc(this.db, 'schools', id));
  }

  async addGrading(grading: Grading): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'gradings');
    const newDocRef = doc(collectionRef);
    const gradingWithNewTimestamp: GradingFirebaseDoc = {
      ...grading,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(newDocRef, gradingWithNewTimestamp).then(() => newDocRef);
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
      const changes: Partial<GradingFirebaseDoc> = {};
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
      return setDoc(docRef, changes, { merge: true });
    } else {
    // Fallback: send everything (for new gradings or when no original is available)
      const gradingWithNewTimestamp: GradingFirebaseDoc = {
        ...newGrading,
        lastUpdated: serverTimestamp() as Timestamp,
      };
      delete (gradingWithNewTimestamp as { docId?: string }).docId;
      return setDoc(docRef, gradingWithNewTimestamp, { merge: true });
    }
  }

  async deleteGrading(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'gradings', id));
  }



  async addOrder(order: Order): Promise<DocumentReference> {
    const collectionRef = collection(this.db, 'orders');
    const newDocRef = doc(collectionRef);
    const orderWithNewTimestamp: OrderFirebaseDoc = {
      ...order,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(newDocRef, orderWithNewTimestamp).then(() => newDocRef);
  }

  async updateOrder(id: string, order: Order): Promise<void> {
    const docRef = doc(this.db, 'orders', id);
    const orderWithNewTimestamp: OrderFirebaseDoc = {
      ...order,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(docRef, orderWithNewTimestamp, { merge: true });
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
    return updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
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
    return updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
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
    return updateDoc(docRef, {
      lineItems,
      lastUpdated: serverTimestamp(),
    });
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
    return updateDoc(docRef, {
      ilcAppNotes: notes,
      lastUpdated: serverTimestamp(),
    });
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

  private downloadFile(filename: string, content: string, mimeType: string) {

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
