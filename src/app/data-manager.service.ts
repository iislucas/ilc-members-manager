import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  collection,
  collectionGroup,
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
import { Member, initMember, School, initSchool } from './data-model';
import { FirebaseStateService } from './firebase-state.service';
import * as Papa from 'papaparse';
import { User } from 'firebase/auth';
import MiniSearch from 'minisearch';

/** The state of the members collection. */
export interface MembersState {
  /** The list of members. */
  members: Member[];
  /** Whether the members are currently being loaded. */
  loading: boolean;
  /** Any error that occurred while loading the members. */
  error: string | null;
}

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
  private state = signal<MembersState>({
    members: [],
    loading: true,
    error: null,
  });

  private schoolsState = signal<SchoolsState>({
    schools: [],
    loading: true,
    error: null,
  });

  // Expose computed signals for easy access in components.
  members = computed(() => this.state().members);
  loading = computed(() => this.state().loading);
  error = computed(() => this.state().error);
  schools = computed(() => this.schoolsState().schools);
  loadingSchools = computed(() => this.schoolsState().loading);
  errorSchools = computed(() => this.schoolsState().error);

  private allMembersMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<Member>({
      fields: [
        'memberId',
        'instructorId',
        'name',
        'email',
        'memberId',
        'city',
        'country',
      ],
      storeFields: ['id'],
      idField: 'id',
    });
    miniSearch.addAll(this.members());
    return miniSearch;
  });

  public instructors = computed(() =>
    this.members().filter((m) => m.instructorId)
  );

  private instructorsMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<Member>({
      fields: ['name', 'email', 'memberId', 'instructorId', 'city', 'country'],
      storeFields: ['id'],
      idField: 'id',
    });
    miniSearch.addAll(this.instructors());
    return miniSearch;
  });

  private memberMap = computed(() => {
    const map = new Map<string, Member>();
    for (const member of this.members()) {
      map.set(member.id, member);
    }
    return map;
  });

  private schoolMap = computed(() => {
    const map = new Map<string, School>();
    for (const school of this.schools()) {
      map.set(school.id, school);
    }
    return map;
  });

  private schoolsMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<School>({
      fields: ['schoolName', 'schoolId', 'schoolCity', 'schoolCountry'],
      storeFields: ['id'],
      idField: 'id',
    });
    miniSearch.addAll(this.schools());
    return miniSearch;
  });

  constructor() {
    effect(() => {
      const loginState = this.firebaseService.loggedIn();
      this.unsubscribeSnapshots();
      this.updateSchoolsSync(loginState);
    });
  }

  // Should only be called by admin users (others should not have permissions,
  // per firebase security rules).
  async getAllMembers(): Promise<Member[]> {
    const snapshot = await getDocs(query(collectionGroup(this.db, 'members')));
    return snapshot.docs.map(
      (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
    );
  }

  async getSchoolMembers(schoolId: string): Promise<Member[]> {
    const membersCollection = collection(
      this.db,
      'schools',
      schoolId,
      'members'
    );
    const snapshot = await getDocs(membersCollection);
    return snapshot.docs.map(
      (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
    );
  }

  async updateSchoolsSync(
    statePromise: Promise<{ user: User; member: Member }>
  ) {
    const initState = await statePromise;
    if (initState.member.isAdmin) {
      this.unsubscribeSnapshots = onSnapshot(
        this.schoolsCollection,
        (snapshot) => {
          const schools = snapshot.docs.map(
            (doc) => ({ ...initSchool(), ...doc.data(), id: doc.id } as School)
          );
          this.schoolsState.update((state) => ({
            ...state,
            schools,
            loading: false,
          }));
        },
        (error) => {
          this.schoolsState.update((state) => ({
            ...state,
            error: error.message,
            loading: false,
          }));
        }
      );
    }
  }

  async getMember(emailId: string): Promise<Member | undefined> {
    // This is not correct with the new data structure, we need to know the
    // schoolId.
    // TODO: fix this.
    const docRef = doc(this.db, 'members', emailId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists()
      ? ({ ...docSnap.data(), id: emailId } as Member)
      : undefined;
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
    const member = await this.getMember(emailId);
    if (!member || !member.managingOrgId) {
      throw new Error(
        'Could not delete member as managingOrgId is not known for this member'
      );
    }
    const docRef = doc(
      this.db,
      'schools',
      member.managingOrgId,
      'members',
      emailId
    );
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

  async getCountries(): Promise<string[]> {
    const members = this.members();
    const countries = new Set<string>();
    for (const member of members) {
      if (member.country) {
        countries.add(member.country);
      }
    }
    return Array.from(countries).sort();
  }

  searchMembers(term: string): Member[] {
    if (!term) {
      return this.members();
    }
    const results = this.allMembersMiniSearch().search(term, { fuzzy: 0.2 });
    return results.map((result) => this.memberMap().get(result.id)!);
  }

  searchInstructors(term: string, country?: string): Member[] {
    let members: Member[];
    if (!term) {
      members = this.instructors();
    } else {
      const results = this.instructorsMiniSearch().search(term, { fuzzy: 0.2 });
      members = results.map((result) => this.memberMap().get(result.id)!);
    }
    if (country) {
      members = members.filter((m) => m.country === country);
    }
    return members;
  }

  searchSchools(term: string): School[] {
    if (!term) {
      return this.schools();
    }
    const results = this.schoolsMiniSearch().search(term, { fuzzy: 0.2 });
    return results.map((result) => this.schoolMap().get(result.id)!);
  }

  // TODO: Create a firebase function to find/return all instructors, and use
  // that here instead. We don't need to be watching snapshot changes here.
  async findInstructors(country?: string): Promise<Member[]> {
    const constraints = [
      where('instructorId', '>', ''),
      where('membershipExpires', '>', new Date().toISOString()),
    ];
    if (country) {
      constraints.push(where('country', '==', country));
    }
    const q = query(collectionGroup(this.db, 'members'), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(
      (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
    );
  }

  downloadCsv() {
    const members = this.state().members.map((m) => ({
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
    const members = this.state().members;
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
