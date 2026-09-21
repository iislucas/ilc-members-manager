/* find-instructors.service.ts
 *
 * Public instructors catalog service.
 *
 * Uses SyncedCollection to load the public instructors directory
 * instantly from IndexedDB cache on app startup, and synchronize only
 * modified or deleted instructors from Firestore in the background.
 */

import { inject, Injectable } from '@angular/core';
import { InstructorPublicData, firestoreDocToInstructorPublicData } from '../../functions/src/data-model/members';
import { SyncedCollection } from './synced-collection';
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

  public instructors = new SyncedCollection<'instructorId', InstructorPublicData>({
    collectionPath: 'instructors',
    cacheKey: 'public_instructors',
    idField: 'instructorId',
    searchFields: [
      'memberId',
      'instructorId',
      'name',
      'publicEmail',
      'publicRegionOrCity',
      'publicPhone',
      'country',
      'tags',
    ],
    docConverter: firestoreDocToInstructorPublicData,
    sortFn: sortInstructors,
    syncService: this.syncService,
  });

  constructor() {
    // 1. Immediately populate from local cache if available (<20ms)
    this.instructors.loadCache();

    // 2. Perform background incremental delta sync
    this.updateInstructorsSync();
  }

  async updateInstructorsSync(forceFullRefresh = false): Promise<void> {
    await this.instructors.sync(forceFullRefresh);
  }
}
