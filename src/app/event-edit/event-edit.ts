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
import { IlcEvent, EventStatus, EventSourceKind, initEvent, Member, InstructorPublicData } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { deepObjEq, htmlToMarkdown, looksLikeHtml } from '../utils';
import { MobileEditor } from '../mobile-editor/mobile-editor';
import { ImageUploadPreviewComponent } from '../image-upload-preview/image-upload-preview';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { doc, getDoc, getDocs, getFirestore, updateDoc, collection, query, where, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  imports: [FormField, IconComponent, SpinnerComponent, MobileEditor, ImageUploadPreviewComponent, AutocompleteComponent],
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
  successMessage = signal<string | null>(null);

  isAdmin = computed(() => this.firebaseState.user()?.isAdmin || false);

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
      this.errorMessage.set('Cannot upload image: event has no document ID.');
      return;
    }

    this.isUploadingImage.set(true);
    this.errorMessage.set(null);

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
      this.errorMessage.set('Failed to upload image: ' + message);
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
    toName: (i: InstructorPublicData) => i.name,
  };

  memberDisplayFns = {
    toChipId: (m: Member) => m.memberId,
    toName: (m: Member) => m.name,
  };

  updateOwnerDocId(instructorId: string) {
    const instructor = this.dataService.instructors.get(instructorId);
    if (instructor) {
      this.eventFormModel.update((m) => ({ ...m, ownerDocId: instructor.docId }));
    }
  }

  updateManagerDocId(index: number, instructorId: string) {
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
