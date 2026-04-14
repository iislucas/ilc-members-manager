/* event-view.ts
 *
 * Component for viewing the full details of a single event.
 * Loads the event by sourceId or docId from the /events collection.
 */

import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { marked } from 'marked';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns, Views } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { FIREBASE_APP } from '../../app.config';
import { IlcEvent, initEvent } from '../../../../functions/src/data-model';
import { FirebaseStateService } from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { MarkdownViewer } from '../../mobile-editor/markdown-viewer';

@Component({
  selector: 'app-event-view',
  standalone: true,
  imports: [DatePipe, IconComponent, SpinnerComponent, MarkdownViewer],
  templateUrl: './event-view.html',
  styleUrl: './event-view.scss',
})
export class EventViewComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  firebaseState = inject(FirebaseStateService);
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  private dataService = inject(DataManagerService);

  eventId = input.required<string>();
  titleLoaded = output<string>();

  event = signal<IlcEvent | null>(null);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);
  imageLoaded = signal(false);


  isOwner = computed(() => {
    const user = this.firebaseState.user();
    const ev = this.event();
    return !!(user && ev && user.member.docId === ev.ownerDocId);
  });

  isAdmin = computed(() => this.firebaseState.user()?.isAdmin || false);

  canEdit = computed(() => this.isOwner() || this.isAdmin());

  editUrl = computed(() => {
    const view = this.routingService.matchedPatternId();
    const eventId = this.eventId();
    if (view === Views.MyEventView) {
      return this.routingService.hrefForView(Views.MyEventEdit, { eventId });
    }
    if (view === Views.ManageEventView) {
      return this.routingService.hrefForView(Views.ManageEventEdit, { eventId });
    }
    return this.routingService.hrefForView(Views.EventEdit, { eventId });
  });

  backHref = computed(() => {
    const view = this.routingService.matchedPatternId();
    if (view === Views.MyEventView) {
      return this.routingService.hrefForView(Views.MyEvents, {});
    }
    if (view === Views.ManageEventView) {
      return this.routingService.hrefForView(Views.ManageEvents, {});
    }
    return this.routingService.hrefForView(Views.EventsCalendar, {});
  });

  computedBackLabel = computed(() => {
    const view = this.routingService.matchedPatternId();
    if (view === Views.MyEventView) return 'My Events';
    if (view === Views.ManageEventView) return 'Manage Events';
    return 'Events List';
  });



  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadEvent();
  }

  async loadEvent() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const eventId = this.eventId();
      const event = await this.dataService.getEventById(eventId);
      if (event) {
        this.event.set(event);
        this.titleLoaded.emit(event.title);
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
}
