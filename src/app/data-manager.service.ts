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
  where,
  getDocs,
  addDoc,
} from 'firebase/firestore';
import {
  Member,
  initMember,
  School,
  initSchool,
  FetchMembersResult,
  FetchInstructorsResult,
} from '../../functions/src/data-model';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import * as Papa from 'papaparse';
import { User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { SearchableSet } from './searchable-set';

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
  private schoolsCollection = collection(this.db, 'schools');
  private membersCollection = collection(this.db, 'members');
  private snapshotsToUnsubscribe: (() => void)[] = [];

  // A signal to hold the state of the members list.
  public members = new SearchableSet<Member>([
    'memberId',
    'instructorId',
    'name',
    'email',
    'memberId',
    'city',
    'country',
  ]);
  public instructors = new SearchableSet<Member>([
    'memberId',
    'instructorId',
    'name',
    'email',
    'memberId',
    'city',
    'country',
  ]);
  public schools = new SearchableSet<School>([
    'schoolName',
    'schoolId',
    'schoolCity',
    'schoolCountry',
  ]);

  constructor() {
    effect(async () => {
      this.unsubscribeSnapshots();
      const user = await this.firebaseService.loggedIn();
      this.updateMembersSync(user);
      // this.updateInstructorsSync();
      this.updateSchoolsSync();
    });
    effect(() =>
      this.instructors.setEntries(
        this.members.entries().filter((m) => m.instructorId),
      ),
    );
  }

  unsubscribeSnapshots() {
    this.snapshotsToUnsubscribe.forEach((unsubscribe) => unsubscribe());
  }

  async updateMembersSync(user: UserDetails) {
    if (user.isAdmin) {
      this.snapshotsToUnsubscribe.push(
        onSnapshot(
          this.membersCollection,
          (snapshot) => {
            const members = snapshot.docs.map(
              (doc) =>
                ({ ...initMember(), ...doc.data(), id: doc.id }) as Member,
            );
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
        const membersCollectionPath = `schools/${schoolId}/members`;
        const membersQuery = query(collection(this.db, membersCollectionPath));

        const unsubscribe = onSnapshot(
          membersQuery,
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === 'removed') {
                allMembers.delete(change.doc.id);
              } else {
                allMembers.set(change.doc.id, {
                  ...initMember(),
                  ...change.doc.data(),
                  id: change.doc.id,
                } as Member);
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
      console.error('User is not a school manager or admin');
      this.members.setError(`You are not a school manager or admin.`);
    }
  }

  //  // Admin: Return all members
  //   if (userDetails.isAdmin) {
  //     const membersSnapshot = await db.collection('members').get();
  //     const members = membersSnapshot.docs.map(
  //       (doc) => ({ id: doc.id, ...doc.data() } as Member)
  //     );
  //     return {
  //       members,
  //     };
  //   }

  //   if (userDetails.schoolsManaged.length > 0) {
  //     const membersSnapshot = await db
  //       .collection('members')

  //       .get();
  //     const members = membersSnapshot.docs.map(
  //       (doc) => ({ id: doc.id, ...doc.data() } as Member)
  //     );
  //     return {
  //       members,
  //     };
  //   }

  // async updateMembersSync() {
  //   const getMembers = httpsCallable(
  //     this.firebaseService.functions,
  //     'getMembers',
  //   );
  //   try {
  //     const result = await getMembers();
  //     const members = (result.data as FetchMembersResult).members.map((m) => {
  //       return { ...initMember(), ...m } as Member;
  //     });
  //     this.members.setEntries(members);
  //   } catch (error) {
  //     this.members.setError((error as Error).message);
  //   }
  // }

  // TODO: lets have a firebase on update that results in a copy of instructors
  // in a special collection "instructors", which also has the appropriate
  // subset of the information about instructors.
  // async updateInstructorsSync() {
  //   const getMembers = httpsCallable(
  //     this.firebaseService.functions,
  //     'getInstructors',
  //   );
  //   try {
  //     const result = await getMembers();
  //     const members = (result.data as FetchInstructorsResult).instructors.map(
  //       (m) => {
  //         return { ...initMember(), ...m } as Member;
  //       },
  //     );
  //     this.instructors.setEntries(members);
  //   } catch (error) {
  //     this.instructors.setError((error as Error).message);
  //   }
  // }

  async updateSchoolsSync() {
    this.snapshotsToUnsubscribe.push(
      onSnapshot(
        this.schoolsCollection,
        (snapshot) => {
          const schools = snapshot.docs.map(
            (doc) => ({ ...initSchool(), ...doc.data(), id: doc.id }) as School,
          );
          this.schools.setEntries(schools);
        },
        (error) => {
          this.schools.setError(error.message);
        },
      ),
    );
  }

  async addMember(member: Partial<Member>): Promise<DocumentReference> {
    if (!member.email) {
      throw new Error('email is required to add a member');
    }
    const collectionRef = collection(this.db, 'members');
    const newDocRef = doc(collectionRef, member.email);
    return setDoc(newDocRef, member).then(() => newDocRef);
  }

  async updateMember(emailId: string, member: Partial<Member>): Promise<void> {
    if (member.email && member.email !== emailId) {
      return this.updateMemberEmail(emailId, member);
    }
    const docRef = doc(this.db, 'members', emailId);
    return setDoc(docRef, member, { merge: true });
  }

  // TOOD: move this to functions, we don't want to depend on admin user.
  private async updateMemberEmail(
    oldEmail: string,
    member: Partial<Member>,
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
    return setDoc(doc(this.db, 'schools', school.schoolId), school, {
      merge: true,
    });
  }

  async deleteSchool(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'schools', id));
  }

  downloadCsv() {
    const members = this.members.entries().map((m) => ({
      ...m,
      mastersLevels: m.mastersLevels.join(','),
    }));
    const csv = Papa.unparse(members);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'members.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  downloadJsonL() {
    const members = this.members.entries();
    const jsonl = members.map((member) => JSON.stringify(member)).join('\n');
    const blob = new Blob([jsonl], {
      type: 'application/jsonl;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'members.jsonl');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
