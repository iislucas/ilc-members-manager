/* event-view.ts
 *
 * Component for viewing the full details of a single event.
 * Loads the event by sourceId or docId from the /events collection.
 */

import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { FIREBASE_APP } from '../../app.config';
import { IlcEvent } from '../../../../functions/src/data-model';

@Component({
  selector: 'app-event-view',
  standalone: true,
  imports: [CommonModule, DatePipe, IconComponent, SpinnerComponent],
  templateUrl: './event-view.html',
  styleUrl: './event-view.scss',
})
export class EventViewComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);

  eventId = input.required<string>();
  backLabel = input<string>('Events List');
  titleLoaded = output<string>();

  event = signal<IlcEvent | null>(null);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadEvent();
  }

  async loadEvent() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const eventId = this.eventId();

      // First try loading by docId (for firebase-sourced events).
      const docRef = doc(this.db, 'events', eventId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = { ...docSnap.data(), docId: docSnap.id } as IlcEvent;
        this.event.set(data);
        this.titleLoaded.emit(data.title);
        return;
      }

      // Fall back to searching by sourceId (for calendar-sourced events).
      const q = query(
        collection(this.db, 'events'),
        where('sourceId', '==', eventId)
      );
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
        const data = { ...querySnap.docs[0].data(), docId: querySnap.docs[0].id } as IlcEvent;
        this.event.set(data);
        this.titleLoaded.emit(data.title);
      } else {
        this.errorMessage.set('Event not found.');
      }
    } catch (error) {
      console.error('Error loading event:', error);
      this.errorMessage.set('Failed to load event details.');
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.routingService.navigateToParts(['/events']);
  }
}
