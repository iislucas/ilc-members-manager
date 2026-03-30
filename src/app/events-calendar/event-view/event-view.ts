import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { collection, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { FIREBASE_APP } from '../../app.config';
import { CachedCalendarEvent } from '../../../../functions/src/data-model';

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

  event = signal<CachedCalendarEvent | null>(null);
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
      // Import the necessary functions at the top of the file if needed, or inline them here.
      // Wait, we need to make sure the imports are correct at the top! We will fix that separately.
      // Let's assume the imports are fixed at the top, or just use Firestore functions!
      // Since it's typescript, let's make sure the imports work. I'll fix the imports at top later.
      const q = query(
        collection(this.db, 'events'),
        where('sourceId', '==', this.eventId())
      );
      const querySnap = await getDocs(q);
      
      if (!querySnap.empty) {
        const data = querySnap.docs[0].data() as CachedCalendarEvent;
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
