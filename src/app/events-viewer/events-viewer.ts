/* events-viewer.ts
 *
 * Standalone wrapper component for the Events Viewer web component.
 * Embeds the EventListComponent to display a searchable, public list
 * of ILC events. Uses ShadowDom encapsulation so it can be embedded
 * in any external page without style conflicts.
 *
 * Attributes:
 *   event-link-prefix – Controls where event detail links point.
 *     When set (e.g. "https://app.iliqchuan.com/#/events/"), clicks
 *     navigate to the main app. When empty, links are relative hash routes.
 *   initial-query – Optional initial search query to pre-populate the
 *     search field (e.g. "Seminar").
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { EventListComponent } from '../events-calendar/event-list/event-list';

@Component({
  selector: 'app-events-viewer',
  standalone: true,
  imports: [EventListComponent],
  templateUrl: './events-viewer.html',
  styleUrl: './events-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class EventsViewerComponent {
  // Base URL prefix for event detail links. Passed through to EventListComponent.
  // Example: "https://app.iliqchuan.com/#/events/"
  eventLinkPrefix = input<string>('https://app.iliqchuan.com/#/events/');

  // Base URL prefix for instructor profile links. Defaults to the main
  // app's Find an Instructor page so clicks navigate correctly from any host.
  instructorLinkPrefix = input<string>(
    'https://app.iliqchuan.com/#/find-an-instructor?instructorId=',
  );

  // Optional initial search query to pre-populate the search field.
  // Example: <app-events-viewer initial-query="Seminar"></app-events-viewer>
  initialQuery = input<string>('');
}
