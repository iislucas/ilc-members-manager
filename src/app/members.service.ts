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
} from 'firebase/firestore';
import { Member, initMember } from './member.model';
import { FirebaseStateService } from './firebase-state.service';
import * as Papa from 'papaparse';
import { User } from 'firebase/auth';

/** The state of the members collection. */
export interface MembersState {
  /** The list of members. */
  members: Member[];
  /** Whether the members are currently being loaded. */
  loading: boolean;
  /** Any error that occurred while loading the members. */
  error: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class MembersService {
  private firebaseService = inject(FirebaseStateService);
  private db = getFirestore(this.firebaseService.app);
  private membersCollection = collection(this.db, 'members');
  private unsubscribeSnapshots: () => void = () => {};

  // A signal to hold the state of the members list.
  private state = signal<MembersState>({
    members: [],
    loading: true,
    error: null,
  });

  // Expose computed signals for easy access in components.
  members = computed(() => this.state().members);
  loading = computed(() => this.state().loading);
  error = computed(() => this.state().error);

  constructor() {
    effect(() => {
      const loginState = this.firebaseService.loggedIn();
      this.unsubscribeSnapshots();
      this.updateMembersSync(loginState);
    });
  }

  async updateMembersSync(
    statePromise: Promise<{ user: User; member: Member }>
  ) {
    const initState = await statePromise;
    if (initState.member.isAdmin) {
      // Admins subscribe all memberships; and get the collection of changes and
      // update the state signal accordingly.
      this.unsubscribeSnapshots = onSnapshot(
        this.membersCollection,
        (snapshot) => {
          const members = snapshot.docs.map(
            (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
          );
          this.state.update((state) => ({ ...state, members, loading: false }));
        },
        (error) => {
          this.state.update((state) => ({
            ...state,
            error: error.message,
            loading: false,
          }));
        }
      );
    } else {
      // TODO: Subscribe to just this user's doc
      this.state.update((state) => ({
        ...state,
        members: [initState.member],
        loading: false,
      }));
    }
  }

  async getMember(emailId: string): Promise<Member | undefined> {
    const docRef = doc(this.db, 'members', emailId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists()
      ? ({ ...docSnap.data(), id: emailId } as Member)
      : undefined;
  }

  async addMember(member: Partial<Member>): Promise<DocumentReference> {
    const newDocRef = doc(this.membersCollection, member.email);
    return setDoc(newDocRef, member).then(() => newDocRef);
  }

  async updateMember(emailId: string, member: Partial<Member>): Promise<void> {
    return setDoc(doc(this.db, 'members', emailId), member, { merge: true });
  }

  async deleteMember(emailId: string): Promise<void> {
    return deleteDoc(doc(this.db, 'members', emailId));
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

  async findInstructors(country?: string): Promise<Member[]> {
    const constraints = [
      where('instructorId', '>', ''),
      where('membershipExpires', '>', new Date().toISOString()),
    ];
    if (country) {
      constraints.push(where('country', '==', country));
    }
    const q = query(this.membersCollection, ...constraints);
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
