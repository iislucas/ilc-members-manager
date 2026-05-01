/* resources.ts
 *
 * Settings tab component for managing resource files (PDFs, documents, etc.)
 * stored in Firebase Storage. Provides upload, listing, download, and delete
 * functionality. Admin-only.
 *
 * Files are uploaded into access-level subdirectories (public, members,
 * instructors, school-owners, admins) which control who can read them via
 * Firebase Storage rules.
 *
 * Upload is done client-side via the Firebase Storage SDK. Listing and
 * deletion go through callable Cloud Functions (listResources, deleteResource)
 * to leverage admin-signed download URLs.
 */

import { Component, computed, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { IconComponent } from '../../icons/icon.component';
import { getStorage, ref, uploadBytes } from 'firebase/storage';
import { DatePipe } from '@angular/common';
import {
  ResourceAccessLevel,
  RESOURCE_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_DESCRIPTIONS,
} from '../../../../functions/src/data-model';

/** Descriptive section headers for each access level file group. */
const ACCESS_LEVEL_FILE_HEADERS: Record<ResourceAccessLevel, string> = {
  [ResourceAccessLevel.Public]: 'Public Files',
  [ResourceAccessLevel.Members]: 'Member Files',
  [ResourceAccessLevel.Instructors]: 'Instructor Files',
  [ResourceAccessLevel.SchoolOwners]: 'School Owner Files',
  [ResourceAccessLevel.Admins]: 'Admin Files',
};

/** Who can access each tier, shown as a subtitle. */
const ACCESS_LEVEL_AUDIENCE: Record<ResourceAccessLevel, string> = {
  [ResourceAccessLevel.Public]: 'Anyone — no login required',
  [ResourceAccessLevel.Members]: 'Active members, instructors & admins',
  [ResourceAccessLevel.Instructors]: 'Licensed instructors & admins',
  [ResourceAccessLevel.SchoolOwners]: 'School owners/managers & admins',
  [ResourceAccessLevel.Admins]: 'Admins only',
};

// Matches the shape returned by the listResources Cloud Function.
interface ResourceFile {
  name: string;
  fullPath: string;
  contentType: string;
  timeCreated: string;
  size: string;
  accessLevel: ResourceAccessLevel;
}

interface ResourceGroup {
  level: ResourceAccessLevel;
  header: string;
  audience: string;
  files: ResourceFile[];
}

@Component({
  selector: 'app-resources',
  standalone: true,
  imports: [SpinnerComponent, DatePipe, IconComponent],
  templateUrl: './resources.html',
  styleUrl: './resources.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourcesComponent implements OnInit {
  private dataManager = inject(DataManagerService);
  private firebaseApp = inject(FIREBASE_APP);

  resources = signal<ResourceFile[]>([]);
  isLoading = signal(false);
  isUploading = signal(false);
  statusMessage = signal('');
  errorMessage = signal('');
  openMenuId = signal<string | null>(null);
  menuPosition = signal<{ top: string; left: string }>({ top: '0', left: '0' });
  uploadExpanded = signal(false);
  downloadingId = signal<string | null>(null);

  // The currently selected access level for uploads.
  selectedAccessLevel = signal<ResourceAccessLevel>(ResourceAccessLevel.Members);

  /** Resources grouped by access level, only including levels that have files. */
  resourceGroups = computed<ResourceGroup[]>(() => {
    const all = this.resources();
    const byLevel = new Map<ResourceAccessLevel, ResourceFile[]>();
    for (const r of all) {
      const list = byLevel.get(r.accessLevel) || [];
      list.push(r);
      byLevel.set(r.accessLevel, list);
    }
    // Return groups in the canonical RESOURCE_ACCESS_LEVELS order.
    return RESOURCE_ACCESS_LEVELS
      .filter(level => byLevel.has(level))
      .map(level => ({
        level,
        header: ACCESS_LEVEL_FILE_HEADERS[level],
        audience: ACCESS_LEVEL_AUDIENCE[level],
        files: byLevel.get(level)!,
      }));
  });

  // Expose constants to the template.
  readonly accessLevels = RESOURCE_ACCESS_LEVELS;
  readonly accessLevelLabels = ACCESS_LEVEL_LABELS;
  readonly accessLevelDescriptions = ACCESS_LEVEL_DESCRIPTIONS;

  ngOnInit() {
    this.loadResources();
  }

  async loadResources() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const list = await this.dataManager.listResources();
      this.resources.set(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Error loading resources: ${message}`);
    } finally {
      this.isLoading.set(false);
    }
  }

  onAccessLevelChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedAccessLevel.set(select.value as ResourceAccessLevel);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    this.isUploading.set(true);
    this.statusMessage.set('');
    this.errorMessage.set('');

    try {
      const storage = getStorage(this.firebaseApp);
      const accessLevel = this.selectedAccessLevel();
      const storageRef = ref(storage, `resources/${accessLevel}/${file.name}`);
      await uploadBytes(storageRef, file);
      this.statusMessage.set(`Uploaded "${file.name}" with ${this.accessLabel(accessLevel)} access.`);
      await this.loadResources();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Upload failed: ${message}`);
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }

  async deleteResource(resource: ResourceFile) {
    if (!confirm(`Are you sure you want to delete "${resource.name}"?`)) return;

    this.statusMessage.set('');
    this.errorMessage.set('');
    try {
      await this.dataManager.deleteResource(resource.fullPath);
      this.statusMessage.set(`Deleted "${resource.name}".`);
      await this.loadResources();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Failed to delete: ${message}`);
    }
  }

  // Returns a human-readable label for a given access level string.
  accessLabel(level: string): string {
    return ACCESS_LEVEL_LABELS[level as ResourceAccessLevel] || level;
  }

  // Formats byte count into a human-readable string.
  formatSize(sizeStr: string): string {
    const bytes = parseInt(sizeStr, 10);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  // Returns a CSS class for the access level chip.
  accessLevelClass(level: string): string {
    const prefix = 'access-';
    if (RESOURCE_ACCESS_LEVELS.includes(level as ResourceAccessLevel)) {
      return prefix + level;
    }
    return prefix + 'unknown';
  }

  toggleMenu(id: string, event: Event) {
    event.stopPropagation();
    if (this.openMenuId() === id) {
      this.openMenuId.set(null);
      return;
    }
    const btn = (event.currentTarget as HTMLElement);
    const rect = btn.getBoundingClientRect();
    this.menuPosition.set({
      top: `${rect.bottom + 4}px`,
      left: `${rect.right - 160}px`, // 160px = min-width of menu; right-align
    });
    this.openMenuId.set(id);
  }

  // Fetches a signed download URL on-demand and opens it in a new tab.
  async downloadResource(resource: ResourceFile) {
    if (this.downloadingId()) return;
    this.downloadingId.set(resource.fullPath);
    this.openMenuId.set(null);
    try {
      const url = await this.dataManager.getResourceDownloadUrl(resource.fullPath);
      window.open(url, '_blank');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Download failed: ${message}`);
    } finally {
      this.downloadingId.set(null);
    }
  }

  // Copies the stable download URL (#/resources/{level}/{name}) to the clipboard.
  async copyDownloadLink(resource: ResourceFile) {
    const url = `${window.location.origin}${window.location.pathname}#/resources/${resource.accessLevel}/${resource.name}`;
    try {
      await navigator.clipboard.writeText(url);
      this.statusMessage.set(`Copied download link for "${resource.name}" to clipboard.`);
    } catch {
      this.errorMessage.set('Failed to copy link to clipboard.');
    }
  }
}
