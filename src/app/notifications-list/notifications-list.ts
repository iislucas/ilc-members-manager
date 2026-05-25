/*
  This component displays a list of active member notifications at the top of the homepage.
  It manages its own data stream from NotificationService, filters by homepage visibility
  preferences, and handles dismissals and route transitions directly.

  Usage:
    <app-notifications-list></app-notifications-list>
*/

import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MemberNotification, NotificationKind } from '../../../functions/src/data-model';
import { FirebaseStateService } from '../firebase-state.service';
import { NotificationService } from '../notification.service';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';

@Component({
  selector: 'app-notifications-list',
  standalone: true,
  imports: [DatePipe, IconComponent, MarkdownViewer],
  templateUrl: './notifications-list.html',
  styleUrl: './notifications-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsListComponent {
  private firebaseService = inject(FirebaseStateService);
  private notificationService = inject(NotificationService);
  private routingService = inject(RoutingService);

  protected user = this.firebaseService.user;

  notifications = computed(() => {
    const list = this.notificationService.notifications();
    const settings = this.user()?.member?.notificationSettings;
    return list.filter((n) => settings?.homeEnabled?.[n.kind] !== false);
  });

  async onDismiss(id: string) {
    try {
      await this.notificationService.dismissNotification(id);
    } catch (e) {
      console.error('Failed to dismiss notification', e);
    }
  }

  async onDismissAll() {
    try {
      await this.notificationService.dismissAll();
    } catch (e) {
      console.error('Failed to dismiss all notifications', e);
    }
  }

  isGradingNotification(n: MemberNotification): boolean {
    return [
      NotificationKind.GradingRequestAccepted,
      NotificationKind.GradingRequestDeclined,
      NotificationKind.GradingRequestsYouAsInstructor,
    ].includes(n.kind);
  }

  onCardClick(n: MemberNotification, event: Event) {
    if (this.isGradingNotification(n)) {
      const data = n.data as { gradingDocId: string };
      if (data.gradingDocId) {
        this.routingService.navigateToParts(['gradings', data.gradingDocId]);
      }
    }
  }
}
