/* manage-video-tags.ts
 *
 * Admin page for managing system video tags (viewing list with usage counts,
 * adding new tags, editing metadata/descriptions, renaming, and deleting).
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  VideoTagMeta,
  initVideoTagMeta,
} from '../../../functions/src/data-model';

export interface TagRowItem {
  tag: string;
  label: string;
  description: string;
  videoCount: number;
  lastUpdated: string;
  isRegistered: boolean;
}

@Component({
  selector: 'app-manage-video-tags',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './manage-video-tags.html',
  styleUrl: './manage-video-tags.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVideoTagsComponent {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  readonly Views = Views;

  // Search & Filter
  searchQuery = signal('');

  // Add Modal State
  isAddModalOpen = signal(false);
  newTagSlug = signal('');
  newTagLabel = signal('');
  newTagDescription = signal('');

  // Edit / Rename Modal State
  editingTag = signal<VideoTagMeta | null>(null);
  originalTagSlug = signal('');
  editTagSlug = signal('');
  editTagLabel = signal('');
  editTagDescription = signal('');

  // Delete Confirmation State
  deletingTagSlug = signal<string | null>(null);

  // Status & Loading
  isSaving = signal(false);
  statusMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  // Computed tag rows with video usage counts
  tagRows = computed<TagRowItem[]>(() => {
    const docMap = this.dataService.tagsDoc();
    const docKeys = Object.keys(docMap);

    // Count usages across videos
    const usageCounts = new Map<string, number>();
    for (const v of this.dataService.videos.entries()) {
      if (v.tags) {
        for (const t of v.tags) {
          const norm = t.trim().toLowerCase();
          usageCounts.set(norm, (usageCounts.get(norm) || 0) + 1);
        }
      }
    }

    // Collect all known tags (from doc + videos)
    const allTagKeys = Array.from(
      new Set([...docKeys, ...Array.from(usageCounts.keys())]),
    ).sort((a, b) => a.localeCompare(b));

    const rows: TagRowItem[] = allTagKeys.map((key) => {
      const meta = docMap[key];
      return {
        tag: key,
        label: meta?.label || key,
        description: meta?.description || '',
        videoCount: usageCounts.get(key) || 0,
        lastUpdated: meta?.lastUpdated || '',
        isRegistered: Boolean(meta),
      };
    });

    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return rows;

    return rows.filter(
      (r) =>
        r.tag.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  });

  stats = computed(() => {
    const all = this.tagRows();
    const total = all.length;
    const withDescriptions = all.filter((r) => Boolean(r.description)).length;
    const inUse = all.filter((r) => r.videoCount > 0).length;
    return { total, withDescriptions, inUse };
  });

  // Modal actions
  openAddModal() {
    this.newTagSlug.set('');
    this.newTagLabel.set('');
    this.newTagDescription.set('');
    this.errorMessage.set(null);
    this.isAddModalOpen.set(true);
  }

  closeAddModal() {
    this.isAddModalOpen.set(false);
  }

  openEditModal(row: TagRowItem) {
    const meta = this.dataService.getTagMeta(row.tag) || initVideoTagMeta(row.tag, row.description, row.label);
    this.editingTag.set(meta);
    this.originalTagSlug.set(row.tag);
    this.editTagSlug.set(row.tag);
    this.editTagLabel.set(row.label);
    this.editTagDescription.set(row.description);
    this.errorMessage.set(null);
  }

  closeEditModal() {
    this.editingTag.set(null);
  }

  confirmDelete(tagSlug: string) {
    this.deletingTagSlug.set(tagSlug);
  }

  cancelDelete() {
    this.deletingTagSlug.set(null);
  }

  async saveNewTag() {
    const cleanSlug = this.newTagSlug().trim().replace(/^#+/, '').trim().toLowerCase();
    if (!cleanSlug) {
      this.errorMessage.set('Please provide a valid tag slug (e.g. "spinning_hands").');
      return;
    }

    const cleanLabel = this.newTagLabel().trim() || cleanSlug;
    const cleanDesc = this.newTagDescription().trim();

    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      const meta = initVideoTagMeta(cleanSlug, cleanDesc, cleanLabel);
      await this.dataService.saveVideoTagMeta(meta);
      this.closeAddModal();
      this.showToast(`Tag #${cleanSlug} created successfully.`);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to create tag.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveTagEdits() {
    const oldSlug = this.originalTagSlug().trim().toLowerCase();
    const newSlug = this.editTagSlug().trim().replace(/^#+/, '').trim().toLowerCase();

    if (!newSlug) {
      this.errorMessage.set('Tag slug cannot be empty.');
      return;
    }

    const label = this.editTagLabel().trim() || newSlug;
    const description = this.editTagDescription().trim();

    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      if (oldSlug !== newSlug) {
        // Rename tag across system doc and all referencing videos
        const res = await this.dataService.renameVideoTag(oldSlug, newSlug, {
          label,
          description,
        });
        this.showToast(
          `Renamed #${oldSlug} to #${newSlug} (${res.updatedVideos} video(s) updated).`,
        );
      } else {
        // Update label & description
        await this.dataService.saveVideoTagMeta({
          tag: oldSlug,
          label,
          description,
          lastUpdated: new Date().toISOString(),
        });
        this.showToast(`Updated metadata for #${oldSlug}.`);
      }
      this.closeEditModal();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to update tag.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async executeDelete() {
    const slug = this.deletingTagSlug();
    if (!slug) return;

    this.isSaving.set(true);
    try {
      await this.dataService.deleteVideoTag(slug);
      this.showToast(`Deleted tag #${slug} from registered tags.`);
      this.cancelDelete();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to delete tag.');
    } finally {
      this.isSaving.set(false);
    }
  }

  private showToast(msg: string) {
    this.statusMessage.set(msg);
    setTimeout(() => {
      if (this.statusMessage() === msg) {
        this.statusMessage.set(null);
      }
    }, 4000);
  }
}
