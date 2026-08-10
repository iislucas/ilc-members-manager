import { Component, inject, signal, effect, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, required, FieldTree, FormField } from '@angular/forms/signals';
import { FirebaseStateService } from '../../firebase-state.service';
import { httpsCallable } from 'firebase/functions';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns, FIREBASE_APP } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { DataManagerService } from '../../data-manager.service';
import { InstructorPublicData, EventDocument } from '../../../../functions/src/data-model';
import { PublicInstructorSelectorComponent } from '../../public-instructor-selector/public-instructor-selector';
import { InstructorSelectorComponent } from '../../instructor-selector/instructor-selector';
import { MarkdownEditor } from '../../markdown-editor/markdown-editor';
import { ImageUploadPreviewComponent } from '../../image-upload-preview/image-upload-preview';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

@Component({
  selector: 'app-organise-event',
  standalone: true,
  imports: [FormsModule, FormField, IconComponent, SpinnerComponent, PublicInstructorSelectorComponent, InstructorSelectorComponent, MarkdownEditor, ImageUploadPreviewComponent],
  templateUrl: './organise-event.html',
  styleUrl: './organise-event.scss'
})
export class ProposeEventComponent {
  private firebaseState = inject(FirebaseStateService);
  private routingService = inject(RoutingService<AppPathPatterns>);
  protected membersService = inject(DataManagerService);
  private firebaseApp = inject(FIREBASE_APP);

  isSaving = signal(false);
  isUploadingImage = signal(false);
  selectedImageFile = signal<File | null>(null);
  imagePreviewUrl = signal<string | null>(null);
  croppedThumbBlob = signal<Blob | null>(null);
  croppedLargeBlob = signal<Blob | null>(null);
  originalImagePreviewUrl = signal<string | null>(null);
  showImageUploader = signal(true);
  pendingDocumentFiles = signal<{ file: File; name: string }[]>([]);
  isUploadingDocuments = signal(false);

  // Maximum number of documents allowed per event.
  private readonly MAX_DOCUMENTS = 10;

  constructor() {
    window.scrollTo(0, 0);

    // Load from local storage
    const savedData = localStorage.getItem('proposeEventFormData');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        this.eventModel.update(current => ({ ...current, ...parsed }));
      } catch (e) {
        console.error('Failed to parse saved form data', e);
      }
    }

    // Save to local storage on changes
    effect(() => {
      localStorage.setItem('proposeEventFormData', JSON.stringify(this.eventModel()));
    });

    // Default the owner (main contact) to the submitter once the member loads,
    // unless one has already been chosen / restored from local storage.
    effect(() => {
      const member = this.submitter();
      if (member && !this.eventModel().ownerDocId) {
        this.eventModel.update(m => ({ ...m, ownerDocId: member.docId }));
      }
    });

    // Prefill the non-instructor mini-profile from the submitter's own details the
    // first time they load, without clobbering anything restored from local storage
    // or already typed.
    effect(() => {
      const member = this.submitter();
      if (!member || member.instructorId) return;
      this.eventModel.update(m => {
        if (m.ownerContactName || m.ownerContactEmail) return m;
        return {
          ...m,
          ownerContactName: member.name || '',
          ownerContactEmail: member.publicEmail || member.emails?.[0] || '',
        };
      });
    });
  }
  errorMessage = signal<string | null>(null);
  imageUploadError = signal<string | null>(null);
  documentUploadError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  eventModel = signal({
    title: '',
    start: '',
    end: '',
    location: '',
    description: '',
    leadingInstructorId: '',
    // Member doc ID of the event owner (main contact). Defaults to the submitter.
    ownerDocId: '',
    // Inline custom contact info for the owner.
    ownerContactName: '',
    ownerContactEmail: '',
    ownerContactUrl: '',
    // Member doc IDs of the *additional* managers. The submitter is always a
    // manager too (shown as a pinned row) and is added server-side.
    managerDocIds: [] as string[],
    // The managers ticked to be listed publicly as contacts for the event. The
    // owner is always a contact on a new proposal (added in onSubmit).
    contactDocIds: [] as string[],
    // Whether custom contact info is provided for an instructor owner.
    hasCustomContactInfo: false,
  });

  // The submitting member — always pinned as a manager of the event.
  submitter = computed(() => this.firebaseState.user()?.member ?? null);

  // Whether the submitter is an instructor.
  submitterIsInstructor = computed(() => !!this.submitter()?.instructorId);

  // Reverse lookup: find an instructor by their member doc ID.
  instructorByDocId(docId: string): InstructorPublicData | undefined {
    if (!docId) return undefined;
    for (const instructor of this.membersService.instructors.entries()) {
      if (instructor.docId === docId) return instructor;
    }
    return undefined;
  }

  // The instructorId for the selected owner docId.
  ownerInstructorId = computed(() => {
    const docId = this.eventModel().ownerDocId;
    if (!docId) return '';
    const inst = this.instructorByDocId(docId);
    if (inst) return inst.instructorId;
    const me = this.submitter();
    if (me && me.docId === docId && me.instructorId) {
      return me.instructorId;
    }
    return '';
  });

  // Whether the current owner resolves to an instructor.
  ownerIsInstructor = computed(() => !!this.ownerInstructorId());

  // Whether the owner is still the submitter (vs. reassigned to another instructor).
  ownerIsSubmitter = computed(() => {
    const me = this.submitter();
    return !!me && this.eventModel().ownerDocId === me.docId;
  });

  // Whether custom contact info is toggled on.
  hasCustomContactInfo = computed(() => this.eventModel().hasCustomContactInfo);

  // Whether to show the custom contact card:
  // Required and always shown for non-instructor owners, or when toggled for instructor owners.
  showCustomContactCard = computed(() => !this.ownerIsInstructor() || this.hasCustomContactInfo());

  // Field-level invalidity computeds for red text/styling.
  isContactNameInvalid = computed(() => {
    return this.showCustomContactCard() && !this.eventModel().ownerContactName.trim();
  });

  isContactEmailInvalid = computed(() => {
    return this.showCustomContactCard() && !this.eventModel().ownerContactEmail.trim();
  });

  isOwnerInvalid = computed(() => {
    if (!this.eventModel().ownerDocId) return true;
    if (this.showCustomContactCard()) {
      return !this.eventModel().ownerContactName.trim() || !this.eventModel().ownerContactEmail.trim();
    }
    return false;
  });

  proposeForm = form(this.eventModel, (schema) => {
    required(schema.title, { message: 'Title required.' });
    required(schema.start, { message: 'Start date required.' });
    required(schema.end, { message: 'End date required.' });
    required(schema.leadingInstructorId, { message: 'Instructor required.' });
  });

  // Reactively collects specific validation error messages from required fields.
  missingFields = computed(() => {
    const errors: string[] = [];
    const fields = [
      { field: this.proposeForm.title, label: 'Title' },
      { field: this.proposeForm.start, label: 'Start date' },
      { field: this.proposeForm.end, label: 'End date' },
      { field: this.proposeForm.leadingInstructorId, label: 'Instructor' },
    ];
    for (const { field, label } of fields) {
      const fieldErrors = field().errors();
      if (fieldErrors.length > 0) {
        for (const err of fieldErrors) {
          errors.push(err.message || `${label} is required.`);
        }
      }
    }
    if (!this.eventModel().ownerDocId) {
      errors.push('Main contact (event owner) is required.');
    }
    if (!this.ownerContactValid()) {
      errors.push('Contact name and email for the main contact.');
    }
    return errors;
  });

  // A non-instructor owner (or an instructor with custom contact info) needs name and email.
  ownerContactValid = computed(() => {
    if (!this.showCustomContactCard()) return true;
    const m = this.eventModel();
    return !!m.ownerContactName.trim() && !!m.ownerContactEmail.trim();
  });

  ownerValid = computed(() => {
    return !!this.eventModel().ownerDocId && this.ownerContactValid();
  });

  private extractInstructorId(value: string): string {
    const match = value.match(/\[([^\]]+)\]$/);
    return match ? match[1] : value.trim();
  }

  updateLeadingInstructorId(value: string) {
    const id = this.extractInstructorId(value);
    this.eventModel.update(m => ({ ...m, leadingInstructorId: id }));
    this.proposeForm().dirty();
  }

  setHasCustomContactInfo(enabled: boolean) {
    this.eventModel.update(m => {
      const updated = { ...m, hasCustomContactInfo: enabled };
      if (enabled && !updated.ownerContactName && !updated.ownerContactEmail) {
        const me = this.submitter();
        const ownerInst = this.instructorByDocId(m.ownerDocId);
        updated.ownerContactName = ownerInst?.name || me?.name || '';
        updated.ownerContactEmail = me?.publicEmail || me?.emails?.[0] || '';
      }
      return updated;
    });
    this.proposeForm().dirty();
  }

  updateOwnerInstructor(value: string) {
    const instructorId = this.extractInstructorId(value);
    const instructor = this.membersService.instructors.get(instructorId);
    if (instructor) {
      this.eventModel.update(m => ({
        ...m,
        ownerDocId: instructor.docId,
        ownerContactName: m.hasCustomContactInfo ? m.ownerContactName : '',
        ownerContactEmail: m.hasCustomContactInfo ? m.ownerContactEmail : '',
        ownerContactUrl: m.hasCustomContactInfo ? m.ownerContactUrl : '',
      }));
      this.proposeForm().dirty();
    } else if (!instructorId) {
      this.eventModel.update(m => ({
        ...m,
        ownerDocId: '',
      }));
      this.proposeForm().dirty();
    }
  }

  updateOwnerDocId(value: string) {
    this.updateOwnerInstructor(value);
  }

  // Return ownership to the submitter (used to undo a reassignment).
  resetOwnerToMe() {
    const me = this.submitter();
    if (!me) return;
    this.eventModel.update(m => ({
      ...m,
      ownerDocId: me.docId,
      ownerContactName: me.instructorId ? '' : (me.name || ''),
      ownerContactEmail: me.instructorId ? '' : (me.publicEmail || me.emails?.[0] || ''),
      hasCustomContactInfo: false,
    }));
    this.proposeForm().dirty();
  }

  updateOwnerContactField(field: 'ownerContactName' | 'ownerContactEmail' | 'ownerContactUrl', event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.eventModel.update(m => ({ ...m, [field]: value }));
    this.proposeForm().dirty();
  }

  updateManagerDocId(index: number, value: string) {
    const instructorId = this.extractInstructorId(value);
    const instructor = this.membersService.instructors.get(instructorId);
    if (!instructor) return;
    this.eventModel.update(m => {
      const managerDocIds = [...m.managerDocIds];
      const previousDocId = managerDocIds[index] || '';
      managerDocIds[index] = instructor.docId;
      // A manager swapped out hands their contact listing to their replacement.
      const contactDocIds = m.contactDocIds.includes(previousDocId)
        ? [...m.contactDocIds.filter(id => id !== previousDocId), instructor.docId]
        : m.contactDocIds;
      return { ...m, managerDocIds, contactDocIds };
    });
    this.proposeForm().dirty();
  }

  addEmptyManagerRow() {
    this.eventModel.update(m => ({ ...m, managerDocIds: [...m.managerDocIds, ''] }));
  }

  removeManagerDocId(index: number) {
    this.eventModel.update(m => {
      const removedDocId = m.managerDocIds[index] || '';
      return {
        ...m,
        managerDocIds: m.managerDocIds.filter((_, i) => i !== index),
        contactDocIds: m.contactDocIds.filter(id => id !== removedDocId),
      };
    });
    this.proposeForm().dirty();
  }

  // Whether a manager is ticked to be listed publicly as a contact. The
  // submitter/owner is always a contact, so they have no checkbox.
  isListedContact(managerDocId: string): boolean {
    return !!managerDocId && this.eventModel().contactDocIds.includes(managerDocId);
  }

  setContactListed(managerDocId: string, listed: boolean) {
    if (!managerDocId) return;
    this.eventModel.update(m => ({
      ...m,
      contactDocIds: listed
        ? [...m.contactDocIds.filter(id => id !== managerDocId), managerDocId]
        : m.contactDocIds.filter(id => id !== managerDocId),
    }));
    this.proposeForm().dirty();
  }


  onDescriptionChanged(val: string) {
    this.eventModel.update(m => ({ ...m, description: val }));
    this.proposeForm().dirty();
  }

  onImageCropped(event: { thumbBlob: Blob, largeBlob: Blob, originalFile?: File }) {
    this.croppedThumbBlob.set(event.thumbBlob);
    this.croppedLargeBlob.set(event.largeBlob);
    if (event.originalFile) {
      this.selectedImageFile.set(event.originalFile);
      this.originalImagePreviewUrl.set(URL.createObjectURL(event.originalFile));
    }
    this.imagePreviewUrl.set(URL.createObjectURL(event.largeBlob));
    this.showImageUploader.set(false);
    this.proposeForm().dirty();
  }

  removeHeroImage() {
    this.croppedThumbBlob.set(null);
    this.croppedLargeBlob.set(null);
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
    this.originalImagePreviewUrl.set(null);
    this.showImageUploader.set(true);
    this.proposeForm().dirty();
  }

  // Document staging methods (files are uploaded after proposal submission)

  onDocumentFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const current = this.pendingDocumentFiles();
    const remaining = this.MAX_DOCUMENTS - current.length;
    if (remaining <= 0) {
      this.documentUploadError.set(`Maximum of ${this.MAX_DOCUMENTS} documents reached.`);
      return;
    }

    const newEntries = Array.from(files).slice(0, remaining).map(f => ({
      file: f,
      name: f.name,
    }));

    this.pendingDocumentFiles.update(list => [...list, ...newEntries]);
    this.proposeForm().dirty();

    // Reset input so the same file can be re-selected
    input.value = '';
  }

  updateDocumentName(index: number, event: Event) {
    const name = (event.target as HTMLInputElement).value;
    this.pendingDocumentFiles.update(list => {
      const updated = [...list];
      updated[index] = { ...updated[index], name };
      return updated;
    });
  }

  removeDocument(index: number) {
    this.pendingDocumentFiles.update(list => list.filter((_, i) => i !== index));
  }

  async onSubmit() {
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.isSaving.set(true);

    try {
      const submitFn = httpsCallable<any, { success: boolean, docId: string }>(
        this.firebaseState.functions,
        'submitProposedEvent'
      );

      const model = this.eventModel();
      const customContact = this.showCustomContactCard();
      const result = await submitFn({
        ...model,
        ownerContactName: customContact ? model.ownerContactName.trim() : '',
        ownerContactEmail: customContact ? model.ownerContactEmail.trim() : '',
        ownerContactUrl: customContact ? model.ownerContactUrl.trim() : '',
        // The owner is always listed as a contact on a new proposal; any ticked
        // managers are listed alongside them.
        contactDocIds: [model.ownerDocId, ...model.contactDocIds].filter(Boolean),
      });

      if (result.data.success) {
        const docId = result.data.docId;
        const thumbBlob = this.croppedThumbBlob();
        const largeBlob = this.croppedLargeBlob();
        const originalFile = this.selectedImageFile();
        
        if (thumbBlob && largeBlob) {
          this.isUploadingImage.set(true);
          try {
            const storage = getStorage(this.firebaseApp);
            
            // Upload Large (600x400)
            const largeRef = ref(storage, `events/${docId}/images/heroImage_large`);
            await uploadBytes(largeRef, largeBlob);
            const largeUrl = await getDownloadURL(largeRef);

            // Upload Thumb (120x80)
            const thumbRef = ref(storage, `events/${docId}/images/heroImage_thumb`);
            await uploadBytes(thumbRef, thumbBlob);
            const thumbUrl = await getDownloadURL(thumbRef);

            // Upload Original (if present)
            let originalUrl = '';
            if (originalFile) {
              const originalRef = ref(storage, `events/${docId}/images/heroImage_original`);
              await uploadBytes(originalRef, originalFile);
              originalUrl = await getDownloadURL(originalRef);
            }
            
            const db = getFirestore(this.firebaseApp);
            const docRef = doc(db, 'events', docId);
            await updateDoc(docRef, { 
              heroImageUrl: largeUrl,
              heroImageLargeUrl: largeUrl,
              heroImageThumbUrl: thumbUrl,
              heroImageOriginalUrl: originalUrl
            });
          } catch (uploadError) {
            console.error('Error uploading image after proposal:', uploadError);
            this.imageUploadError.set('Event proposed, but image upload failed.');
          } finally {
            this.isUploadingImage.set(false);
          }
        }

        // Upload pending documents
        const pendingDocs = this.pendingDocumentFiles();
        if (pendingDocs.length > 0) {
          this.isUploadingDocuments.set(true);
          try {
            const storage = getStorage(this.firebaseApp);
            const uploadedDocs: EventDocument[] = [];

            for (const entry of pendingDocs) {
              const timestamp = Date.now();
              const safeName = entry.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              const storagePath = `events/${docId}/documents/${timestamp}_${safeName}`;
              const fileRef = ref(storage, storagePath);
              await uploadBytes(fileRef, entry.file);
              const url = await getDownloadURL(fileRef);
              uploadedDocs.push({ name: entry.name, url });
            }

            const db = getFirestore(this.firebaseApp);
            const docRef = doc(db, 'events', docId);
            await updateDoc(docRef, { documents: uploadedDocs });
          } catch (uploadError) {
            console.error('Error uploading documents after proposal:', uploadError);
            this.documentUploadError.set('Event proposed, but document upload failed.');
          } finally {
            this.isUploadingDocuments.set(false);
          }
        }

        localStorage.removeItem('proposeEventFormData');
        this.routingService.navigateToParts(['my-events', docId, 'edit']);
      }
    } catch (error: any) {
      console.error('Error submitting event proposal:', error);
      this.errorMessage.set(error.message || 'Failed to submit proposal.');
    } finally {
      this.isSaving.set(false);
    }
  }

  goBack() {
    this.routingService.navigateToParts(['events']);
  }
}
