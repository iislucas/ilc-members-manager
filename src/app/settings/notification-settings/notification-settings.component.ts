/*
  This component displays and manages local device-level notification settings,
  saving selections directly to localStorage without requiring database writes.
  It also exposes standard push permission prompts and triggers manual test alerts.
*/

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { NotificationService } from '../../notification.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { NotificationKind } from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './notification-settings.component.html',
  styleUrl: './notification-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettingsComponent {
  protected notificationService = inject(NotificationService);
  private firebaseService = inject(FirebaseStateService);

  protected localSettings = this.notificationService.localSettings;
  protected permissionStatus = this.notificationService.permissionStatus;
  protected currentUser = this.firebaseService.user;
  protected notificationKinds = Object.values(NotificationKind);

  setAllPush(enabled: boolean) {
    const updated: { [kind in NotificationKind]?: boolean } = {};
    this.notificationKinds.forEach((kind) => {
      updated[kind] = enabled;
    });
    this.notificationService.updateLocalSettings({ pushEnabled: updated });

    if (enabled && this.permissionStatus() === 'default') {
      this.notificationService.requestPermission();
    }
  }

  setAllHome(enabled: boolean) {
    const updated: { [kind in NotificationKind]?: boolean } = {};
    this.notificationKinds.forEach((kind) => {
      updated[kind] = enabled;
    });
    this.notificationService.updateLocalSettings({ homeEnabled: updated });
  }

  togglePushNotification(kind: NotificationKind, checked: boolean) {
    const current = this.localSettings().pushEnabled;
    this.notificationService.updateLocalSettings({
      pushEnabled: { ...current, [kind]: checked },
    });
  }

  toggleHomeNotification(kind: NotificationKind, checked: boolean) {
    const current = this.localSettings().homeEnabled;
    this.notificationService.updateLocalSettings({
      homeEnabled: { ...current, [kind]: checked },
    });
  }

  getNotificationKindLabel(kind: NotificationKind): string {
    switch (kind) {
      case NotificationKind.GradingRequestAccepted:
        return 'Grading Request Accepted';
      case NotificationKind.GradingRequestDeclined:
        return 'Grading Request Declined';
      case NotificationKind.GradingRequestsYouAsInstructor:
        return 'Grading Request Sent to You';
      case NotificationKind.GradingInstructorAdded:
        return 'Assigned as Grading Instructor';
      case NotificationKind.GradingInstructorRemoved:
        return 'Removed as Grading Instructor';
      case NotificationKind.BlogPost:
        return 'New Blog Post / Update';
      case NotificationKind.NewEventPosted:
        return 'New Event Posted';
      default:
        return kind;
    }
  }

  async sendTestNotification() {
    const docId = this.currentUser()?.member?.docId;
    if (!docId) return;

    try {
      const db = getFirestore(this.firebaseService.app);
      const notifRef = collection(db, 'members', docId, 'notifications');
      await addDoc(notifRef, {
        markdown: 'Hello! You asked to see a test notification, and this is it :)',
        createdAt: new Date().toISOString(),
        dismissed: false,
        kind: NotificationKind.NewEventPosted,
        data: {
          eventPath: '',
          title: 'Test Event',
          lastSeenDateStr: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error('Failed to send test notification', e);
    }
  }
}
