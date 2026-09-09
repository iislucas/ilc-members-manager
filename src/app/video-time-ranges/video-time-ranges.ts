/* video-time-ranges.ts
 *
 * Customer video time-range annotations and loop playback manager component.
 *
 * Features:
 * - List and view personal video time ranges sorted by start timestamp
 * - Add and edit time ranges with title, multiline description, and start/end timestamps
 * - "Use Current Time" buttons for capturing video playback position into form inputs
 * - Trigger normal seek to start or repeat loop playback between start and end
 * - Share time ranges: download <video-name>.time-ranges.json or copy JSON to clipboard
 * - Additive import from JSON files or text with smart deduplication
 * - Individual and batch deletion with confirmation modal
 */

import {
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VideoItem, VideoTimeRange } from '../../../functions/src/data-model/vod';
import { DataManagerService } from '../data-manager.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-video-time-ranges',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './video-time-ranges.html',
  styleUrl: './video-time-ranges.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoTimeRangesComponent implements OnInit {
  private dataService = inject(DataManagerService);

  // Inputs
  video = input.required<VideoItem>();
  currentPlayerTime = input<number>(0);
  activeLoopRange = input<{ startSeconds: number; endSeconds: number; name?: string } | null>(null);

  // Outputs
  playRange = output<{ range: VideoTimeRange; loop: boolean }>();
  stopLoop = output<void>();

  // State Signals
  ranges = signal<VideoTimeRange[]>([]);
  isLoading = signal(true);
  selectedIds = signal<Set<string>>(new Set());

  // Form Modal (Add / Edit)
  isFormOpen = signal(false);
  editingId = signal<string | null>(null); // null = creating new
  formName = signal('');
  formDescription = signal('');
  formStart = signal('');
  formEnd = signal('');
  formError = signal<string | null>(null);

  // Sharing & Export State
  showShareModal = signal(false);
  copiedToast = signal(false);

  // Import State
  showImportModal = signal(false);
  importJsonText = signal('');
  importFileError = signal<string | null>(null);
  importFeedback = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // Deletion Confirmation State
  showDeleteModal = signal(false);
  deleteTarget = signal<'selected' | 'all' | VideoTimeRange | null>(null);

  // Computed sorted ranges
  sortedRanges = computed(() => {
    return [...this.ranges()].sort((a, b) => a.startSeconds - b.startSeconds);
  });

  // Selected count
  selectedCount = computed(() => this.selectedIds().size);

  // All selected helper
  isAllSelected = computed(() => {
    const list = this.ranges();
    return list.length > 0 && this.selectedIds().size === list.length;
  });

  async ngOnInit(): Promise<void> {
    await this.loadRanges();
  }

  async loadRanges(): Promise<void> {
    this.isLoading.set(true);
    try {
      const items = await this.dataService.getVideoTimeRanges(this.video().docId);
      this.ranges.set(items);
    } catch (err) {
      console.warn('Could not load time ranges:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  async persistRanges(updated: VideoTimeRange[]): Promise<void> {
    this.ranges.set(updated);
    // Remove deleted IDs from selection
    const validIds = new Set(updated.map((r) => r.id));
    this.selectedIds.update((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });

    try {
      await this.dataService.saveVideoTimeRanges(this.video().docId, updated);
    } catch (err) {
      console.error('Failed to persist video time ranges:', err);
    }
  }

  // --- Playback & Loop Controls ---

  onPlayRange(range: VideoTimeRange): void {
    this.playRange.emit({ range, loop: false });
  }

  onToggleLoop(range: VideoTimeRange): void {
    if (this.isRangeLooping(range)) {
      this.stopLoop.emit();
    } else {
      this.playRange.emit({ range, loop: true });
    }
  }

  isRangeLooping(range: VideoTimeRange): boolean {
    const active = this.activeLoopRange();
    if (!active) return false;
    return (
      Math.abs(active.startSeconds - range.startSeconds) < 0.1 &&
      Math.abs(active.endSeconds - range.endSeconds) < 0.1
    );
  }

  // --- Add / Edit Form Modal ---

  openAddModal(): void {
    const curTime = this.currentPlayerTime();
    const dur = this.video().durationSeconds || 0;
    const defaultStart = curTime > 0 ? Math.floor(curTime) : 0;
    const defaultEnd = Math.min(dur > 0 ? dur : defaultStart + 30, defaultStart + 30);

    this.editingId.set(null);
    this.formName.set('');
    this.formDescription.set('');
    this.formStart.set(this.formatSecondsToTimeString(defaultStart));
    this.formEnd.set(this.formatSecondsToTimeString(defaultEnd));
    this.formError.set(null);
    this.isFormOpen.set(true);
  }

  openEditModal(range: VideoTimeRange): void {
    this.editingId.set(range.id);
    this.formName.set(range.name);
    this.formDescription.set(range.description || '');
    this.formStart.set(this.formatSecondsToTimeString(range.startSeconds));
    this.formEnd.set(this.formatSecondsToTimeString(range.endSeconds));
    this.formError.set(null);
    this.isFormOpen.set(true);
  }

  closeFormModal(): void {
    this.isFormOpen.set(false);
    this.formError.set(null);
  }

  setStartToCurrentTime(): void {
    const sec = Math.floor(this.currentPlayerTime());
    this.formStart.set(this.formatSecondsToTimeString(sec));
  }

  setEndToCurrentTime(): void {
    const sec = Math.floor(this.currentPlayerTime());
    this.formEnd.set(this.formatSecondsToTimeString(sec));
  }

  async submitForm(): Promise<void> {
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Please provide a name for this time range.');
      return;
    }

    const start = this.parseTimeToSeconds(this.formStart());
    const end = this.parseTimeToSeconds(this.formEnd());

    if (start === null) {
      this.formError.set('Start time must be formatted as MM:SS, HH:MM:SS, or seconds.');
      return;
    }
    if (end === null) {
      this.formError.set('End time must be formatted as MM:SS, HH:MM:SS, or seconds.');
      return;
    }
    if (start < 0) {
      this.formError.set('Start time cannot be negative.');
      return;
    }
    if (end <= start) {
      this.formError.set('End time must be greater than start time.');
      return;
    }

    const dur = this.video().durationSeconds || 0;
    if (dur > 0 && end > dur + 5) {
      this.formError.set(`End time exceeds video duration (${this.formatSecondsToTimeString(dur)}).`);
      return;
    }

    const now = new Date().toISOString();
    const currentList = this.ranges();
    const editId = this.editingId();

    if (editId) {
      // Update existing
      const updated = currentList.map((r) =>
        r.id === editId
          ? {
              ...r,
              name,
              description: this.formDescription().trim(),
              startSeconds: start,
              endSeconds: end,
              updatedAt: now,
            }
          : r,
      );
      await this.persistRanges(updated);
    } else {
      // Create new
      const newRange: VideoTimeRange = {
        id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        description: this.formDescription().trim(),
        startSeconds: start,
        endSeconds: end,
        createdAt: now,
        updatedAt: now,
      };
      await this.persistRanges([...currentList, newRange]);
    }

    this.closeFormModal();
  }

  // --- Selection & Batch Operations ---

  toggleSelectAll(): void {
    if (this.isAllSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(this.ranges().map((r) => r.id)));
    }
  }

  toggleSelect(id: string): void {
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  promptDeleteSelected(): void {
    if (this.selectedIds().size === 0) return;
    this.deleteTarget.set('selected');
    this.showDeleteModal.set(true);
  }

  promptDeleteAll(): void {
    if (this.ranges().length === 0) return;
    this.deleteTarget.set('all');
    this.showDeleteModal.set(true);
  }

  promptDeleteOne(range: VideoTimeRange): void {
    this.deleteTarget.set(range);
    this.showDeleteModal.set(true);
  }

  cancelDelete(): void {
    this.showDeleteModal.set(false);
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    let updated: VideoTimeRange[] = [];
    if (target === 'all') {
      updated = [];
    } else if (target === 'selected') {
      const toRemove = this.selectedIds();
      updated = this.ranges().filter((r) => !toRemove.has(r.id));
    } else {
      // Single range object
      updated = this.ranges().filter((r) => r.id !== target.id);
    }

    // If active loop is in the deleted set, stop looping
    const active = this.activeLoopRange();
    if (active) {
      const stillExists = updated.some(
        (r) =>
          Math.abs(r.startSeconds - active.startSeconds) < 0.1 &&
          Math.abs(r.endSeconds - active.endSeconds) < 0.1,
      );
      if (!stillExists) {
        this.stopLoop.emit();
      }
    }

    await this.persistRanges(updated);
    this.cancelDelete();
  }

  // --- Sharing & Export ---

  openShareModal(): void {
    this.copiedToast.set(false);
    this.showShareModal.set(true);
  }

  closeShareModal(): void {
    this.showShareModal.set(false);
  }

  getExportFilename(): string {
    const title = this.video().title || 'video';
    const safe = title
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `${safe || 'video'}.time-ranges.json`;
  }

  getExportPayload(): string {
    const payload = {
      version: 1,
      videoId: this.video().docId,
      videoTitle: this.video().title,
      exportedAt: new Date().toISOString(),
      timeRanges: this.sortedRanges().map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        startSeconds: r.startSeconds,
        endSeconds: r.endSeconds,
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  downloadJsonFile(): void {
    if (typeof window === 'undefined') return;
    const jsonStr = this.getExportPayload();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.getExportFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async copyJsonToClipboard(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(this.getExportPayload());
      this.copiedToast.set(true);
      setTimeout(() => this.copiedToast.set(false), 3000);
    } catch (err) {
      console.warn('Could not copy to clipboard:', err);
    }
  }

  // --- Additive Import with Deduplication ---

  openImportModal(): void {
    this.importJsonText.set('');
    this.importFileError.set(null);
    this.importFeedback.set(null);
    this.showImportModal.set(true);
  }

  closeImportModal(): void {
    this.showImportModal.set(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.importFileError.set(null);

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      this.importJsonText.set(content);
    };
    reader.onerror = () => {
      this.importFileError.set('Failed to read selected file.');
    };
    reader.readAsText(file);
    // Reset file input so user can pick the same file again if desired
    input.value = '';
  }

  async processImport(): Promise<void> {
    const raw = this.importJsonText().trim();
    if (!raw) {
      this.importFeedback.set({ type: 'error', message: 'Please paste JSON or choose a file.' });
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      this.importFeedback.set({
        type: 'error',
        message: `Invalid JSON format: ${err?.message || 'Syntax error'}`,
      });
      return;
    }

    // Extract list of ranges from various supported shapes
    let incomingList: any[] = [];
    if (Array.isArray(parsed)) {
      incomingList = parsed;
    } else if (Array.isArray(parsed.timeRanges)) {
      incomingList = parsed.timeRanges;
    } else if (Array.isArray(parsed.ranges)) {
      incomingList = parsed.ranges;
    } else {
      this.importFeedback.set({
        type: 'error',
        message: 'Could not find a list of time ranges in the imported JSON.',
      });
      return;
    }

    if (incomingList.length === 0) {
      this.importFeedback.set({
        type: 'error',
        message: 'The imported file contains no time ranges.',
      });
      return;
    }

    const currentRanges = this.ranges();
    const existingIds = new Set(currentRanges.map((r) => r.id));
    const now = new Date().toISOString();

    let addedCount = 0;
    let duplicateCount = 0;
    const newRangesToAdd: VideoTimeRange[] = [];

    for (const item of incomingList) {
      const name = (item.name || item.title || item.label || '').trim();
      const start = this.parseTimeToSeconds(item.startSeconds ?? item.startTime ?? item.start ?? 0);
      const end = this.parseTimeToSeconds(item.endSeconds ?? item.endTime ?? item.end ?? 0);

      if (!name || start === null || end === null || end <= start) {
        // Skip invalid items
        continue;
      }

      // Duplicate detection:
      // 1. Same id (if id exists in existing)
      // 2. OR same normalized name + startSeconds + endSeconds (within 0.5s tolerance)
      const isDuplicate =
        (item.id && existingIds.has(item.id)) ||
        currentRanges.some(
          (e) =>
            e.name.trim().toLowerCase() === name.toLowerCase() &&
            Math.abs(e.startSeconds - start) < 0.5 &&
            Math.abs(e.endSeconds - end) < 0.5,
        ) ||
        newRangesToAdd.some(
          (e) =>
            e.name.trim().toLowerCase() === name.toLowerCase() &&
            Math.abs(e.startSeconds - start) < 0.5 &&
            Math.abs(e.endSeconds - end) < 0.5,
        );

      if (isDuplicate) {
        duplicateCount++;
      } else {
        const newRange: VideoTimeRange = {
          id: item.id && !existingIds.has(item.id)
            ? item.id
            : `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          description: (item.description || item.desc || item.notes || '').trim(),
          startSeconds: start,
          endSeconds: end,
          createdAt: item.createdAt || now,
          updatedAt: item.updatedAt || now,
        };
        newRangesToAdd.push(newRange);
        addedCount++;
      }
    }

    if (addedCount === 0 && duplicateCount > 0) {
      this.importFeedback.set({
        type: 'error',
        message: `All ${duplicateCount} item(s) are already in your annotations. None added.`,
      });
      return;
    }

    if (addedCount === 0) {
      this.importFeedback.set({
        type: 'error',
        message: 'No valid time ranges could be imported.',
      });
      return;
    }

    // Additively merge and persist
    await this.persistRanges([...currentRanges, ...newRangesToAdd]);

    this.importFeedback.set({
      type: 'success',
      message: `Successfully imported ${addedCount} new range(s).${
        duplicateCount > 0 ? ` (${duplicateCount} duplicate(s) skipped)` : ''
      }`,
    });

    // Auto-close modal after brief delay
    setTimeout(() => {
      this.closeImportModal();
    }, 1500);
  }

  // --- Time Helpers ---

  formatSecondsToTimeString(totalSeconds: number): string {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const rounded = Math.round(totalSeconds);
    const hrs = Math.floor(rounded / 3600);
    const mins = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    const mm = mins.toString().padStart(2, '0');
    const ss = secs.toString().padStart(2, '0');

    if (hrs > 0) {
      return `${hrs}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }

  formatRangeInterval(range: VideoTimeRange): string {
    const s = this.formatSecondsToTimeString(range.startSeconds);
    const e = this.formatSecondsToTimeString(range.endSeconds);
    const diff = Math.max(0, Math.round(range.endSeconds - range.startSeconds));
    return `${s} – ${e} (${this.formatDuration(diff)})`;
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
  }

  parseTimeToSeconds(val: string | number): number | null {
    if (typeof val === 'number') {
      return isNaN(val) ? null : val;
    }
    if (!val || typeof val !== 'string') return null;

    const clean = val.trim();
    if (!clean) return null;

    // Direct numeric seconds e.g. "125" or "125.5"
    if (/^\d+(\.\d+)?$/.test(clean)) {
      return parseFloat(clean);
    }

    // HH:MM:SS or MM:SS
    const parts = clean.split(':').map((p) => parseFloat(p));
    if (parts.some((n) => isNaN(n))) return null;

    if (parts.length === 2) {
      // MM:SS
      const [m, s] = parts;
      return m * 60 + s;
    } else if (parts.length === 3) {
      // HH:MM:SS
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    }

    return null;
  }
}
