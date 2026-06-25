/*
  This component displays and manages local device-level notification settings,
  saving selections directly to localStorage without requiring database writes.
  It also exposes standard push permission prompts and triggers manual test alerts.
*/

import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { NotificationService } from '../../notification.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { Member, NotificationKind } from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './notification-settings.component.html',
  styleUrl: './notification-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettingsComponent implements OnInit {
  protected notificationService = inject(NotificationService);
  private firebaseService = inject(FirebaseStateService);
  private dataManager = inject(DataManagerService);

  ngOnInit() {
    // The service's push subscription stream only emits once at app startup, so
    // re-read the device's live subscription each time the panel is shown to keep
    // the per-device toggle in sync (e.g. after navigating away and back).
    this.notificationService.refreshPushDeviceState?.();
  }

  protected localSettings = this.notificationService.localSettings;
  protected permissionStatus = this.notificationService.permissionStatus;
  protected currentUser = this.firebaseService.user;
  protected notificationKinds = Object.values(NotificationKind);

  // Whether web push is usable on this device (SW active + VAPID key configured).
  protected get pushSupported(): boolean {
    return this.notificationService.isPushSupported;
  }

  // This device's live push subscription state.
  protected pushDeviceEnabled = this.notificationService.pushDeviceEnabled;

  // Account-wide (server-side) push master switch. The per-device control can
  // only be turned on while this is enabled.
  protected globalPushEnabled = computed(
    () => this.currentUser()?.member?.notificationSettings?.globalPushEnabled === true,
  );

  // In-flight flag to disable controls while a server/device toggle is saving.
  protected pushBusy = signal(false);

  // Persist the account-wide push master switch to the member document.
  async setGlobalPush(enabled: boolean) {
    const member = this.currentUser()?.member;
    if (!member) return;
    this.pushBusy.set(true);
    try {
      const updated: Member = {
        ...member,
        notificationSettings: {
          pushEnabled: {},
          homeEnabled: {},
          ...member.notificationSettings,
          globalPushEnabled: enabled,
        },
      };
      await this.dataManager.updateMember(member.docId, updated, member);
      // Turning the account switch off leaves device subscriptions in place but
      // the server won't send; for a clean state, also unsubscribe this device.
      if (!enabled) {
        await this.notificationService.disablePushOnThisDevice();
      }
    } catch (e) {
      console.error('Failed to update account push setting', e);
    } finally {
      this.pushBusy.set(false);
    }
  }

  // Enable/disable web push on this specific device.
  async toggleDevicePush(enabled: boolean) {
    if (enabled && !this.globalPushEnabled()) return; // gated on the account switch
    this.pushBusy.set(true);
    try {
      if (enabled) {
        await this.notificationService.enablePushOnThisDevice();
      } else {
        await this.notificationService.disablePushOnThisDevice();
      }
    } catch (e) {
      console.error('Failed to toggle device push', e);
    } finally {
      this.pushBusy.set(false);
    }
  }

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
      case NotificationKind.GradingManagerAdded:
        return 'Added as Grading Manager';
      case NotificationKind.GradingManagerRemoved:
        return 'Removed as Grading Manager';
      case NotificationKind.GradingPurchased:
        return 'Grading Purchased';
      case NotificationKind.GradingPassed:
        return 'Grading Passed';
      case NotificationKind.GradingNotPassed:
        return 'Grading Result (Not Passed)';
      case NotificationKind.GradingUnpaid:
        return 'Grading Completed but Unpaid';
      case NotificationKind.BlogPost:
        return 'New Blog Post / Update';
      case NotificationKind.NewEventPosted:
        return 'New Event Posted';
      case NotificationKind.PendingEventApproval:
        return 'Event Awaiting Approval (Admins)';
      case NotificationKind.OrderNeedsAttention:
        return 'Order Needs Manual Processing (Admins)';
      case NotificationKind.PurchaseFulfilled:
        return 'Purchase Processed';
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
