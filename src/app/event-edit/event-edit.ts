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
  linkedSignal,
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
import { IlcEvent, EventStatus, EventSourceKind, eventStatusLabel, initEvent, initEventContact, InstructorPublicData, Member, EventContact, EventDocument, School, UploadItem } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { deepObjEq, htmlToMarkdown, looksLikeHtml, makeThumbnail } from '../utils';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { ImageUploadPreviewComponent } from '../image-upload-preview/image-upload-preview';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
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
import { BackLinkComponent } from '../back-link/back-link';
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
  ownerName: string;
  ownerMemberId: string;
  ownerInstructorId: string;
  ownerContactEmail: string;
  ownerContactUrl: string;
  managerDocIds: string[];
  // The creator/managers listed publicly as contacts. Membership IS the flag.
  contacts: EventContact[];
  leadingInstructorId: string;
  schoolId: string;
  schoolDocId: string;
  documents: EventDocument[];
};

// Whether a member is listed as a public contact in the given form model.
function isContactIn(model: EventFormModel, memberDocId: string): boolean {
  return !!memberDocId && model.contacts.some((c) => c.memberDocId === memberDocId);
}

// The contacts to persist: only the creator and current managers, with the
// creator's entry taking its display name and contact details from the owner*
// fields (the single place those are edited).
function contactsToSave(model: EventFormModel): EventContact[] {
  const allowed = new Set(
    [model.ownerDocId, ...model.managerDocIds].filter(Boolean));
  return model.contacts
    .filter((c) => allowed.has(c.memberDocId))
    .map((c) => c.memberDocId === model.ownerDocId
      ? {
        ...c,
        name: model.ownerName,
        memberId: model.ownerMemberId,
        instructorId: model.ownerInstructorId,
        contactEmail: model.ownerContactEmail,
        contactUrl: model.ownerContactUrl,
      }
      : c);
}

// A single private event material file, as presented in the UI.
// Metadata is indexed in Firestore /members/{memberDocId}/uploads/{uploadDocId}
// with files in Cloud Storage.
type Material = {
  docId?: string;       // Firestore upload document ID (if present)
  memberDocId?: string; // Member document ID of the uploader
  itemId: string;       // Folder/item id under events/{eventId}/materials/originals/
  name: string;         // Display name
  contentType: string;  // MIME type from object metadata
  size: number;         // Bytes
  url: string;          // Download URL of the original file
  previewUrl?: string;  // Download URL of the generated JPEG preview, if any
  storagePath?: string;
  previewStoragePath?: string;
  date?: string;
  location?: string;
  notes?: string;
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
    ownerName: event.ownerName || '',
    ownerMemberId: event.ownerMemberId || '',
    ownerInstructorId: event.ownerInstructorId || '',
    ownerContactEmail: event.ownerContactEmail || '',
    ownerContactUrl: event.ownerContactUrl || '',
    managerDocIds: event.managerDocIds || [],
    contacts: (event.contacts || []).map((c) => ({ ...initEventContact(), ...c })),
    leadingInstructorId: event.leadingInstructorId || '',
    schoolId: event.schoolId || '',
    schoolDocId: event.schoolDocId || '',
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
  imports: [FormField, IconComponent, SpinnerComponent, MarkdownEditor, ImageUploadPreviewComponent, AutocompleteComponent, InstructorSelectorComponent, BackLinkComponent],
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
    ownerName: '',
    ownerMemberId: '',
    ownerInstructorId: '',
    ownerContactEmail: '',
    ownerContactUrl: '',
    managerDocIds: [],
    contacts: [],
    leadingInstructorId: '',
    schoolId: '',
    schoolDocId: '',
    documents: [],
  });

  // The creator's identity for display. Events written before these fields were
  // cached on the document hold only an ownerDocId, so fall back to the caches —
  // otherwise the whole Creator section renders blank.
  creatorInstructorId = computed(() =>
    this.eventFormModel().ownerInstructorId ||
    this.instructorIdForMember(this.eventFormModel().ownerDocId));

  creatorName = computed(() => {
    const m = this.eventFormModel();
    return m.ownerName || this.memberFieldFor(m.ownerDocId, 'name');
  });

  creatorMemberId = computed(() => {
    const m = this.eventFormModel();
    return m.ownerMemberId || this.memberFieldFor(m.ownerDocId, 'memberId');
  });

  private memberFieldFor(memberDocId: string, field: 'name' | 'memberId'): string {
    if (!memberDocId) return '';
    return (
      this.instructorsByDocId().get(memberDocId)?.[field] ||
      this.dataService.members.get(memberDocId)?.[field] ||
      ''
    );
  }

  // UI-only: when an admin ticks this, the creator picker switches from the
  // instructor autocomplete to a member autocomplete so any member (not just
  // instructors) can be assigned as the event creator/contact. Derived from the
  // resolved creator so it settles on the right mode once the instructor cache
  // arrives, while still honouring an admin's manual toggle.
  assignMemberAsOwner = linkedSignal(() => {
    const m = this.eventFormModel();
    return !!m.ownerDocId && !this.creatorInstructorId();
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

  /*
  The events list this editor's subtree hangs off. Normal navigation out of the
  editor goes one level up the tree — to the event's own page, via the shared
  back link — but once the event is deleted (or failed to load) that page no
  longer exists, so those two cases fall back to the list.
  */
  listUrl = computed(() => {
    const view = this.routingService.matchedPatternId();
    if (view === Views.MyEventEdit) return 'my-events';
    if (view === Views.ManageEventEdit) return 'manage-events';
    return 'events';
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
      setTimeout(() => this.routingService.navigateToParts([this.listUrl()]), 1500);
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

  memberDisplayFns = {
    toChipId: (m: Member) => m.memberId,
    toName: (m: Member) => m.memberId ? `(${m.memberId}) ${m.name}` : m.name,
  };

  schoolDisplayFns = {
    toChipId: (s: School) => s.schoolId,
    toName: (s: School) => s.schoolId ? `${s.schoolName} [${s.schoolId}]` : s.schoolName,
  };

  private extractInstructorId(value: string): string {
    const match = value.match(/\[([^\]]+)\]$/);
    return match ? match[1] : value;
  }

  updateSchoolId(value: string) {
    const schoolId = this.extractInstructorId(value);
    const school = this.dataService.schools.get(schoolId);
    this.eventFormModel.update((m) => ({
      ...m,
      schoolId,
      schoolDocId: school?.docId || '',
    }));
  }

  clearSchool() {
    this.eventFormModel.update((m) => ({ ...m, schoolId: '', schoolDocId: '' }));
  }

  updateLeadingInstructorId(value: string) {
    const instructorId = this.extractInstructorId(value);
    this.eventFormModel.update((m) => ({ ...m, leadingInstructorId: instructorId }));
  }

  // Extract the human-readable memberId from an autocomplete label like
  // "(MEM-123) Jane Doe" or a bare id.
  private extractMemberId(value: string): string {
    const match = value.match(/^\(([^)]+)\)/);
    return match ? match[1] : value.trim();
  }

  // Assign the creator from the instructor autocomplete. Caches the instructor's
  // identity and clears any inline mini-profile (the instructor's own profile is
  // the contact).
  updateOwnerInstructor(value: string) {
    const instructorId = this.extractInstructorId(value);
    const instructor = this.dataService.instructors.get(instructorId);
    if (!instructor) return;
    this.eventFormModel.update((m) => this.applyCreatorChange(m, {
      ownerDocId: instructor.docId,
      ownerName: instructor.name,
      ownerMemberId: instructor.memberId,
      ownerInstructorId: instructor.instructorId,
      ownerContactEmail: '',
      ownerContactUrl: '',
    }));
  }

  // Assign the creator from the member autocomplete (admin-only). Caches the
  // member's identity; instructorId may be '' for a non-instructor.
  updateOwnerMember(value: string) {
    const memberId = this.extractMemberId(value);
    const member = this.dataService.getMemberByMemberId(memberId);
    if (!member) return;
    this.eventFormModel.update((m) => this.applyCreatorChange(m, {
      ownerDocId: member.docId,
      ownerName: member.name,
      ownerMemberId: member.memberId,
      ownerInstructorId: member.instructorId || '',
      ownerContactEmail: m.ownerContactEmail,
      ownerContactUrl: m.ownerContactUrl,
    }));
  }

  // Link to the owner's member page (admin member view), for the "jump to member"
  // eye icon next to a selected non-instructor owner. '' when no owner.
  ownerMemberLink = computed(() => {
    const docId = this.eventFormModel().ownerDocId;
    if (!docId) return '';
    return this.routingService.hrefForView(Views.ManageMemberView, { memberId: docId });
  });

  clearOwner() {
    this.eventFormModel.update((m) => this.applyCreatorChange(m, {
      ownerDocId: '',
      ownerName: '',
      ownerMemberId: '',
      ownerInstructorId: '',
      ownerContactEmail: '',
      ownerContactUrl: '',
    }));
  }

  updateOwnerContactField(
    field: 'ownerName' | 'ownerContactEmail' | 'ownerContactUrl',
    event: Event,
  ) {
    const value = (event.target as HTMLInputElement).value;
    this.eventFormModel.update((m) => ({ ...m, [field]: value }));
  }

  // Managers are stored as member doc IDs but picked by instructorId. The
  // instructor cache is public (unlike `members`, which only admins load in
  // full), so it is the lookup that works for every viewer; `members` is only a
  // fallback for a manager who is no longer a listed instructor.
  private instructorsByDocId = computed(() => {
    const byDocId = new Map<string, InstructorPublicData>();
    for (const instructor of this.dataService.instructors.entries()) {
      byDocId.set(instructor.docId, instructor);
    }
    return byDocId;
  });

  // The instructorId for a member doc ID, or '' if they have no public
  // instructor profile. Used for the manager row's value, which must round-trip
  // with updateManagerDocId below, otherwise a just-picked manager renders as
  // "None selected".
  instructorIdForMember(memberDocId: string): string {
    if (!memberDocId) return '';
    return (
      this.instructorsByDocId().get(memberDocId)?.instructorId ||
      this.dataService.members.get(memberDocId)?.instructorId ||
      ''
    );
  }

  // Text that doesn't (yet) name an instructor clears the row rather than
  // leaving the previous manager in place: the row shows nothing selected, so
  // keeping the old doc ID would silently discard the edit and leave the Save
  // button disabled.
  updateManagerDocId(index: number, value: string) {
    const instructorId = this.extractInstructorId(value);
    const instructor = this.dataService.instructors.get(instructorId);
    this.eventFormModel.update((m) => {
      const managerDocIds = [...m.managerDocIds];
      const previousDocId = managerDocIds[index] || '';
      const nextDocId = instructor?.docId || '';
      managerDocIds[index] = nextDocId;
      const next = { ...m, managerDocIds };
      // A listed manager who is swapped out hands their contact listing to
      // whoever replaces them; clearing the row drops the listing entirely.
      if (!isContactIn(m, previousDocId) || previousDocId === m.ownerDocId) return next;
      const withoutPrevious = this.withoutContact(next, previousDocId);
      return nextDocId ? this.withContact(withoutPrevious, nextDocId) : withoutPrevious;
    });
  }

  addEmptyManagerRow() {
    this.eventFormModel.update((m) => ({
      ...m,
      managerDocIds: [...m.managerDocIds, '']
    }));
  }

  removeManagerDocId(index: number) {
    this.eventFormModel.update((m) => {
      const removedDocId = m.managerDocIds[index] || '';
      const next = {
        ...m,
        managerDocIds: m.managerDocIds.filter((_, i) => i !== index),
      };
      // Someone who is no longer on the team can no longer be a contact —
      // unless they are the creator, who is on the team either way.
      return removedDocId && removedDocId !== m.ownerDocId
        ? this.withoutContact(next, removedDocId)
        : next;
    });
  }

  // --- Publicly listed contacts ----------------------------------------
  // Membership of `contacts` is the "listed as a contact" flag; only the
  // creator and the managers may appear in it. The creator's entry takes its
  // display name and contact details from the owner* fields at save time (they
  // stay the single place those are edited), so entries here for the creator
  // hold no separately-edited state.

  isListedContact(memberDocId: string): boolean {
    return isContactIn(this.eventFormModel(), memberDocId);
  }

  contactFor(memberDocId: string): EventContact | undefined {
    return this.eventFormModel().contacts.find((c) => c.memberDocId === memberDocId);
  }

  // A contact with a public instructor profile needs no separately-entered
  // name, email or link — the event page links to their profile instead. The
  // cached instructorId is the fallback for someone who has since dropped off
  // the public instructor list.
  contactIsInstructor(memberDocId: string): boolean {
    return !!(
      this.instructorIdForMember(memberDocId) ||
      this.contactFor(memberDocId)?.instructorId
    );
  }

  setContactListed(memberDocId: string, listed: boolean) {
    if (!memberDocId) return;
    this.eventFormModel.update((m) =>
      listed ? this.withContact(m, memberDocId) : this.withoutContact(m, memberDocId));
  }

  updateContactField(
    memberDocId: string,
    field: 'contactEmail' | 'contactUrl',
    event: Event,
  ) {
    const value = (event.target as HTMLInputElement).value;
    this.eventFormModel.update((m) => ({
      ...m,
      contacts: m.contacts.map((c) =>
        c.memberDocId === memberDocId ? { ...c, [field]: value } : c),
    }));
  }

  // Add a contact entry, caching what we know of the member for display. The
  // onEventUpdated trigger refreshes these fields server-side after each save.
  private withContact(m: EventFormModel, memberDocId: string): EventFormModel {
    if (!memberDocId || m.contacts.some((c) => c.memberDocId === memberDocId)) return m;
    const member = this.dataService.members.get(memberDocId);
    const contact: EventContact = memberDocId === m.ownerDocId
      ? {
        memberDocId,
        name: m.ownerName,
        memberId: m.ownerMemberId,
        instructorId: m.ownerInstructorId,
        contactEmail: m.ownerContactEmail,
        contactUrl: m.ownerContactUrl,
      }
      : {
        ...initEventContact(),
        memberDocId,
        name: member?.name || '',
        memberId: member?.memberId || '',
        instructorId: member?.instructorId || '',
      };
    return { ...m, contacts: [...m.contacts, contact] };
  }

  private withoutContact(m: EventFormModel, memberDocId: string): EventFormModel {
    return { ...m, contacts: m.contacts.filter((c) => c.memberDocId !== memberDocId) };
  }

  // Swap in a new creator. The outgoing creator's contact entry goes unless
  // they are also a manager, and the incoming creator inherits the "listed"
  // state so an event never silently loses its only contact.
  private applyCreatorChange(
    m: EventFormModel,
    creator: Pick<EventFormModel,
      'ownerDocId' | 'ownerName' | 'ownerMemberId' | 'ownerInstructorId'
      | 'ownerContactEmail' | 'ownerContactUrl'>,
  ): EventFormModel {
    const wasListed = isContactIn(m, m.ownerDocId);
    const previousWasManager = m.managerDocIds.includes(m.ownerDocId);
    let next: EventFormModel = { ...m, ...creator };
    if (m.ownerDocId && !previousWasManager) {
      next = this.withoutContact(next, m.ownerDocId);
    }
    return wasListed ? this.withContact(next, creator.ownerDocId) : next;
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
      // 1. Load materials from Firestore uploads subcollection (indexed metadata)
      const firestoreUploads = await this.dataService.getEventUploads(eventDocId).catch((err) => {
        console.warn('Could not query Firestore event uploads:', err);
        return [] as UploadItem[];
      });

      const loadedMap = new Map<string, Material>();
      for (const u of firestoreUploads) {
        const key = u.storagePath || u.docId;
        loadedMap.set(key, {
          docId: u.docId,
          memberDocId: u.memberDocId,
          itemId: u.docId,
          name: u.name,
          contentType: u.contentType,
          size: u.size,
          url: u.url,
          previewUrl: u.previewUrl,
          storagePath: u.storagePath,
          previewStoragePath: u.previewStoragePath,
          date: u.date,
          location: u.location,
          notes: u.notes,
        });
      }

      // 2. Also check Cloud Storage for any legacy files not yet in Firestore
      const storage = getStorage(this.firebaseApp);
      const originalsRoot = ref(storage, `events/${eventDocId}/materials/originals`);
      const listed = await listAll(originalsRoot).catch(() => ({ prefixes: [] }));

      await Promise.all(
        listed.prefixes.map(async (itemFolder) => {
          const folderKey = itemFolder.name;
          const expectedStoragePath = `events/${eventDocId}/materials/originals/${folderKey}/original`;
          if (loadedMap.has(expectedStoragePath)) return; // already loaded from Firestore

          try {
            const original = this.originalRef(eventDocId, folderKey);
            const [md, url] = await Promise.all([
              getMetadata(original),
              getDownloadURL(original),
            ]);
            const previewUrl = await getDownloadURL(this.previewRef(eventDocId, folderKey)).catch(
              () => undefined,
            );
            const material: Material = {
              itemId: folderKey,
              name: md.customMetadata?.['name'] || folderKey,
              contentType: md.contentType || '',
              size: md.size || 0,
              url,
              previewUrl,
              storagePath: expectedStoragePath,
              previewStoragePath: `events/${eventDocId}/materials/previews/${folderKey}.jpg`,
            };
            loadedMap.set(expectedStoragePath, material);
          } catch (storageErr) {
            console.warn(`Error reading legacy material ${folderKey}:`, storageErr);
          }
        }),
      );

      const loaded = Array.from(loadedMap.values());
      // Stable order: newest first
      loaded.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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

    const ev = this.event();
    const currentUser = this.firebaseState.user();
    const uploaderMemberDocId = currentUser?.member?.docId || ev?.ownerDocId || '';
    const uploaderMemberId = currentUser?.member?.memberId || ev?.ownerMemberId || '';
    const uploaderMemberName = currentUser?.member?.name || ev?.ownerName || '';
    const uploaderInstructorId = currentUser?.member?.instructorId || ev?.ownerInstructorId || '';

    const failures: string[] = [];

    for (const file of files) {
      const folderKey = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const storagePath = `events/${eventDocId}/materials/originals/${folderKey}/original`;
      const previewStoragePath = `events/${eventDocId}/materials/previews/${folderKey}.jpg`;

      try {
        const storage = getStorage(this.firebaseApp);
        const original = this.originalRef(eventDocId, folderKey);
        await uploadBytes(original, file, {
          contentType: file.type || 'application/octet-stream',
          customMetadata: { name: file.name },
        });
        const url = await getDownloadURL(original);

        // Best-effort preview; failure just means the UI shows an icon.
        let previewUrl: string | undefined;
        try {
          const thumb = await makeThumbnail(file, this.MATERIAL_PREVIEW_MAX_DIM);
          const preview = this.previewRef(eventDocId, folderKey);
          await uploadBytes(preview, thumb, { contentType: 'image/jpeg' });
          previewUrl = await getDownloadURL(preview);
        } catch (previewError) {
          console.warn(`No preview generated for "${file.name}":`, previewError);
        }

        // Create Firestore UploadItem metadata document if uploader has a member record
        let docId: string | undefined;
        if (uploaderMemberDocId) {
          try {
            docId = await this.dataService.createUploadItem({
              memberDocId: uploaderMemberDocId,
              memberId: uploaderMemberId,
              memberName: uploaderMemberName,
              instructorId: uploaderInstructorId,
              name: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              url,
              previewUrl: previewUrl || '',
              storagePath,
              previewStoragePath: previewUrl ? previewStoragePath : '',
              date: ev?.start ? ev.start.split('T')[0] : new Date().toISOString().split('T')[0],
              location: ev?.location || '',
              eventDocId,
              eventTitle: ev?.title || '',
              notes: '',
              tags: [],
              source: 'event',
              createdAt: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            });
          } catch (fsErr) {
            console.warn('Could not write Firestore upload metadata doc for event material:', fsErr);
          }
        }

        const material: Material = {
          docId,
          memberDocId: uploaderMemberDocId,
          itemId: folderKey,
          name: file.name,
          contentType: file.type || '',
          size: file.size,
          url,
          previewUrl,
          storagePath,
          previewStoragePath,
          date: ev?.start ? ev.start.split('T')[0] : '',
          location: ev?.location || '',
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

      // Delete Firestore doc if present
      if (material.docId && material.memberDocId) {
        await this.dataService.deleteUploadItem({
          docId: material.docId,
          memberDocId: material.memberDocId,
        } as UploadItem).catch((err) => console.warn('Failed to delete Firestore upload doc:', err));
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
    const material = this.materials().find((m) => m.itemId === itemId);

    // Optimistically reflect the new name; persist to object metadata.
    this.materials.update((list) =>
      list.map((m) => (m.itemId === itemId ? { ...m, name } : m)),
    );
    try {
      await updateMetadata(this.originalRef(ev.docId, itemId), {
        customMetadata: { name },
      });

      // Update Firestore doc if present
      if (material?.docId && material?.memberDocId) {
        await this.dataService.updateUploadMetadata(material.memberDocId, material.docId, { name });
      }
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
      // A creator the event only stored as a doc ID gets their identity cached
      // on save, so their public contact entry resolves to an instructor
      // profile instead of showing up as a bare name.
      const formData = {
        ...this.editableEvent(),
        ownerName: this.creatorName(),
        ownerMemberId: this.creatorMemberId(),
        ownerInstructorId: this.creatorInstructorId(),
      };
      const managerDocIds = formData.managerDocIds.filter(Boolean);
      const contacts = contactsToSave({ ...formData, managerDocIds });
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
        ownerName: formData.ownerName,
        ownerMemberId: formData.ownerMemberId,
        ownerInstructorId: formData.ownerInstructorId,
        ownerContactEmail: formData.ownerContactEmail,
        ownerContactUrl: formData.ownerContactUrl,
        managerDocIds,
        contacts,
        leadingInstructorId: formData.leadingInstructorId,
        schoolId: formData.schoolId,
        schoolDocId: formData.schoolDocId,
        documents: formData.documents,
        kind: EventSourceKind.FirebaseSourced,
        lastUpdated: new Date().toISOString(),
        updatedByEmail: this.firebaseState.user()?.firebaseUser.email || '',
      });
      this.successMessage.set('Event saved successfully.');
      // Mirror the persisted manager/contact lists back into the form model so
      // isDirty resets (both are normalised on the way out).
      this.eventFormModel.update((m) => ({ ...m, managerDocIds, contacts }));
      // Update the local event data so isDirty resets
      this.event.set({
        ...eventData,
        ...formData,
        managerDocIds,
        contacts,
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
