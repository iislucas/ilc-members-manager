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
  GetMembersResult,
} from '../../functions/src/data-model';
import { FirebaseStateService } from './firebase-state.service';
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
  private unsubscribeSnapshots: () => void = () => {};

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
      await this.firebaseService.loggedIn();
      this.updateMembersSync();
      this.updateSchoolsSync();
    });
    effect(() => this.members.entries().filter((m) => m.instructorId));
  }

  async updateMembersSync() {
    const getMembers = httpsCallable(
      this.firebaseService.functions,
      'getMembers'
    );
    try {
      const result = await getMembers();
      this.members.setEntries((result.data as GetMembersResult).members);
    } catch (error) {
      this.members.setError((error as Error).message);
    }
  }

  async updateSchoolsSync() {
    this.unsubscribeSnapshots = onSnapshot(
      this.schoolsCollection,
      (snapshot) => {
        const schools = snapshot.docs.map(
          (doc) => ({ ...initSchool(), ...doc.data(), id: doc.id } as School)
        );
        this.schools.setEntries(schools);
      },
      (error) => {
        this.schools.setError(error.message);
      }
    );
  }

  async addMember(member: Partial<Member>): Promise<DocumentReference> {
    if (!member.managingOrgId) {
      throw new Error('managingOrgId is required to add a member');
    }
    if (!member.email) {
      throw new Error('email is required to add a member');
    }
    const collectionRef = collection(
      this.db,
      'schools',
      member.managingOrgId,
      'members'
    );
    const newDocRef = doc(collectionRef, member.email);
    return setDoc(newDocRef, member).then(() => newDocRef);
  }

  async updateMember(emailId: string, member: Partial<Member>): Promise<void> {
    if (member.email && member.email !== emailId) {
      return this.updateMemberEmail(emailId, member);
    }
    if (!member.managingOrgId) {
      throw new Error('managingOrgId is required to update a member');
    }
    const docRef = doc(
      this.db,
      'schools',
      member.managingOrgId,
      'members',
      emailId
    );
    return setDoc(docRef, member, { merge: true });
  }

  // TOOD: move this to functions, we don't want to depend on admin user.
  private async updateMemberEmail(
    oldEmail: string,
    member: Partial<Member>
  ): Promise<void> {
    if (!member.email) {
      throw new Error('New email not provided');
    }
    const newEmail = member.email;
    // 1. create a new entry in the members with all the same data and the new email
    await this.addMember(member);

    // 2. update any email entries in the managers or owners of Schools
    const schools = await getDocs(this.schoolsCollection);
    for (const school of schools.docs) {
      const schoolData = school.data() as School;
      const managers = schoolData.managers ?? [];
      let updated = false;
      if (schoolData.owner === oldEmail) {
        schoolData.owner = newEmail;
        updated = true;
      }
      if (managers.includes(oldEmail)) {
        schoolData.managers = managers.map((manager: string) =>
          manager === oldEmail ? newEmail : manager
        );
        updated = true;
      }
      if (updated) {
        await this.updateSchool(school.id, schoolData);
      }
    }

    // 3. delete the old members entry
    await this.deleteMember(oldEmail);
  }

  async deleteMember(emailId: string): Promise<void> {
    const docRef = doc(this.db, 'members', emailId);
    return deleteDoc(docRef);
  }

  async addSchool(school: Partial<School>): Promise<DocumentReference> {
    return addDoc(this.schoolsCollection, school);
  }

  async updateSchool(id: string, school: Partial<School>): Promise<void> {
    return setDoc(doc(this.db, 'schools', id), school, { merge: true });
  }

  async deleteSchool(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'schools', id));
  }

  // TODO: Create a firebase function to find/return all instructors, and use
  // that here instead. We don't need to be watching snapshot changes here.
  async fetchActiveInstructors(country?: string): Promise<Member[]> {
    const constraints = [
      where('instructorId', '>', ''),
      where('membershipExpires', '>', new Date().toISOString()),
    ];
    if (country) {
      constraints.push(where('country', '==', country));
    }
    const q = query(collection(this.db, 'members'), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(
      (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
    );
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
