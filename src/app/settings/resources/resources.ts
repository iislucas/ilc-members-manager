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

import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { getStorage, ref, uploadBytes } from 'firebase/storage';
import { DatePipe } from '@angular/common';
import {
  ResourceAccessLevel,
  RESOURCE_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_DESCRIPTIONS,
} from '../../../../functions/src/data-model';

// Matches the shape returned by the listResources Cloud Function.
interface ResourceFile {
  name: string;
  fullPath: string;
  contentType: string;
  timeCreated: string;
  size: string;
  downloadUrl: string;
  accessLevel: ResourceAccessLevel;
}

@Component({
  selector: 'app-resources',
  standalone: true,
  imports: [SpinnerComponent, DatePipe],
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

  // The currently selected access level for uploads.
  selectedAccessLevel = signal<ResourceAccessLevel>(ResourceAccessLevel.Members);

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

  // Returns a CSS class name based on the file's content type.
  fileTypeClass(contentType: string): string {
    if (contentType.includes('pdf')) return 'file-pdf';
    if (contentType.includes('image')) return 'file-image';
    if (contentType.includes('video')) return 'file-video';
    if (contentType.includes('word') || contentType.includes('document')) return 'file-doc';
    if (contentType.includes('spreadsheet') || contentType.includes('excel')) return 'file-sheet';
    return 'file-generic';
  }

  // Returns a CSS class for the access level chip.
  accessLevelClass(level: string): string {
    const prefix = 'access-';
    if (RESOURCE_ACCESS_LEVELS.includes(level as ResourceAccessLevel)) {
      return prefix + level;
    }
    return prefix + 'unknown';
  }
}
