import { Component, inject } from '@angular/core';
import { EventListComponent } from './event-list/event-list';
import { environment } from '../../environments/environment';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';

@Component({
  selector: 'app-events-calendar',
  standalone: true,
  imports: [EventListComponent],
  templateUrl: './events-calendar.html',
  styleUrl: './events-calendar.scss',
})
export class EventsCalendarComponent {
  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  readonly calendarId = environment.googleCalendar.calendarId;

  goBackToLogin() {
    this.routingService.navigateToParts(['login']);
  }
}
