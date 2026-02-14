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
  deleteDoc,
  DocumentReference,
  getFirestore,
  onSnapshot,
  query,
  Timestamp,
  serverTimestamp,
  orderBy,
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
} from '../../functions/src/data-model';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import { countryCodeList, CountryCode, CountryCodesDoc } from './country-codes';
import * as Papa from 'papaparse';
import { SearchableSet } from './searchable-set';
import { getFunctions, httpsCallable } from 'firebase/functions';

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

@Injectable({
  providedIn: 'root',
})
export class DataManagerService {
  private firebaseService = inject(FirebaseStateService);
  private db = getFirestore(this.firebaseService.app);
  private functions = getFunctions(this.firebaseService.app);
  private schoolsCollection = collection(this.db, 'schools');
  private membersCollection = collection(this.db, 'members');
  private instructorsPublicCollection = collection(this.db, 'instructors');
  private ordersCollection = collection(this.db, 'orders');
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
  public members = new SearchableSet<'memberId', Member>(
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
    ],
    'memberId',
  );
  public instructors = new SearchableSet<'instructorId', InstructorPublicData>(
    [
      'memberId',
      'instructorId',
      'name',
      'publicEmail',
      'memberId',
      'publicRegionOrCity',
      'publicCountyOrState',
      'publicPhone',
      'country',
    ],
    'instructorId',
  );
  public myStudents = new SearchableSet<'memberId', Member>(
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
    ],
    'memberId',
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
  public orders = new SearchableSet<'id', Order>(
    ['referenceNumber', 'lastName', 'firstName', 'email', 'externalId'],
    'id',
  );
  public counters = signal<Counters | null>(null);
  public countries = new SearchableSet<'id', CountryCode>(['name', 'id'], 'id');

  constructor() {
    effect(async () => {
      this.unsubscribeSnapshots();
      const user = await this.firebaseService.loggedIn();
      this.updateMembersSync(user);
      this.updateInstructorsSync();
      this.updateMyStudentsSync(user);
      this.updateSchoolsSync();
      this.updateCountersSync();
      this.updateCountryCodesSync();
    });

    // Effect for My Schools
    effect(() => {
      const user = this.firebaseService.user();
      if (user) {
        const allSchools = this.schools.entries();
        const myMemberId = user.member.memberId;
        const mySchoolsList = allSchools.filter(
          (school) =>
            school.owner === myMemberId || school.managers.includes(myMemberId),
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
    console.log(`updateMembersSync(${user.member.emails[0]}: UserDetails)`);
    console.log(user);
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
        console.log(`loading members from: schools/${schoolId}/members`);

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
                if (mem?.managingOrgId === schoolId) {
                  allMembers.delete(change.doc.id);
                }
              } else {
                allMembers.set(change.doc.id, firestoreDocToMember(change.doc));
              }
            });
            console.log('members loaded:');
            console.log(Array.from(allMembers.values()));
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
      // console.log(user);
      // console.error('User is not a school manager or admin');
      // this.members.setError(`You are not a school manager or admin.`);
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

  async updateInstructorsSync() {
    this.snapshotsToUnsubscribe.push(
      onSnapshot(
        this.instructorsPublicCollection,
        (snapshot) => {
          const instructors = snapshot.docs.map(
            firestoreDocToInstructorPublicData,
          );
          this.instructors.setEntries(instructors);
        },
        (error) => {
          this.instructors.setError(error.message);
        },
      ),
    );
  }

  async updateOrdersSync() {
    return new Promise((resolve, reject) => {
      // Only load orders if explicitly needed or requested to save bandwidth?
      // For now, let's load them for admins to facilitate duplicate checking
      const q = query(this.ordersCollection, orderBy('lastUpdated', 'desc'));
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          q,
          (snapshot) => {
            const orders = snapshot.docs.map(firestoreDocToOrder);
            this.orders.setEntries(orders);
            resolve(this.orders);
          },
          (error) => {
            this.orders.setError(error.message);
            reject(error);
          },
        ),
      );
    });
  }

  async updateMyStudentsSync(user: UserDetails) {
    // If the user is an instructor (has an instructorId), load their students.
    // Note: We check if they have a numeric instructorId, as that indicates they are an instructor.
    if (user.member.instructorId) {
      const q = query(
        collection(this.db, `instructors/${user.member.id}/members`),
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
            this.myStudents.setError(error.message);
          },
        ),
      );
    } else {
      this.myStudents.setEntries([]);
    }
  }

  async updateCountersSync() {
    const countersRef = doc(this.db, 'counters', 'singleton');
    this.snapshotsToUnsubscribe.push(
      onSnapshot(countersRef, (doc) => {
        if (doc.exists()) {
          this.counters.set(doc.data() as Counters);
        } else {
          setDoc(countersRef, { memberIdCounters: {}, instructorIdCounter: 0 });
        }
      }),
    );
  }

  async updateCountryCodesSync() {
    const countryCodesRef = doc(this.db, 'static', 'country-codes');
    this.snapshotsToUnsubscribe.push(
      onSnapshot(countryCodesRef, (doc) => {
        if (doc.exists()) {
          const countryCode = doc.data() as CountryCodesDoc;
          this.countries.setEntries(countryCode.codes);
        } else {
          const countryCodes: CountryCodesDoc = { codes: countryCodeList };
          setDoc(countryCodesRef, countryCodes);
        }
      }),
    );
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

  async updateMember(id: string, member: Member): Promise<void> {
    const docRef = doc(this.db, 'members', id);
    const memberWithNewTimestamp: MemberFirestoreDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(docRef, memberWithNewTimestamp, { merge: true });
  }

  async deleteMember(emailId: string): Promise<void> {
    const docRef = doc(this.db, 'members', emailId);
    return deleteDoc(docRef);
  }

  async setSchool(school: School): Promise<void> {
    const schoolWithNewTimestamp: SchoolFirebaseDoc = {
      ...school,
      lastUpdated: serverTimestamp() as Timestamp,
    };

    return setDoc(
      doc(this.db, 'schools', school.schoolId),
      schoolWithNewTimestamp,
      {
        merge: true,
      },
    );
  }

  async deleteSchool(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'schools', id));
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
      if (s.managers) {
        (school as any).managers = s.managers.join(',');
      }
      return school;
    });
    const csv = Papa.unparse(schools);
    this.downloadFile('schools.csv', csv, 'text/csv');
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
