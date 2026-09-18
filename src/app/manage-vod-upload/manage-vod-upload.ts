/* manage-vod-upload.ts
 *
 * Dedicated admin console for uploading single videos or creating multi-part
 * video series collections with a unified price, metadata, and automated transcoding.
 * Includes chunked resumable upload support, live speed/ETA tracking, pause/resume,
 * and cross-session persistence in localStorage for large files.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ref, uploadBytes, getDownloadURL, UploadTask } from 'firebase/storage';
import { IlcEvent } from '../../../functions/src/data-model/events';
import { UploadItem, UploadItemSource } from '../../../functions/src/data-model/materials';
import { InstructorPublicData } from '../../../functions/src/data-model/members';
import { VideoItem, VideoSeries, VodAccessTier } from '../../../functions/src/data-model/vod';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { TagInputComponent } from '../tag-input/tag-input';
import { SearchableSet } from '../searchable-set';
import { ResumableUploadService, UploadProgressUpdate } from './resumable-upload.service';
import { NetworkStateService } from '../network-state.service';

export interface UploadFileEntry {
  id: string;
  file: File;
  title: string;
  partIndex: number;
  description: string;
  durationSeconds: number;
  previewUrl: string;
  previewBlob: Blob | null;
  status: 'idle' | 'uploading' | 'paused' | 'transcoding' | 'done' | 'error';
  progressPercent: number;
  bytesTransferred?: number;
  totalBytes?: number;
  uploadSpeed?: string;
  eta?: string;
  errorMessage?: string;
  createdVideoId?: string;
  uploadItemId?: string;
  storagePath?: string;
  uploadTask?: UploadTask;
  hasSavedSession?: boolean;
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
  public resumableService = inject(ResumableUploadService);
  public networkState = inject(NetworkStateService);

  public isOffline = this.networkState.isOffline;

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

  // Active status indicators
  hasActiveUploads = computed(() => {
    return this.fileEntries().some((e) => e.status === 'uploading' || e.status === 'transcoding');
  });

  hasErrors = computed(() => {
    return this.fileEntries().some((e) => e.status === 'error');
  });

  allDone = computed(() => {
    const entries = this.fileEntries();
    return entries.length > 0 && entries.every((e) => e.status === 'done');
  });

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

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasActiveUploads()) {
      event.preventDefault();
    }
  }

  // --- Mode & Quality Helpers ---
  setUploadMode(mode: 'new_series' | 'existing_series' | 'standalone'): void {
    this.uploadMode.set(mode);
    if (mode === 'standalone' && this.fileEntries().length > 0) {
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

      const savedSession = this.resumableService.getSavedSession(file);

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
        uploadItemId: savedSession?.uploadItemId,
        storagePath: savedSession?.storagePath,
        hasSavedSession: Boolean(savedSession),
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
    const entry = this.fileEntries().find((e) => e.id === id);
    if (entry) {
      if (entry.uploadTask) {
        try {
          entry.uploadTask.cancel();
        } catch {
          // ignore
        }
      }
      this.resumableService.clearSession(entry.file);
    }
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

  // --- Per-File Controls: Pause, Resume, Retry ---
  pauseUpload(entry: UploadFileEntry): void {
    if (entry.uploadTask && entry.status === 'uploading') {
      entry.uploadTask.pause();
      entry.status = 'paused';
      entry.uploadSpeed = '';
      entry.eta = 'Paused';
      this.fileEntries.update((list) => [...list]);
    }
  }

  resumeUpload(entry: UploadFileEntry): void {
    if (entry.uploadTask && entry.status === 'paused') {
      entry.uploadTask.resume();
      entry.status = 'uploading';
      this.fileEntries.update((list) => [...list]);
    } else if (entry.status === 'paused' || entry.status === 'error') {
      this.retryUpload(entry);
    }
  }

  async retryUpload(entry: UploadFileEntry): Promise<void> {
    if (this.isProcessing() && entry.status === 'uploading') return;
    this.isProcessing.set(true);
    this.errorMessage.set(null);
    try {
      await this.processSingleFile(entry);
    } catch {
      // processSingleFile sets status to error
    } finally {
      this.isProcessing.set(this.hasActiveUploads());
    }
  }

  async retryAllFailed(): Promise<void> {
    const failed = this.fileEntries().filter((e) => e.status === 'error' || e.status === 'paused');
    if (failed.length === 0) return;
    this.startUploadAndTranscode();
  }

  // --- Core Processing per File ---
  private async processSingleFile(entry: UploadFileEntry): Promise<void> {
    const mode = this.uploadMode();
    let finalSeriesId = '';
    let finalSeriesTitle = '';
    let priceCents: number | undefined = undefined;

    if (this.seriesPriceDollars() && this.seriesPriceDollars()! > 0) {
      priceCents = Math.round(this.seriesPriceDollars()! * 100);
    }

    if (mode === 'new_series') {
      finalSeriesTitle = this.seriesTitle().trim();
      finalSeriesId = `series_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    } else if (mode === 'existing_series') {
      finalSeriesId = this.existingSeriesId();
      finalSeriesTitle =
        this.seriesTitle().trim() ||
        this.availableSeries().find((s) => s.seriesId === finalSeriesId)?.title ||
        '';
    }

    const adminUser = this.firebaseState.user();
    const adminMember = adminUser?.member;
    const adminDocId = adminMember?.docId || 'admin';

    // 1. Maintain or assign uploadItemId and storage paths
    if (!entry.uploadItemId) {
      const saved = this.resumableService.getSavedSession(entry.file);
      entry.uploadItemId =
        saved?.uploadItemId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const originalStoragePath = `members/${adminDocId}/materials/originals/${entry.uploadItemId}/original`;
    const previewStoragePath = `members/${adminDocId}/materials/previews/${entry.uploadItemId}.jpg`;
    entry.storagePath = originalStoragePath;

    entry.status = 'uploading';
    entry.errorMessage = undefined;
    this.fileEntries.update((list) => [...list]);

    try {
      // 2. Perform chunked resumable upload
      const { task, promise } = this.resumableService.uploadVideo(
        entry.file,
        originalStoragePath,
        entry.uploadItemId,
        (update: UploadProgressUpdate) => {
          entry.progressPercent = update.progressPercent;
          entry.bytesTransferred = update.bytesTransferred;
          entry.totalBytes = update.totalBytes;
          entry.uploadSpeed = update.uploadSpeed;
          entry.eta = update.eta;
          if (update.state === 'paused') {
            entry.status = 'paused';
          } else if (update.state === 'running') {
            entry.status = 'uploading';
          }
          this.fileEntries.update((list) => [...list]);
        },
      );

      entry.uploadTask = task;
      this.fileEntries.update((list) => [...list]);

      const { downloadUrl: originalUrl } = await promise;

      // 3. Upload thumbnail preview if generated
      let previewUrl = '';
      if (entry.previewBlob) {
        try {
          const storage = this.resumableService.getStorageInstance();
          const previewRef = ref(storage, previewStoragePath);
          await uploadBytes(previewRef, entry.previewBlob, { contentType: 'image/jpeg' });
          previewUrl = await getDownloadURL(previewRef);
        } catch (thumbErr) {
          console.warn('Thumbnail upload warning:', thumbErr);
        }
      }

      // 4. Create UploadItem record in Firestore
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

      // 5. Trigger VOD Transcoding Cloud Function with Series Configuration
      entry.status = 'transcoding';
      entry.uploadSpeed = '';
      entry.eta = '';
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
      entry.uploadTask = undefined;
      entry.hasSavedSession = false;
      this.fileEntries.update((list) => [...list]);
    } catch (err: unknown) {
      console.error(`Failed uploading file "${entry.file.name}":`, err);
      entry.status = 'error';
      entry.uploadSpeed = '';
      entry.eta = '';
      entry.errorMessage = err instanceof Error ? err.message : 'Upload failed.';
      this.fileEntries.update((list) => [...list]);
      throw err;
    }
  }

  // --- Upload & Transcode Execution ---
  async startUploadAndTranscode(): Promise<void> {
    const files = this.fileEntries();
    if (files.length === 0) {
      this.errorMessage.set('Please select at least one video file.');
      return;
    }

    const mode = this.uploadMode();
    let finalSeriesTitle = '';

    if (mode === 'new_series') {
      finalSeriesTitle = this.seriesTitle().trim();
      if (!finalSeriesTitle) {
        this.errorMessage.set('Please provide a title for the new video series.');
        return;
      }
    } else if (mode === 'existing_series') {
      const finalSeriesId = this.existingSeriesId();
      if (!finalSeriesId) {
        this.errorMessage.set('Please select an existing video series.');
        return;
      }
      finalSeriesTitle =
        this.seriesTitle().trim() ||
        this.availableSeries().find((s) => s.seriesId === finalSeriesId)?.title ||
        '';
    }

    const pendingFiles = this.fileEntries().filter((e) => e.status !== 'done');
    if (pendingFiles.length === 0) {
      this.successMessage.set('All videos have already been successfully uploaded and queued.');
      return;
    }

    this.isProcessing.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.uploadComplete.set(false);

    let successCount = this.fileEntries().filter((e) => e.status === 'done').length;
    const totalCount = this.fileEntries().length;

    for (let i = 0; i < pendingFiles.length; i++) {
      const entry = pendingFiles[i];
      this.currentFileIndex.set(successCount + 1);

      try {
        await this.processSingleFile(entry);
        successCount++;
      } catch {
        // Individual file error caught and status reflected on entry card
      }

      this.overallProgressPercent.set(Math.round((successCount / totalCount) * 100));
    }

    this.isProcessing.set(false);
    if (successCount === totalCount) {
      this.uploadComplete.set(true);
      this.successMessage.set(
        mode !== 'standalone'
          ? `Successfully uploaded and queued transcoding for ${successCount} videos in series "${finalSeriesTitle}".`
          : `Successfully uploaded and queued transcoding for ${successCount} video(s).`,
      );
    } else if (successCount > 0) {
      this.successMessage.set(
        `Uploaded ${successCount} of ${totalCount} videos. Some items failed or were paused — you can resume them below.`,
      );
    } else {
      this.errorMessage.set(
        'Upload failed for one or more video files. You can retry failed items below without losing progress.',
      );
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
