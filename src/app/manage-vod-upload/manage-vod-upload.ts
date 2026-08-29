/* manage-vod-upload.ts
 *
 * Dedicated admin console for uploading single videos or creating multi-part
 * video series collections with a unified price, metadata, and automated transcoding.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
  UploadItem,
  UploadItemSource,
  InstructorPublicData,
  IlcEvent,
  TagItem,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { TagInputComponent } from '../tag-input/tag-input';
import { SearchableSet } from '../searchable-set';
import { makeThumbnail } from '../utils';

export interface UploadFileEntry {
  id: string;
  file: File;
  title: string;
  partIndex: number;
  description: string;
  durationSeconds: number;
  previewUrl: string;
  previewBlob: Blob | null;
  status: 'idle' | 'uploading' | 'transcoding' | 'done' | 'error';
  progressPercent: number;
  errorMessage?: string;
  createdVideoId?: string;
}

@Component({
  selector: 'app-manage-vod-upload',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    TagInputComponent,
  ],
  templateUrl: './manage-vod-upload.html',
  styleUrl: './manage-vod-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodUploadComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  readonly Views = Views;
  readonly VodAccessTier = VodAccessTier;

  // Upload Mode: new series, existing series, or standalone single video
  uploadMode = signal<'new_series' | 'existing_series' | 'standalone'>('new_series');

  // Series / Collection Metadata
  seriesTitle = signal('');
  seriesDescription = signal('');
  seriesPriceDollars = signal<number | null>(49.99);
  existingSeriesId = signal('');
  selectedAccessTiers = signal<VodAccessTier[]>([
    VodAccessTier.MembersOnly,
    VodAccessTier.DirectPurchase,
  ]);
  isFeatured = signal(false);

  // Instructor & Event Credits
  selectedInstructorDocId = signal('');
  selectedInstructorId = signal('');
  selectedInstructorName = signal('');
  instructorSearchInput = signal('');

  selectedEventDocId = signal('');
  selectedEventTitle = signal('');
  eventSearchInput = signal('');

  recordedDate = signal(new Date().toISOString().split('T')[0]);
  location = signal('');
  tags = signal<string[]>([]);

  // Quality & Transcoding Presets
  selectedQualityPreset = signal<'full' | '4k' | 'hd' | 'light'>('full');
  selectedResolutions = signal<string[]>(['1080p', '720p', '480p', '360p']);

  // Selected Video Files List
  fileEntries = signal<UploadFileEntry[]>([]);
  isDraggingOver = signal(false);

  // Upload & Transcoding Progress State
  isProcessing = signal(false);
  currentFileIndex = signal(0);
  overallProgressPercent = signal(0);
  uploadComplete = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Available access tiers
  readonly availableAccessTiers = [
    { value: VodAccessTier.Public, label: 'Public (Free to everyone)', description: 'Accessible without sign in' },
    { value: VodAccessTier.MembersOnly, label: 'Members', description: 'Active members & instructors' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors Only', description: 'Licensed ILC instructors' },
    { value: VodAccessTier.ClassVideoSubscribers, label: 'Class Video Subscribers', description: 'Class video subscribers' },
    { value: VodAccessTier.DirectPurchase, label: 'Direct Purchase', description: 'Available for one-off purchase' },
  ];

  // Autocomplete Sets
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventDisplayFns: DisplayFns<IlcEvent> = {
    toChipId: (e) => e.docId,
    toName: (e) => `${e.title}${e.start ? ' (' + e.start.split('T')[0] + ')' : ''}`,
  };

  instructorDisplayFns: DisplayFns<InstructorPublicData> = {
    toChipId: (i) => i.instructorId,
    toName: (i) => (i.instructorId ? `${i.name} [${i.instructorId}]` : i.name),
  };

  // Available series from active catalog
  availableSeries = computed<VideoSeries[]>(() => {
    return this.dataService.getVideoSeriesList();
  });

  // Total summary of selected files
  totalSelectedDurationSeconds = computed(() => {
    return this.fileEntries().reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
  });

  totalSelectedSizeBytes = computed(() => {
    return this.fileEntries().reduce((sum, e) => sum + (e.file.size || 0), 0);
  });

  ngOnInit(): void {
    // Load events into autocomplete set
    this.dataService.getRecentEvents(100).then((events: IlcEvent[]) => {
      this.eventsSet.setEntries(events);
    });
  }

  // --- Mode & Quality Helpers ---
  setUploadMode(mode: 'new_series' | 'existing_series' | 'standalone'): void {
    this.uploadMode.set(mode);
    if (mode === 'standalone' && this.fileEntries().length > 0) {
      // Re-index
      this.recalculatePartIndices();
    }
  }

  onExistingSeriesSelected(seriesId: string): void {
    this.existingSeriesId.set(seriesId);
    const series = this.availableSeries().find((s) => s.seriesId === seriesId);
    if (series) {
      this.seriesTitle.set(series.title);
      this.seriesDescription.set(series.description);
      if (typeof series.priceCents === 'number') {
        this.seriesPriceDollars.set(series.priceCents / 100);
      }
      if (series.tags && series.tags.length > 0) {
        this.tags.set([...series.tags]);
      }
      if (series.instructorDocId) {
        this.selectedInstructorDocId.set(series.instructorDocId);
        this.selectedInstructorName.set(series.instructorName || '');
        this.selectedInstructorId.set(series.instructorId || '');
      }
      if (series.location) {
        this.location.set(series.location);
      }
      this.recalculatePartIndices();
    }
  }

  setQualityPreset(preset: 'full' | '4k' | 'hd' | 'light'): void {
    this.selectedQualityPreset.set(preset);
    switch (preset) {
      case 'full':
        this.selectedResolutions.set(['1080p', '720p', '480p', '360p']);
        break;
      case '4k':
        this.selectedResolutions.set(['2160p (4K)', '1080p', '720p', '480p']);
        break;
      case 'hd':
        this.selectedResolutions.set(['1080p', '720p']);
        break;
      case 'light':
        this.selectedResolutions.set(['720p', '480p', '360p']);
        break;
    }
  }

  toggleAccessTier(tier: VodAccessTier): void {
    this.selectedAccessTiers.update((tiers) => {
      if (tiers.includes(tier)) {
        return tiers.filter((t) => t !== tier);
      } else {
        return [...tiers, tier];
      }
    });
  }

  // --- Autocomplete Handlers ---
  onInstructorSelected(inst: InstructorPublicData): void {
    this.selectedInstructorDocId.set(inst.docId);
    this.selectedInstructorId.set(inst.instructorId);
    this.selectedInstructorName.set(inst.name);
    this.instructorSearchInput.set(this.instructorDisplayFns.toName(inst));
  }

  onInstructorTextUpdated(text: string): void {
    this.instructorSearchInput.set(text);
    if (!text.trim()) {
      this.selectedInstructorDocId.set('');
      this.selectedInstructorId.set('');
      this.selectedInstructorName.set('');
    }
  }

  onEventSelected(event: IlcEvent): void {
    this.selectedEventDocId.set(event.docId);
    this.selectedEventTitle.set(event.title);
    this.eventSearchInput.set(this.eventDisplayFns.toName(event));
    if (event.location && !this.location()) {
      this.location.set(event.location);
    }
    if (event.start && !this.recordedDate()) {
      this.recordedDate.set(event.start.split('T')[0]);
    }
  }

  onEventTextUpdated(text: string): void {
    this.eventSearchInput.set(text);
    if (!text.trim()) {
      this.selectedEventDocId.set('');
      this.selectedEventTitle.set('');
    }
  }

  // --- File Selection & Metadata Generation ---
  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOver.set(false);
    if (event.dataTransfer?.files) {
      this.addFiles(Array.from(event.dataTransfer.files));
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOver.set(false);
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.addFiles(Array.from(input.files));
      input.value = '';
    }
  }

  async addFiles(files: File[]): Promise<void> {
    const videoFiles = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|mkv|webm)$/i.test(f.name));
    if (videoFiles.length === 0) {
      this.errorMessage.set('Please select valid video files (MP4, MOV, MKV, WebM).');
      return;
    }

    this.errorMessage.set(null);
    const existing = this.fileEntries();
    let startIndex = existing.length;

    // If adding to existing series, calculate offset
    if (this.uploadMode() === 'existing_series' && this.existingSeriesId()) {
      const existingSeries = this.availableSeries().find((s) => s.seriesId === this.existingSeriesId());
      if (existingSeries) {
        startIndex += existingSeries.videos.length;
      }
    }

    const newEntries: UploadFileEntry[] = [];

    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const partIndex = startIndex + i + 1;
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      let title = cleanName;
      if (this.uploadMode() !== 'standalone' && !cleanName.toLowerCase().includes('part')) {
        title = `Part ${partIndex}: ${cleanName}`;
      }

      const entry: UploadFileEntry = {
        id,
        file,
        title,
        partIndex,
        description: '',
        durationSeconds: 0,
        previewUrl: '',
        previewBlob: null,
        status: 'idle',
        progressPercent: 0,
      };

      newEntries.push(entry);

      // Async preview & duration extraction in background
      this.extractVideoMetadata(entry);
    }

    // Set series title default if not set
    if (!this.seriesTitle() && videoFiles.length > 0 && this.uploadMode() === 'new_series') {
      const baseName = videoFiles[0].name
        .replace(/\.[^/.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/part\s*\d+/i, '')
        .trim();
      if (baseName) {
        this.seriesTitle.set(baseName);
      }
    }

    this.fileEntries.update((entries) => [...entries, ...newEntries]);
  }

  private extractVideoMetadata(entry: UploadFileEntry): void {
    const videoElem = document.createElement('video');
    videoElem.preload = 'metadata';
    videoElem.muted = true;
    videoElem.playsInline = true;

    const fileUrl = URL.createObjectURL(entry.file);
    videoElem.src = fileUrl;

    videoElem.onloadedmetadata = () => {
      entry.durationSeconds = Math.round(videoElem.duration || 0);

      // Seek 5% into video for thumbnail snapshot
      videoElem.currentTime = Math.min(Math.max(1, videoElem.duration * 0.05), 10);
    };

    videoElem.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                entry.previewBlob = blob;
                entry.previewUrl = URL.createObjectURL(blob);
                this.fileEntries.update((list) => [...list]);
              }
              URL.revokeObjectURL(fileUrl);
            },
            'image/jpeg',
            0.85,
          );
        }
      } catch {
        URL.revokeObjectURL(fileUrl);
      }
    };

    videoElem.onerror = () => {
      URL.revokeObjectURL(fileUrl);
    };
  }

  removeFile(id: string): void {
    this.fileEntries.update((entries) => entries.filter((e) => e.id !== id));
    this.recalculatePartIndices();
  }

  moveFileUp(index: number): void {
    if (index <= 0) return;
    this.fileEntries.update((list) => {
      const copy = [...list];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    this.recalculatePartIndices();
  }

  moveFileDown(index: number): void {
    if (index >= this.fileEntries().length - 1) return;
    this.fileEntries.update((list) => {
      const copy = [...list];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    this.recalculatePartIndices();
  }

  private recalculatePartIndices(): void {
    let offset = 0;
    if (this.uploadMode() === 'existing_series' && this.existingSeriesId()) {
      const existingSeries = this.availableSeries().find((s) => s.seriesId === this.existingSeriesId());
      if (existingSeries) {
        offset = existingSeries.videos.length;
      }
    }

    this.fileEntries.update((list) =>
      list.map((item, idx) => ({
        ...item,
        partIndex: offset + idx + 1,
      })),
    );
  }

  // --- Upload & Transcode Execution ---
  async startUploadAndTranscode(): Promise<void> {
    const files = this.fileEntries();
    if (files.length === 0) {
      this.errorMessage.set('Please select at least one video file.');
      return;
    }

    const mode = this.uploadMode();
    let finalSeriesId = '';
    let finalSeriesTitle = '';
    let priceCents: number | undefined = undefined;

    if (this.seriesPriceDollars() && this.seriesPriceDollars()! > 0) {
      priceCents = Math.round(this.seriesPriceDollars()! * 100);
    }

    if (mode === 'new_series') {
      finalSeriesTitle = this.seriesTitle().trim();
      if (!finalSeriesTitle) {
        this.errorMessage.set('Please provide a title for the new video series.');
        return;
      }
      finalSeriesId = `series_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    } else if (mode === 'existing_series') {
      finalSeriesId = this.existingSeriesId();
      if (!finalSeriesId) {
        this.errorMessage.set('Please select an existing video series.');
        return;
      }
      finalSeriesTitle = this.seriesTitle().trim() || this.availableSeries().find((s) => s.seriesId === finalSeriesId)?.title || '';
    } else {
      // Standalone
      finalSeriesId = '';
      finalSeriesTitle = '';
    }

    const adminUser = this.firebaseState.user();
    const adminMember = adminUser?.member;
    const adminDocId = adminMember?.docId || 'admin';

    this.isProcessing.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.uploadComplete.set(false);

    const storage = getStorage(this.firebaseState.app);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      this.currentFileIndex.set(i + 1);
      const entry = files[i];

      entry.status = 'uploading';
      entry.progressPercent = 10;
      this.fileEntries.update((list) => [...list]);

      try {
        const uploadItemId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const originalStoragePath = `members/${adminDocId}/materials/originals/${uploadItemId}/original`;
        const previewStoragePath = `members/${adminDocId}/materials/previews/${uploadItemId}.jpg`;

        // 1. Upload original video file
        const originalRef = ref(storage, originalStoragePath);
        await uploadBytes(originalRef, entry.file, {
          contentType: entry.file.type || 'video/mp4',
          customMetadata: { name: entry.file.name },
        });
        const originalUrl = await getDownloadURL(originalRef);

        entry.progressPercent = 50;
        this.fileEntries.update((list) => [...list]);

        // 2. Upload thumbnail preview
        let previewUrl = '';
        if (entry.previewBlob) {
          try {
            const previewRef = ref(storage, previewStoragePath);
            await uploadBytes(previewRef, entry.previewBlob, { contentType: 'image/jpeg' });
            previewUrl = await getDownloadURL(previewRef);
          } catch (thumbErr) {
            console.warn('Thumbnail upload warning:', thumbErr);
          }
        }

        entry.progressPercent = 70;
        this.fileEntries.update((list) => [...list]);

        // 3. Create UploadItem record in Firestore
        const uploadItemPayload: Omit<UploadItem, 'docId'> = {
          memberDocId: adminDocId,
          memberId: adminMember?.memberId || 'ADMIN',
          memberName: adminMember?.name || 'Administrator',
          instructorId: this.selectedInstructorId() || adminMember?.instructorId || '',
          name: entry.title || entry.file.name,
          contentType: entry.file.type || 'video/mp4',
          size: entry.file.size,
          url: originalUrl,
          previewUrl,
          storagePath: originalStoragePath,
          previewStoragePath: previewUrl ? previewStoragePath : '',
          date: this.recordedDate(),
          location: this.location(),
          eventDocId: this.selectedEventDocId(),
          eventTitle: this.selectedEventTitle(),
          notes: entry.description || this.seriesDescription(),
          tags: this.tags(),
          source: UploadItemSource.Direct,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        };

        const docId = await this.dataService.createUploadItem(uploadItemPayload);

        // 4. Trigger VOD Transcoding Cloud Function with Series Configuration
        entry.status = 'transcoding';
        entry.progressPercent = 85;
        this.fileEntries.update((list) => [...list]);

        const vodConfig: Partial<VideoItem> = {
          title: entry.title || entry.file.name,
          description: entry.description || this.seriesDescription(),
          tags: this.tags(),
          accessTiers: this.selectedAccessTiers(),
          accessTier: this.selectedAccessTiers()[0] || VodAccessTier.MembersOnly,
          isBuyable: Boolean(priceCents && priceCents > 0),
          priceCents,
          currency: 'usd',
          seriesId: finalSeriesId || undefined,
          seriesTitle: finalSeriesTitle || undefined,
          seriesDescription: this.seriesDescription() || undefined,
          seriesPartIndex: mode !== 'standalone' ? entry.partIndex : undefined,
          seriesPriceCents: priceCents,
          instructorDocId: this.selectedInstructorDocId() || undefined,
          instructorName: this.selectedInstructorName() || undefined,
          instructorId: this.selectedInstructorId() || undefined,
          eventDocId: this.selectedEventDocId() || undefined,
          eventTitle: this.selectedEventTitle() || undefined,
          recordedDate: this.recordedDate(),
          location: this.location(),
          featured: this.isFeatured(),
          resolutions: this.selectedResolutions(),
          thumbnailUrl: previewUrl,
        };

        const transcodeResult = await this.dataService.transcodeVideoForVod(
          docId,
          adminDocId,
          vodConfig,
        );

        entry.createdVideoId = transcodeResult.videoId || docId;
        entry.status = 'done';
        entry.progressPercent = 100;
        successCount++;
        this.fileEntries.update((list) => [...list]);
      } catch (err: unknown) {
        console.error(`Failed uploading file "${entry.file.name}":`, err);
        entry.status = 'error';
        entry.errorMessage = err instanceof Error ? err.message : 'Upload failed.';
        this.fileEntries.update((list) => [...list]);
      }

      this.overallProgressPercent.set(Math.round(((i + 1) / files.length) * 100));
    }

    this.isProcessing.set(false);
    if (successCount === files.length) {
      this.uploadComplete.set(true);
      this.successMessage.set(
        mode !== 'standalone'
          ? `Successfully uploaded and queued transcoding for ${successCount} videos in series "${finalSeriesTitle}".`
          : `Successfully uploaded and queued transcoding for ${successCount} video(s).`,
      );
    } else if (successCount > 0) {
      this.successMessage.set(`Uploaded ${successCount} of ${files.length} videos. Please check failed items below.`);
    } else {
      this.errorMessage.set('Failed to upload video files. Please review errors and try again.');
    }
  }

  // --- Formatting Helpers ---
  formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    if (h > 0) {
      return `${h}h ${remM}m`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  formatBytes(bytes?: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
