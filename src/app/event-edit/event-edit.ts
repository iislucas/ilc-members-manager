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
} from '@angular/core';
import {
  form,
  FormField,
  required,
  FieldTree,
} from '@angular/forms/signals';
import { IlcEvent, EventStatus, EventSourceKind } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { deepObjEq } from '../utils';
import { doc, getDoc, getDocs, getFirestore, updateDoc, collection, query, where } from 'firebase/firestore';
import { FIREBASE_APP } from '../app.config';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

// Fields used in the event form model.
type EventFormModel = {
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  status: string;
};

function toFormModel(event: IlcEvent): EventFormModel {
  return {
    title: event.title || '',
    start: event.start || '',
    end: event.end || '',
    description: event.description || '',
    location: event.location || '',
    status: event.status || EventStatus.Proposed,
  };
}

@Component({
  selector: 'app-event-edit',
  standalone: true,
  imports: [FormField, IconComponent, SpinnerComponent],
  templateUrl: './event-edit.html',
  styleUrl: './event-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventEditComponent implements OnInit {
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  // Constants for template
  EventStatus = EventStatus;
  eventStatuses = Object.values(EventStatus);

  // Input: event ID from route
  eventId = input.required<string>();

  // Loaded event data from Firestore
  event = signal<IlcEvent | null>(null);
  isLoadingEvent = signal(true);
  loadError = signal<string | null>(null);

  // The form model signal.
  eventFormModel = signal<EventFormModel>({
    title: '', start: '', end: '', description: '', location: '',
    status: EventStatus.Proposed,
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
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  ngOnInit() {
    this.loadEvent();
  }

  async loadEvent() {
    this.isLoadingEvent.set(true);
    this.loadError.set(null);
    try {
      const id = this.eventId();

      // Try loading by docId first
      const docRef = doc(this.db, 'events', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = { ...docSnap.data(), docId: docSnap.id } as IlcEvent;
        this.event.set(data);
        this.eventFormModel.set(toFormModel(data));
        return;
      }

      // Fall back to sourceId
      const q = query(
        collection(this.db, 'events'),
        where('sourceId', '==', id)
      );
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
        const data = { ...querySnap.docs[0].data(), docId: querySnap.docs[0].id } as IlcEvent;
        this.event.set(data);
        this.eventFormModel.set(toFormModel(data));
      } else {
        this.loadError.set('Event not found.');
      }
    } catch (error) {
      console.error('Error loading event:', error);
      this.loadError.set('Failed to load event.');
    } finally {
      this.isLoadingEvent.set(false);
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
        description: formData.description,
        location: formData.location,
        status: formData.status,
        lastUpdated: new Date().toISOString(),
      });
      this.successMessage.set('Event saved successfully.');
      // Update the local event data so isDirty resets
      this.event.set({
        ...eventData,
        ...formData,
        status: formData.status as EventStatus,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error saving event:', error);
      this.errorMessage.set('Failed to save: ' + message);
    } finally {
      this.isSaving.set(false);
    }
  }

  goBack() {
    this.routingService.navigateToParts(['manage-events']);
  }
}
