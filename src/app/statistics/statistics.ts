/* statistics.ts
 *
 * Admin-only statistics dashboard that displays monthly membership statistics.
 * Statistics are fetched from the Firestore `statistics` collection and can
 * be manually recomputed via a callable Cloud Function.
 */
import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FirebaseStateService } from '../firebase-state.service';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  getDocs,
  limit,
} from 'firebase/firestore';
import { MemberStatistics, firestoreDocToStatistics, Histogram } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { DatePipe } from '@angular/common';

// Sorted histogram entry for display.
export type HistogramEntry = { key: string; value: number };

// Sorts a histogram by value descending, returning an array of entries.
function sortedHistogram(histogram: Histogram): HistogramEntry[] {
  return Object.entries(histogram)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

@Component({
  selector: 'app-statistics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent, DatePipe],
  templateUrl: './statistics.html',
  styleUrl: './statistics.scss',
})
export class StatisticsComponent {
  private firebaseService = inject(FirebaseStateService);
  private db = getFirestore(this.firebaseService.app);
  private functions = getFunctions(this.firebaseService.app);

  protected loading = signal(true);
  protected computing = signal(false);
  protected error = signal<string | null>(null);
  protected stats = signal<MemberStatistics | null>(null);
  protected allStats = signal<MemberStatistics[]>([]);
  protected selectedIndex = signal(0);

  protected selectedStats = computed(() => {
    const all = this.allStats();
    const idx = this.selectedIndex();
    return all.length > 0 ? all[idx] : null;
  });

  // Computed sorted histograms for the selected statistics snapshot.
  protected membershipTypeEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.membershipTypeHistogram ?? {}),
  );
  protected studentLevelEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.studentLevelHistogram ?? {}),
  );
  protected applicationLevelEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.applicationLevelHistogram ?? {}),
  );
  protected instructorLicenseTypeEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.instructorLicenseTypeHistogram ?? {}),
  );
  protected countryEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.countryHistogram ?? {}),
  );
  protected mastersLevelEntries = computed(() =>
    sortedHistogram(this.selectedStats()?.mastersLevelHistogram ?? {}),
  );

  constructor() {
    this.loadStatistics();
  }

  async loadStatistics() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const q = query(
        collection(this.db, 'statistics'),
        orderBy('date', 'desc'),
        limit(24),
      );
      const snapshot = await getDocs(q);
      const statsList = snapshot.docs.map((doc) => firestoreDocToStatistics(doc as never));
      this.allStats.set(statsList);
      this.selectedIndex.set(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Error loading statistics:', msg);
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  async computeNow() {
    this.computing.set(true);
    this.error.set(null);
    try {
      const callable = httpsCallable(this.functions, 'manualComputeStatistics');
      await callable();
      await this.loadStatistics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Error computing statistics:', msg);
      this.error.set(msg);
    } finally {
      this.computing.set(false);
    }
  }

  selectSnapshot(index: number) {
    this.selectedIndex.set(index);
  }

  // Returns the max value from a histogram entry array (for bar width scaling).
  maxValue(entries: HistogramEntry[]): number {
    if (entries.length === 0) return 1;
    return Math.max(...entries.map((e) => e.value));
  }
}
