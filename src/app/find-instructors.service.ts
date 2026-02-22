import { effect, inject, Injectable } from '@angular/core';
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
} from 'firebase/firestore';
import {
  InstructorPublicData,
  firestoreDocToInstructorPublicData,
} from '../../functions/src/data-model';
import { SearchableSet } from './searchable-set';
import { FIREBASE_APP } from './app.config';

@Injectable({
  providedIn: 'root',
})
export class FindInstructorsService {
  app = inject(FIREBASE_APP);
  db = getFirestore(this.app);
  private snapshotsToUnsubscribe: (() => void)[] = [];
  private instructorsPublicCollection = collection(this.db, 'instructors');
  public instructors = new SearchableSet<'instructorId', InstructorPublicData>(
    [
      'memberId',
      'instructorId',
      'name',
      'publicEmail',
      'publicRegionOrCity',
      'publicPhone',
      'country',
      'tags',
    ],
    'instructorId',
  );

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
    const q = query(this.instructorsPublicCollection);
    this.snapshotsToUnsubscribe.push(
      onSnapshot(
        q,
        (snapshot) => {
          const instructors = snapshot.docs.map(
            firestoreDocToInstructorPublicData,
          ).sort((a, b) =>
            a.country.localeCompare(b.country) ||
            b.applicationLevel.localeCompare(a.applicationLevel) ||
            b.studentLevel.localeCompare(a.studentLevel)
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
