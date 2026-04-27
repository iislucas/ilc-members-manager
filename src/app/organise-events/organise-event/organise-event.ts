import { Component, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, required, FieldTree, FormField } from '@angular/forms/signals';
import { FirebaseStateService } from '../../firebase-state.service';
import { httpsCallable } from 'firebase/functions';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns, FIREBASE_APP } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { DataManagerService } from '../../data-manager.service';
import { InstructorPublicData } from '../../../../functions/src/data-model';
import { AutocompleteComponent } from '../../autocomplete/autocomplete';
import { MobileEditor } from '../../mobile-editor/mobile-editor';
import { ImageUploadPreviewComponent } from '../../image-upload-preview/image-upload-preview';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

@Component({
  selector: 'app-organise-event',
  standalone: true,
  imports: [FormsModule, FormField, IconComponent, SpinnerComponent, AutocompleteComponent, MobileEditor, ImageUploadPreviewComponent],
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
  }
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  eventModel = signal({
    title: '',
    start: '',
    end: '',
    location: '',
    description: '',
    leadingInstructorId: '',
  });

  proposeForm = form(this.eventModel, (schema) => {
    required(schema.title, { message: 'Title required.' });
    required(schema.start, { message: 'Start date required.' });
    required(schema.end, { message: 'End date required.' });
  });

  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.name,
  };

  updateLeadingInstructorId(id: string) {
    this.eventModel.update(m => ({ ...m, leadingInstructorId: id }));
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

  async onSubmit() {
    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (!this.proposeForm().valid()) {
      this.errorMessage.set('Please fix the errors in the form.');
      return;
    }

    this.isSaving.set(true);

    try {
      const submitFn = httpsCallable<any, { success: boolean, docId: string }>(
        this.firebaseState.functions,
        'submitProposedEvent'
      );

      const result = await submitFn(this.eventModel());

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
            this.errorMessage.set('Event proposed, but image upload failed.');
          } finally {
            this.isUploadingImage.set(false);
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
