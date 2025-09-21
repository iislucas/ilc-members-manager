import { computed, effect, inject, Injectable, signal } from '@angular/core';
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

@Injectable({
  providedIn: 'root',
})
export class DataManagerService {
  private firebaseService = inject(FirebaseStateService);
  private db = getFirestore(this.firebaseService.app);
  private functions = getFunctions(this.firebaseService.app);
  private schoolsCollection = collection(this.db, 'schools');
  private membersCollection = collection(this.db, 'members');
  private instructorsPublicCollection = collection(
    this.db,
    'instructorsPublic',
  );
  private snapshotsToUnsubscribe: (() => void)[] = [];

  // A signal to hold the state of the members list.
  public members = new SearchableSet<Member>([
    'memberId',
    'instructorId',
    'name',
    'email',
    'publicEmail',
    'memberId',
    'city',
    'publicRegionOrCity',
    'country',
  ]);
  public instructors = new SearchableSet<InstructorPublicData>([
    'memberId',
    'instructorId',
    'name',
    'publicEmail',
    'memberId',
    'publicRegionOrCity',
    'publicPhone',
    'country',
  ]);
  public schools = new SearchableSet<School>([
    'schoolName',
    'schoolId',
    'schoolCity',
    'schoolCountry',
  ]);
  public counters = signal<Counters | null>(null);
  public countries = new SearchableSet<CountryCode>(['name', 'id']);

  constructor() {
    effect(async () => {
      this.unsubscribeSnapshots();
      const user = await this.firebaseService.loggedIn();
      this.updateMembersSync(user);
      this.updateInstructorsSync();
      this.updateSchoolsSync();
      this.updateCountersSync();
      this.updateCountryCodesSync();
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
                allMembers.delete(change.doc.id);
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
    const q = query(
      this.instructorsPublicCollection,
      orderBy('applicationLevel', 'desc'),
    );
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

  async updateCountersSync() {
    const countersRef = doc(this.db, 'counters', 'singleton');
    const docSnap = await getDoc(countersRef);

    this.snapshotsToUnsubscribe.push(
      onSnapshot(countersRef, (doc) => {
        if (doc.exists()) {
          console.log('counters: ', doc.data());
          this.counters.set(doc.data() as Counters);
        } else {
          console.log('First run, set counters');
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
          console.log('First run, creating country codes');
          const countryCodes: CountryCodesDoc = { codes: countryCodeList };
          setDoc(countryCodesRef, countryCodes);
        }
      }),
    );
  }

  async addMember(member: Member): Promise<DocumentReference> {
    if (!member.email) {
      throw new Error('email is required to add a member');
    }
    const collectionRef = collection(this.db, 'members');
    const newDocRef = doc(collectionRef, member.email);
    const memberWithNewTimestamp: MemberFirestoreDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(newDocRef, memberWithNewTimestamp).then(() => newDocRef);
  }

  async updateMember(emailId: string, member: Member): Promise<void> {
    if (member.email && member.email !== emailId) {
      return this.updateMemberEmail(emailId, member);
    }
    const docRef = doc(this.db, 'members', emailId);
    const memberWithNewTimestamp: MemberFirestoreDoc = {
      ...member,
      lastUpdated: serverTimestamp() as Timestamp,
    };
    return setDoc(docRef, memberWithNewTimestamp, { merge: true });
  }

  // TOOD: move this to functions, we don't want to depend on admin user.
  private async updateMemberEmail(
    oldEmail: string,
    member: Member,
  ): Promise<void> {
    if (!member.email) {
      throw new Error('New email not provided');
    }
    await this.addMember(member);
    await this.deleteMember(oldEmail);
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

  async createNextSchoolId(): Promise<number> {
    const nextSchoolId = httpsCallable<unknown, { newId: number }>(
      this.functions,
      'nextSchoolId',
    );
    const result = await nextSchoolId();
    return result.data.newId;
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
