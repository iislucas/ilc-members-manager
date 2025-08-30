import { effect, Injectable } from '@angular/core';
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import {
  InstructorPublicData,
  initInstructor,
} from '../../functions/src/data-model';
import { environment } from '../environments/environment';
import { SearchableSet } from './searchable-set';
import { initializeApp } from 'firebase/app';

@Injectable({
  providedIn: 'root',
})
export class FindInstructorsService {
  app = initializeApp(environment.firebase);
  db = getFirestore(this.app);
  private snapshotsToUnsubscribe: (() => void)[] = [];
  private instructorsPublicCollection = collection(
    this.db,
    'instructorsPublic',
  );
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

  constructor() {
    effect(async () => {
      this.unsubscribeSnapshots();
      this.updateInstructorsSync();
    });
  }

  unsubscribeSnapshots() {
    this.snapshotsToUnsubscribe.forEach((unsubscribe) => unsubscribe());
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
            (doc) =>
              ({
                ...initInstructor(),
                ...doc.data(),
                id: doc.id,
              }) as InstructorPublicData,
          );
          this.instructors.setEntries(instructors);
        },
        (error) => {
          this.instructors.setError(error.message);
        },
      ),
    );
  }
}
