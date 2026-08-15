/* find-instructors.service.ts
 *
 * Public instructors catalog service.
 *
 * Uses IncrementalSyncService to load the public instructors directory
 * instantly from IndexedDB cache on app startup, and synchronize only
 * modified or deleted instructors from Firestore in the background.
 */

import { effect, inject, Injectable } from '@angular/core';
import {
  InstructorPublicData,
  firestoreDocToInstructorPublicData,
} from '../../functions/src/data-model';
import { SearchableSet } from './searchable-set';
import { IncrementalSyncService } from './incremental-sync.service';

export function sortInstructors(a: InstructorPublicData, b: InstructorPublicData): number {
  return (
    a.country.localeCompare(b.country) ||
    b.applicationLevel.localeCompare(a.applicationLevel) ||
    b.studentLevel.localeCompare(a.studentLevel)
  );
}

@Injectable({
  providedIn: 'root',
})
export class FindInstructorsService {
  private syncService = inject(IncrementalSyncService);

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
    // 1. Immediately populate from local cache if available (<20ms)
    this.syncService.loadCachedData('public_instructors', this.instructors, sortInstructors);

    // 2. Perform background incremental delta sync
    this.updateInstructorsSync();
  }

  async updateInstructorsSync(forceFullRefresh = false): Promise<void> {
    await this.syncService.syncCollection({
      cacheKey: 'public_instructors',
      collectionPath: 'instructors',
      idField: 'instructorId',
      targetSet: this.instructors,
      docConverter: firestoreDocToInstructorPublicData,
      sortFn: sortInstructors,
      forceFullRefresh,
    });
  }
}
