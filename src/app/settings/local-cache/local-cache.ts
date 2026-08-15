import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import {
  CachedCollectionSummary,
  IncrementalSyncService,
} from '../../incremental-sync.service';
import { DataManagerService } from '../../data-manager.service';
import { FindInstructorsService } from '../../find-instructors.service';
import { FirebaseStateService } from '../../firebase-state.service';

interface CollectionDetail {
  summary: CachedCollectionSummary;
  rawJson?: string;
  entries?: unknown[];
  isExpanded?: boolean;
}

@Component({
  selector: 'app-local-cache',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './local-cache.html',
  styleUrls: ['./local-cache.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocalCacheSettingsComponent implements OnInit {
  private syncService = inject(IncrementalSyncService);
  private dataManager = inject(DataManagerService);
  private findInstructors = inject(FindInstructorsService);
  private firebaseState = inject(FirebaseStateService);

  isLoading = signal(true);
  isActionRunning = signal(false);
  statusMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  // Summaries of all cached collections
  collections = signal<CollectionDetail[]>([]);

  // Raw inspector state
  expandedKey = signal<string | null>(null);
  rawRecords = signal<unknown[]>([]);
  rawSearchQuery = signal('');
  copiedKey = signal<string | null>(null);

  // Online / Offline status
  isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Filtered raw records based on search query
  filteredRawRecords = computed(() => {
    const q = this.rawSearchQuery().trim().toLowerCase();
    const records = this.rawRecords();
    if (!q) return records;
    return records.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  });

  // Total cached record count across all collections
  totalCachedRecords = computed(() => {
    return this.collections().reduce((sum, c) => sum + c.summary.count, 0);
  });

  // Total storage size in bytes
  totalSizeBytes = computed(() => {
    return this.collections().reduce((sum, c) => sum + c.summary.approximateSizeBytes, 0);
  });

  ngOnInit() {
    this.refreshSummaries();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.isOnline.set(true));
      window.addEventListener('offline', () => this.isOnline.set(false));
    }
  }

  async refreshSummaries(keepStatus = false) {
    this.isLoading.set(true);
    if (!keepStatus) {
      this.statusMessage.set(null);
    }
    this.errorMessage.set(null);
    try {
      const summaries = await this.syncService.getAllCachedCollectionSummaries();
      this.collections.set(
        summaries.map((s) => ({
          summary: s,
          isExpanded: this.expandedKey() === s.cacheKey,
        })),
      );
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  async toggleInspectRaw(key: string) {
    if (this.expandedKey() === key) {
      this.expandedKey.set(null);
      this.rawRecords.set([]);
      this.rawSearchQuery.set('');
      return;
    }

    this.expandedKey.set(key);
    this.rawSearchQuery.set('');
    try {
      const bundle = await this.syncService.getCachedBundle(key);
      this.rawRecords.set(bundle?.entries || []);
    } catch (err) {
      this.errorMessage.set(`Failed reading raw data for ${key}: ${err}`);
      this.rawRecords.set([]);
    }
  }

  async copyRawJson(key: string) {
    try {
      const bundle = await this.syncService.getCachedBundle(key);
      const json = JSON.stringify(bundle?.entries || [], null, 2);
      await navigator.clipboard.writeText(json);
      this.copiedKey.set(key);
      setTimeout(() => this.copiedKey.set(null), 2500);
    } catch (err) {
      this.errorMessage.set(`Failed to copy JSON: ${err}`);
    }
  }

  async syncSingleCollection(key: string) {
    this.isActionRunning.set(true);
    this.statusMessage.set(null);
    this.errorMessage.set(null);

    const user = this.firebaseState.user();

    try {
      if (key === 'public_instructors') {
        await this.findInstructors.updateInstructorsSync();
      } else if (key === 'schools') {
        await this.dataManager.updateSchoolsSync();
      } else if (key.startsWith('members_admin_') || key.startsWith('school_members_')) {
        if (user) {
          await this.dataManager.updateMembersSync(user);
        }
      } else if (key.startsWith('my_students_')) {
        if (user) {
          await this.dataManager.updateMyStudentsSync(user);
        }
      } else {
        if (user) {
          await this.dataManager.forceRefreshAllData(user);
        }
      }
      this.statusMessage.set(`Successfully synced ${key}`);
      await this.refreshSummaries(true);
      if (this.expandedKey() === key) {
        const bundle = await this.syncService.getCachedBundle(key);
        this.rawRecords.set(bundle?.entries || []);
      }
    } catch (err) {
      this.errorMessage.set(`Failed syncing ${key}: ${err}`);
    } finally {
      this.isActionRunning.set(false);
    }
  }

  async clearSingleCollection(key: string) {
    if (!confirm(`Are you sure you want to clear local cache for "${key}"?`)) {
      return;
    }

    this.isActionRunning.set(true);
    try {
      await this.syncService.clearCache(key);
      if (this.expandedKey() === key) {
        this.expandedKey.set(null);
        this.rawRecords.set([]);
      }
      this.statusMessage.set(`Cleared cache for ${key}`);
      await this.refreshSummaries(true);
    } catch (err) {
      this.errorMessage.set(`Failed clearing ${key}: ${err}`);
    } finally {
      this.isActionRunning.set(false);
    }
  }

  async forceRefreshAll() {
    this.isActionRunning.set(true);
    this.statusMessage.set('Fetching all collections from Firestore...');
    this.errorMessage.set(null);

    const user = this.firebaseState.user();

    try {
      const promises: Promise<unknown>[] = [this.findInstructors.updateInstructorsSync(true)];
      if (user) {
        promises.push(this.dataManager.forceRefreshAllData(user));
      } else {
        promises.push(this.dataManager.updateSchoolsSync(true));
      }
      await Promise.all(promises);

      this.statusMessage.set('All collections refreshed and persisted to local IndexedDB!');
      await this.refreshSummaries(true);
      if (this.expandedKey()) {
        const bundle = await this.syncService.getCachedBundle(this.expandedKey()!);
        this.rawRecords.set(bundle?.entries || []);
      }
    } catch (err) {
      this.errorMessage.set(`Refresh failed: ${err}`);
    } finally {
      this.isActionRunning.set(false);
    }
  }

  async clearAll() {
    if (!confirm('Are you sure you want to clear ALL locally cached data? Data will be re-fetched on next visit.')) {
      return;
    }

    this.isActionRunning.set(true);
    this.statusMessage.set(null);
    try {
      await this.dataManager.clearAllLocalCaches();
      this.expandedKey.set(null);
      this.rawRecords.set([]);
      this.statusMessage.set('All local cache cleared.');
      await this.refreshSummaries(true);
    } catch (err) {
      this.errorMessage.set(`Failed clearing cache: ${err}`);
    } finally {
      this.isActionRunning.set(false);
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  formatDate(isoString: string): string {
    if (!isoString || isoString === 'Unknown') return 'Never';
    try {
      const d = new Date(isoString);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return isoString;
    }
  }

  friendlyCollectionName(key: string): string {
    if (key === 'public_instructors') return 'Public Instructors Directory';
    if (key === 'schools') return 'Schools Directory';
    if (key.startsWith('members_admin_')) return 'Admin Members Directory';
    if (key.startsWith('school_members_')) return 'School Members Roster';
    if (key.startsWith('my_students_')) return 'Instructor Students Roster';
    return key;
  }
}
