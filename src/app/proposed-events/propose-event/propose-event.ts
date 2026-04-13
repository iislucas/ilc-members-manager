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
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

@Component({
  selector: 'app-propose-event',
  standalone: true,
  imports: [FormsModule, FormField, IconComponent, SpinnerComponent, AutocompleteComponent, MobileEditor],
  templateUrl: './propose-event.html',
  styleUrl: './propose-event.scss'
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

  onHeroImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.selectedImageFile.set(file);
    this.imagePreviewUrl.set(URL.createObjectURL(file));
    this.proposeForm().dirty();
  }

  removeHeroImage() {
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
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
        const file = this.selectedImageFile();
        
        if (file) {
          this.isUploadingImage.set(true);
          try {
            const storage = getStorage(this.firebaseApp);
            const storageRef = ref(storage, `events/${docId}/heroImage`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            
            const db = getFirestore(this.firebaseApp);
            const docRef = doc(db, 'events', docId);
            await updateDoc(docRef, { heroImageUrl: url });
          } catch (uploadError) {
            console.error('Error uploading image after proposal:', uploadError);
            this.errorMessage.set('Event proposed, but image upload failed.');
          } finally {
            this.isUploadingImage.set(false);
          }
        }

        this.successMessage.set('Event proposal submitted successfully!');
        this.proposeForm().reset();
        this.eventModel.set({
          title: '',
          start: '',
          end: '',
          location: '',
          description: '',
          leadingInstructorId: '',
        });
        this.selectedImageFile.set(null);
        this.imagePreviewUrl.set(null);
        localStorage.removeItem('proposeEventFormData');
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
