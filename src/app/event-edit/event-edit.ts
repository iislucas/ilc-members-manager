/* event-edit.ts
 *
 * Component for editing an event's details. Used by admins to edit
 * any event (both proposed and listed). Loads the event from Firestore
 * by docId or sourceId, then presents an edit form following the
 * same pattern as member-details.
 */

import {
  Component,
  input,
  output,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import {
  form,
  FormField,
  required,
  FieldTree,
} from '@angular/forms/signals';
import { IlcEvent, EventStatus, EventSourceKind, eventStatusLabel, initEvent, Member, InstructorPublicData, EventDocument } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { deepObjEq, htmlToMarkdown, looksLikeHtml, makeThumbnail } from '../utils';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { ImageUploadPreviewComponent } from '../image-upload-preview/image-upload-preview';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { doc, getDoc, getDocs, getFirestore, updateDoc, collection, query, where, deleteDoc } from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  getMetadata,
  updateMetadata,
  deleteObject,
} from 'firebase/storage';
import { FIREBASE_APP } from '../app.config';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';

// Fields used in the event form model.
type EventFormModel = {
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  status: string;
  heroImageUrl: string;
  heroImageLargeUrl?: string;
  heroImageThumbUrl?: string;
  heroImageOriginalUrl?: string;
  ownerDocId: string;
  managerDocIds: string[];
  leadingInstructorId: string;
  documents: EventDocument[];
};

// A single private event material file, as presented in the UI. Materials live
// only in Cloud Storage (not on the public event doc); see the materials
// section below.
type Material = {
  itemId: string;       // folder id under events/{eventId}/materials/originals/
  name: string;         // display name (stored in the original's customMetadata)
  contentType: string;  // MIME type from object metadata
  size: number;         // bytes
  url: string;          // download URL of the original file
  previewUrl?: string;  // download URL of the generated JPEG preview, if any
};

function toFormModel(event: IlcEvent): EventFormModel {
  const model: EventFormModel = {
    title: event.title,
    // We split by 'T' to get the date part (YYYY-MM-DD) for the date input.
    // String.prototype.split() is guaranteed to return an array with at least one string element,
    // even if the delimiter 'T' is not found or the string is empty, so [0] is always a string.
    start: event.start.split('T')[0],
    end: event.end.split('T')[0],
    description: event.descriptionMarkdown || event.description,
    location: event.location,
    status: event.status,
    heroImageUrl: event.heroImageUrl,
    ownerDocId: event.ownerDocId || '',
    managerDocIds: event.managerDocIds || [],
    leadingInstructorId: event.leadingInstructorId || '',
    documents: event.documents || [],
  };
  if (event.heroImageLargeUrl !== undefined) {
    model.heroImageLargeUrl = event.heroImageLargeUrl;
  }
  if (event.heroImageThumbUrl !== undefined) {
    model.heroImageThumbUrl = event.heroImageThumbUrl;
  }
  if (event.heroImageOriginalUrl !== undefined) {
    model.heroImageOriginalUrl = event.heroImageOriginalUrl;
  }
  return model;
}

@Component({
  selector: 'app-event-edit',
  standalone: true,
  imports: [FormField, IconComponent, SpinnerComponent, MarkdownEditor, ImageUploadPreviewComponent, AutocompleteComponent],
  templateUrl: './event-edit.html',
  styleUrl: './event-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventEditComponent implements OnInit {

  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  firebaseState = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);

  // Constants for template
  EventStatus = EventStatus;
  eventStatuses = Object.values(EventStatus);
  eventStatusLabelFn = eventStatusLabel;

  // Input: event ID from route
  eventId = input.required<string>();
  titleLoaded = output<string>();

  // Loaded event data from Firestore
  event = signal<IlcEvent | null>(null);
  isLoadingEvent = signal(true);
  loadError = signal<string | null>(null);

  // The form model signal.
  eventFormModel = signal<EventFormModel>({
    title: '', start: '', end: '', description: '', location: '',
    status: EventStatus.Proposed,
    heroImageUrl: '',
    heroImageLargeUrl: '',
    heroImageThumbUrl: '',
    heroImageOriginalUrl: '',
    ownerDocId: '',
    managerDocIds: [],
    leadingInstructorId: '',
    documents: [],
  });

  form: FieldTree<EventFormModel> = form(this.eventFormModel, (schema) => {
    required(schema.title, { message: 'Title is required.' });
    required(schema.start, { message: 'Start date/time is required.' });
    required(schema.end, { message: 'End date/time is required.' });
  });

  editableEvent = computed<EventFormModel>(() => this.eventFormModel());

  isDirty = computed(() => {
    const ev = this.event();
    if (!ev) return false;
    const current = this.editableEvent();
    const original = toFormModel(ev);
    return !deepObjEq(current, original);
  });

  isSaving = signal(false);
  isEditingCrop = signal(false);
  isUploadingImage = signal(false);
  errorMessage = signal<string | null>(null);
  imageUploadError = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  isUploadingDocument = signal(false);
  documentUploadError = signal<string | null>(null);
  statusMenuOpen = signal(false);

  // Private event materials (videos / photo dumps). Stored directly in Cloud
  // Storage and managed independently of the event Save button.
  materials = signal<Material[]>([]);
  isLoadingMaterials = signal(false);
  isUploadingMaterial = signal(false);
  materialUploadError = signal<string | null>(null);
  materialUploadedCount = signal(0);
  materialTotalToUpload = signal(0);

  // Maximum dimension (px) for generated material preview thumbnails.
  private readonly MATERIAL_PREVIEW_MAX_DIM = 320;

  // Maximum number of documents allowed per event.
  private readonly MAX_DOCUMENTS = 10;

  isAdmin = computed(() => this.firebaseState.user()?.isAdmin || false);

  // Status chip display — uses the loaded event's status (not the form
  // model) so it always reflects the persisted state.
  statusLabel = computed(() => {
    const ev = this.event();
    return ev ? eventStatusLabel(ev.status) : '';
  });
  statusClass = computed(() =>
    'event-status-chip status-' + (this.event()?.status || 'proposed'));

  // Whether the current user can change the event status via the chip menu.
  canChangeStatus = computed(() => this.isAdmin() || this.isOwner() || this.isManager());

  // Whether the current user can view/manage this event's private materials.
  canManageMaterials = computed(() => this.isAdmin() || this.isOwner() || this.isManager());

  isOwner = computed(() => {
    const user = this.firebaseState.user();
    const ev = this.event();
    return !!(user && ev && user.member.docId === ev.ownerDocId);
  });

  isManager = computed(() => {
    const user = this.firebaseState.user();
    const ev = this.event();
    return !!(user && ev && ev.managerDocIds?.includes(user.member.docId));
  });

  canDelete = computed(() => {
    const ev = this.event();
    if (!ev) return false;
    return this.isAdmin() || ((this.isOwner() || this.isManager()) && ev.status === EventStatus.Proposed);
  });

  // TODO: do something more diciplined and thoughtful with back urls, and router. 
  backUrl = computed(() => {
    const view = this.routingService.matchedPatternId();
    if (view === Views.MyEventEdit) return 'my-events';
    if (view === Views.ManageEventEdit) return 'manage-events';
    return 'manage-events'; // Default fallback
  });

  viewEventUrl = computed(() => {
    const prefix = this.backUrl();
    const eventId = this.eventId();
    return `${prefix}/${eventId}`;
  });
  // Change the event status via the chip dropdown. For non-admins only
  // 'cancelled' is allowed, with a confirmation warning.
  async changeStatus(newStatus: EventStatus) {
    this.statusMenuOpen.set(false);
    const ev = this.event();
    if (!ev || !ev.docId) return;
    if (ev.status === newStatus) return;

    // Non-admin users can only cancel, and need to confirm.
    if (!this.isAdmin()) {
      if (newStatus !== EventStatus.Cancelled) return;
      const confirmed = confirm(
        'Are you sure you want to cancel this event? ' +
        'This will mark the event as cancelled and it will no longer appear in public listings. ' +
        'Only an admin can reverse this action.'
      );
      if (!confirmed) return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    try {
      const docRef = doc(this.db, 'events', ev.docId);
      await updateDoc(docRef, {
        status: newStatus,
        lastUpdated: new Date().toISOString(),
        updatedByEmail: this.firebaseState.user()?.firebaseUser.email || '',
      });
      // Update local state so chip and form model reflect the change.
      const updatedEvent = { ...ev, status: newStatus, lastUpdated: new Date().toISOString() };
      this.event.set(updatedEvent);
      this.eventFormModel.update(m => ({ ...m, status: newStatus }));
      this.successMessage.set(`Status changed to "${eventStatusLabel(newStatus)}".`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error changing status:', error);
      this.errorMessage.set('Failed to change status: ' + message);
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteEvent() {
    const ev = this.event();
    if (!ev || !ev.docId) return;

    if (!confirm('Are you sure you want to delete this event?')) return;

    this.isSaving.set(true);
    try {
      const docRef = doc(this.db, 'events', ev.docId);
      await deleteDoc(docRef);
      this.successMessage.set('Event deleted successfully.');
      setTimeout(() => this.routingService.navigateToParts([this.backUrl()]), 1500);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error deleting event:', error);
      this.errorMessage.set('Failed to delete: ' + message);
    } finally {
      this.isSaving.set(false);
    }
  }

  ngOnInit() {
    this.loadEvent();
  }

  async loadEvent() {
    this.isLoadingEvent.set(true);
    this.loadError.set(null);
    try {
      const id = this.eventId();
      const data = await this.dataService.getEventById(id);
      if (data) {
        if (data.descriptionMarkdown) {
          if (looksLikeHtml(data.descriptionMarkdown)) {
            data.descriptionMarkdown = htmlToMarkdown(data.descriptionMarkdown);
          }
        } else if (data.description) {
          data.descriptionMarkdown = htmlToMarkdown(data.description);
        }
        this.event.set(data);
        this.eventFormModel.set(toFormModel(data));
        this.titleLoaded.emit(data.title);
        if (data.docId && this.canManageMaterials()) {
          this.loadMaterials(data.docId);
        }
      } else {
        this.loadError.set('Event not found.');
        this.titleLoaded.emit('Event Not Found');
      }
    } catch (error) {
      console.error('Error loading event:', error);
      this.loadError.set('Failed to load event.');
      this.titleLoaded.emit('Error Loading Event');
    } finally {
      this.isLoadingEvent.set(false);
    }
  }

  async onImageCropped(event: { thumbBlob: Blob, largeBlob: Blob, originalFile?: File }) {
    const { thumbBlob, largeBlob, originalFile } = event;
    const ev = this.event();
    if (!ev || !ev.docId) {
      this.imageUploadError.set('Cannot upload image: event has no document ID.');
      return;
    }

    this.isUploadingImage.set(true);
    this.imageUploadError.set(null);

    try {
      const storage = getStorage(this.firebaseApp);
      
      // Upload Large (600x400)
      const largeRef = ref(storage, `events/${ev.docId}/images/heroImage_large`);
      await uploadBytes(largeRef, largeBlob);
      const largeUrl = await getDownloadURL(largeRef);

      // Upload Thumb (120x80)
      const thumbRef = ref(storage, `events/${ev.docId}/images/heroImage_thumb`);
      await uploadBytes(thumbRef, thumbBlob);
      const thumbUrl = await getDownloadURL(thumbRef);

      // Upload Original (if present)
      let originalUrl = ev.heroImageOriginalUrl || '';
      if (originalFile) {
        const originalRef = ref(storage, `events/${ev.docId}/images/heroImage_original`);
        await uploadBytes(originalRef, originalFile);
        originalUrl = await getDownloadURL(originalRef);
      }

      this.eventFormModel.update((m) => ({ 
        ...m, 
        heroImageUrl: largeUrl,
        heroImageLargeUrl: largeUrl,
        heroImageThumbUrl: thumbUrl,
        heroImageOriginalUrl: originalUrl
      }));
      this.isEditingCrop.set(false);
      this.successMessage.set('Images uploaded successfully. Remember to save changes.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error uploading image:', error);
      this.imageUploadError.set('Failed to upload image: ' + message);
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  removeHeroImage() {
    this.eventFormModel.update((m) => ({ 
      ...m, 
      heroImageUrl: '',
      heroImageLargeUrl: '',
      heroImageThumbUrl: '',
      heroImageOriginalUrl: ''
    }));
  }

  editHeroImageCrop() {
    this.isEditingCrop.set(true);
  }

  onCancelCrop() {
    this.isEditingCrop.set(false);
  }

  userIsAdmin = computed(() => this.firebaseState.user()?.isAdmin || false);

  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.instructorId ? `${i.name} [${i.instructorId}]` : i.name,
  };

  memberDisplayFns = {
    toChipId: (m: Member) => m.memberId,
    toName: (m: Member) => m.memberId ? `(${m.memberId}) ${m.name}` : m.name,
  };

  private extractInstructorId(value: string): string {
    const match = value.match(/\[([^\]]+)\]$/);
    return match ? match[1] : value;
  }

  updateLeadingInstructorId(value: string) {
    const instructorId = this.extractInstructorId(value);
    this.eventFormModel.update((m) => ({ ...m, leadingInstructorId: instructorId }));
  }

  updateOwnerDocId(value: string) {
    const instructorId = this.extractInstructorId(value);
    const instructor = this.dataService.instructors.get(instructorId);
    if (instructor) {
      this.eventFormModel.update((m) => ({ ...m, ownerDocId: instructor.docId }));
    }
  }

  updateManagerDocId(index: number, value: string) {
    const instructorId = this.extractInstructorId(value);
    this.eventFormModel.update((m) => {
      const managerDocIds = [...m.managerDocIds];
      const instructor = this.dataService.instructors.get(instructorId);
      if (instructor) {
        managerDocIds[index] = instructor.docId;
      }
      return { ...m, managerDocIds };
    });
  }

  addEmptyManagerRow() {
    this.eventFormModel.update((m) => ({
      ...m,
      managerDocIds: [...m.managerDocIds, '']
    }));
  }

  removeManagerDocId(index: number) {
    this.eventFormModel.update((m) => ({
      ...m,
      managerDocIds: m.managerDocIds.filter((_, i) => i !== index)
    }));
  }

  // Document management methods

  onDocumentFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const ev = this.event();
    if (!ev || !ev.docId) {
      this.documentUploadError.set('Cannot upload document: event has no document ID. Please save the event first.');
      return;
    }

    const currentDocs = this.eventFormModel().documents;
    const remaining = this.MAX_DOCUMENTS - currentDocs.length;
    if (remaining <= 0) {
      this.documentUploadError.set(`Maximum of ${this.MAX_DOCUMENTS} documents reached.`);
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remaining);
    this.uploadDocumentFiles(filesToUpload, ev.docId);

    // Reset input so the same file can be re-selected
    input.value = '';
  }

  private async uploadDocumentFiles(files: File[], eventDocId: string) {
    this.isUploadingDocument.set(true);
    this.documentUploadError.set(null);

    try {
      const storage = getStorage(this.firebaseApp);
      const newDocs: EventDocument[] = [];

      for (const file of files) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `events/${eventDocId}/documents/${timestamp}_${safeName}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        newDocs.push({ name: file.name, url });
      }

      this.eventFormModel.update((m) => ({
        ...m,
        documents: [...m.documents, ...newDocs],
      }));
      this.successMessage.set(`${newDocs.length} document(s) uploaded. Remember to save changes.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error uploading document:', error);
      this.documentUploadError.set('Failed to upload document: ' + message);
    } finally {
      this.isUploadingDocument.set(false);
    }
  }

  updateDocumentName(index: number, event: Event) {
    const name = (event.target as HTMLInputElement).value;
    this.eventFormModel.update((m) => {
      const documents = [...m.documents];
      documents[index] = { ...documents[index], name };
      return { ...m, documents };
    });
  }

  removeDocument(index: number) {
    this.eventFormModel.update((m) => ({
      ...m,
      documents: m.documents.filter((_, i) => i !== index),
    }));
  }

  // --- Private event materials -------------------------------------------
  // Materials live entirely in Cloud Storage (the event doc is public), under
  //   events/{eventId}/materials/originals/{itemId}/original
  //   events/{eventId}/materials/previews/{itemId}.jpg
  // and are managed immediately (no dependency on the event Save button).

  private originalRef(eventDocId: string, itemId: string) {
    const storage = getStorage(this.firebaseApp);
    return ref(storage, `events/${eventDocId}/materials/originals/${itemId}/original`);
  }

  private previewRef(eventDocId: string, itemId: string) {
    const storage = getStorage(this.firebaseApp);
    return ref(storage, `events/${eventDocId}/materials/previews/${itemId}.jpg`);
  }

  private async loadMaterials(eventDocId: string) {
    this.isLoadingMaterials.set(true);
    this.materialUploadError.set(null);
    try {
      const storage = getStorage(this.firebaseApp);
      const originalsRoot = ref(storage, `events/${eventDocId}/materials/originals`);
      const listed = await listAll(originalsRoot);

      const loaded = await Promise.all(
        listed.prefixes.map(async (itemFolder) => {
          const itemId = itemFolder.name;
          const original = this.originalRef(eventDocId, itemId);
          const [md, url] = await Promise.all([
            getMetadata(original),
            getDownloadURL(original),
          ]);
          const previewUrl = await getDownloadURL(this.previewRef(eventDocId, itemId)).catch(
            () => undefined,
          );
          const material: Material = {
            itemId,
            name: md.customMetadata?.['name'] || itemId,
            contentType: md.contentType || '',
            size: md.size || 0,
            url,
            previewUrl,
          };
          return material;
        }),
      );

      // Stable order: newest first (itemId is prefixed with Date.now()).
      loaded.sort((a, b) => (a.itemId < b.itemId ? 1 : a.itemId > b.itemId ? -1 : 0));
      this.materials.set(loaded);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error loading materials:', error);
      this.materialUploadError.set('Failed to load materials: ' + message);
    } finally {
      this.isLoadingMaterials.set(false);
    }
  }

  onMaterialFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      const ev = this.event();
      if (!ev?.docId) {
        this.materialUploadError.set('Cannot upload: event has no document ID.');
      } else {
        this.uploadMaterialFiles(Array.from(files), ev.docId);
      }
    }
    // Reset so re-selecting the same files/folder fires the change event again.
    input.value = '';
  }

  private async uploadMaterialFiles(files: File[], eventDocId: string) {
    this.isUploadingMaterial.set(true);
    this.materialUploadError.set(null);
    this.materialUploadedCount.set(0);
    this.materialTotalToUpload.set(files.length);

    const failures: string[] = [];

    for (const file of files) {
      const itemId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const original = this.originalRef(eventDocId, itemId);
        await uploadBytes(original, file, {
          contentType: file.type || 'application/octet-stream',
          customMetadata: { name: file.name },
        });
        const url = await getDownloadURL(original);

        // Best-effort preview; failure just means the UI shows an icon.
        let previewUrl: string | undefined;
        try {
          const thumb = await makeThumbnail(file, this.MATERIAL_PREVIEW_MAX_DIM);
          const preview = this.previewRef(eventDocId, itemId);
          await uploadBytes(preview, thumb, { contentType: 'image/jpeg' });
          previewUrl = await getDownloadURL(preview);
        } catch (previewError) {
          console.warn(`No preview generated for "${file.name}":`, previewError);
        }

        const material: Material = {
          itemId,
          name: file.name,
          contentType: file.type || '',
          size: file.size,
          url,
          previewUrl,
        };
        this.materials.update((list) => [material, ...list]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error uploading material "${file.name}":`, error);
        failures.push(`${file.name}: ${message}`);
      } finally {
        this.materialUploadedCount.update((n) => n + 1);
      }
    }

    if (failures.length > 0) {
      this.materialUploadError.set(`Failed to upload ${failures.length} file(s): ` + failures.join('; '));
    }
    this.isUploadingMaterial.set(false);
  }

  async removeMaterial(itemId: string) {
    const ev = this.event();
    if (!ev?.docId) return;
    const material = this.materials().find((m) => m.itemId === itemId);
    if (!material) return;
    if (!confirm(`Remove "${material.name}"? This permanently deletes the file.`)) return;

    try {
      await deleteObject(this.originalRef(ev.docId, itemId));
      if (material.previewUrl) {
        await deleteObject(this.previewRef(ev.docId, itemId)).catch((err) =>
          // Original is gone; a missing preview shouldn't block removal.
          console.warn('Failed to delete material preview:', err),
        );
      }
      this.materials.update((list) => list.filter((m) => m.itemId !== itemId));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error removing material:', error);
      this.materialUploadError.set('Failed to remove material: ' + message);
    }
  }

  async updateMaterialName(itemId: string, event: Event) {
    const ev = this.event();
    if (!ev?.docId) return;
    const name = (event.target as HTMLInputElement).value;
    // Optimistically reflect the new name; persist to object metadata.
    this.materials.update((list) =>
      list.map((m) => (m.itemId === itemId ? { ...m, name } : m)),
    );
    try {
      await updateMetadata(this.originalRef(ev.docId, itemId), {
        customMetadata: { name },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error renaming material:', error);
      this.materialUploadError.set('Failed to rename material: ' + message);
    }
  }

  async saveEvent(e: Event) {
    e.preventDefault();
    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (!this.form().valid()) {
      this.errorMessage.set('Please fix the errors in the form.');
      return;
    }

    const eventData = this.event();
    if (!eventData?.docId) {
      this.errorMessage.set('Cannot save: event has no document ID.');
      return;
    }

    this.isSaving.set(true);
    try {
      const docRef = doc(this.db, 'events', eventData.docId);
      const formData = this.editableEvent();
      await updateDoc(docRef, {
        title: formData.title,
        start: formData.start,
        end: formData.end,
        descriptionMarkdown: formData.description,
        location: formData.location,
        status: formData.status,
        heroImageUrl: formData.heroImageUrl,
        heroImageLargeUrl: formData.heroImageLargeUrl,
        heroImageThumbUrl: formData.heroImageThumbUrl,
        heroImageOriginalUrl: formData.heroImageOriginalUrl,
        ownerDocId: formData.ownerDocId,
        managerDocIds: formData.managerDocIds.filter(Boolean),
        leadingInstructorId: formData.leadingInstructorId,
        documents: formData.documents,
        kind: EventSourceKind.FirebaseSourced,
        lastUpdated: new Date().toISOString(),
        updatedByEmail: this.firebaseState.user()?.firebaseUser.email || '',
      });
      this.successMessage.set('Event saved successfully.');
      // Update the local event data so isDirty resets
      this.event.set({
        ...eventData,
        ...formData,
        managerDocIds: formData.managerDocIds.filter(Boolean),
        descriptionMarkdown: formData.description,
        status: formData.status as EventStatus,
        heroImageUrl: formData.heroImageUrl,
        heroImageLargeUrl: formData.heroImageLargeUrl,
        heroImageThumbUrl: formData.heroImageThumbUrl,
        heroImageOriginalUrl: formData.heroImageOriginalUrl,
        documents: formData.documents,
        kind: EventSourceKind.FirebaseSourced,
        lastUpdated: new Date().toISOString(),
        updatedByEmail: this.firebaseState.user()?.firebaseUser.email || '',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error saving event:', error);
      this.errorMessage.set('Failed to save: ' + message);
    } finally {
      this.isSaving.set(false);
    }
  }

  onDescriptionChanged(markdown: string) {
    this.eventFormModel.update((m) => ({ ...m, description: markdown }));
  }
}
