import { computed, inject, Injectable, signal } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  DocumentReference,
  getFirestore,
  onSnapshot,
} from 'firebase/firestore';
import { Member } from './member.model';
import { FirebaseStateService } from '../firebase-state.service';

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
    // Subscribe to collection changes and update the state signal.
    onSnapshot(
      this.membersCollection,
      (snapshot) => {
        const members = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Member)
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
  }

  async getMember(id: string): Promise<Member | undefined> {
    const docRef = doc(this.db, 'members', id);
    const docSnap = await getDoc(docRef);
    return docSnap.exists()
      ? ({ id: docSnap.id, ...docSnap.data() } as Member)
      : undefined;
  }

  async addMember(member: Partial<Member>): Promise<DocumentReference> {
    const newDocRef = doc(this.membersCollection);
    return setDoc(newDocRef, member).then(() => newDocRef);
  }

  async updateMember(id: string, member: Partial<Member>): Promise<void> {
    return setDoc(doc(this.db, 'members', id), member, { merge: true });
  }

  async deleteMember(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'members', id));
  }
}
