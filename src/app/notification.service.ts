import { inject, Injectable, signal, effect, OnDestroy } from '@angular/core';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  where,
  Unsubscribe,
  writeBatch,
} from 'firebase/firestore';
import { FirebaseStateService } from './firebase-state.service';
import { MemberNotification, NotificationKind, firestoreDocToMemberNotification } from '../../functions/src/data-model';

export interface LocalNotificationSettings {
  pushEnabled: { [kind in NotificationKind]?: boolean };
  homeEnabled: { [kind in NotificationKind]?: boolean };
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService implements OnDestroy {
  private firebaseService = inject(FirebaseStateService);
  private db = getFirestore(this.firebaseService.app);

  public notifications = signal<MemberNotification[]>([]);
  public permissionStatus = signal<NotificationPermission>('default');
  public localSettings = signal<LocalNotificationSettings>({
    pushEnabled: {},
    homeEnabled: {},
  });

  private unsubscripton: Unsubscribe | null = null;
  private pushedIdsKey = 'pushedNotificationDocIds';
  private isFirstSnapshot = true;

  constructor() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permissionStatus.set(Notification.permission);
    }
    this.loadLocalSettings();

    // Effect to react to changes in the authenticated user
    effect(() => {
      const user = this.firebaseService.user();
      if (user && user.member && user.member.docId) {
        this.subscribeToNotifications(user.member.docId);
      } else {
        this.unsubscribe();
        this.notifications.set([]);
      }
    });
  }

  ngOnDestroy() {
    this.unsubscribe();
  }

  private unsubscribe() {
    if (this.unsubscripton) {
      this.unsubscripton();
      this.unsubscripton = null;
    }
  }

  public async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    const permission = await Notification.requestPermission();
    this.permissionStatus.set(permission);
    return permission;
  }

  private subscribeToNotifications(memberDocId: string) {
    this.unsubscribe();
    this.isFirstSnapshot = true;

    const notifCollection = collection(this.db, 'members', memberDocId, 'notifications');
    const q = query(notifCollection, where('dismissed', '==', false));

    this.unsubscripton = onSnapshot(
      q,
      (snapshot) => {
        const list: MemberNotification[] = snapshot.docs.map(firestoreDocToMemberNotification);

        // Sort by createdAt desc
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        
        this.notifications.set(list);

        if (this.isFirstSnapshot) {
          // On first snapshot, seed the cache so we don't alert historical alerts
          this.seedPushedCache(list);
          this.isFirstSnapshot = false;
        } else {
          // Subsequent arrivals get pushed
          this.processPushNotifications(list);
        }
      },
      (error) => {
        console.error('Error listening to notifications subcollection:', error);
      }
    );
  }

  private seedPushedCache(activeNotifications: MemberNotification[]) {
    const pushedIds = this.getPushedIds();
    const merged = Array.from(new Set([...pushedIds, ...activeNotifications.map((n) => n.docId)]));
    try {
      localStorage.setItem(this.pushedIdsKey, JSON.stringify(merged));
    } catch (e) {
      console.error('Failed to seed pushed notifications cache', e);
    }
  }

  private getPushedIds(): string[] {
    try {
      const stored = localStorage.getItem(this.pushedIdsKey);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Error reading pushed notifications local storage cache:', e);
      return [];
    }
  }

  private loadLocalSettings() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('localNotificationSettings');
      if (stored) {
        this.localSettings.set(JSON.parse(stored));
      } else {
        const defaults: LocalNotificationSettings = {
          pushEnabled: {},
          homeEnabled: {},
        };
        this.localSettings.set(defaults);
        localStorage.setItem('localNotificationSettings', JSON.stringify(defaults));
      }
    } catch (e) {
      console.error('Error loading local notification settings:', e);
    }
  }

  public updateLocalSettings(update: Partial<LocalNotificationSettings>) {
    const current = this.localSettings();
    const merged = { ...current, ...update };
    this.localSettings.set(merged);
    try {
      localStorage.setItem('localNotificationSettings', JSON.stringify(merged));
    } catch (e) {
      console.error('Error saving local notification settings:', e);
    }
  }

  private processPushNotifications(activeNotifications: MemberNotification[]) {
    console.log('[NotificationService] Processing push notifications, active count:', activeNotifications.length);

    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.log('[NotificationService] Notification API is not available on this window context');
      return;
    }

    console.log('[NotificationService] Current Browser Notification Permission:', Notification.permission);
    if (Notification.permission !== 'granted') {
      return;
    }

    const member = this.firebaseService.user()?.member;
    if (!member) {
      console.log('[NotificationService] No logged-in member found, skipping push checks');
      return;
    }

    const pushedIds = this.getPushedIds();
    const settings = this.localSettings();
    const unpushed = activeNotifications.filter((n) => {
      const isAlreadyPushed = pushedIds.includes(n.docId);
      const isPushEnabled = settings.pushEnabled[n.kind] !== false;
      console.log(`[NotificationService] Notification ${n.docId}: alreadyPushed=${isAlreadyPushed}, pushEnabled=${isPushEnabled}`);
      return !isAlreadyPushed && isPushEnabled;
    });

    console.log('[NotificationService] Filtered unpushed alerts:', unpushed.length);
    if (unpushed.length === 0) return;

    // Trigger Browser Notification
    if (unpushed.length === 1) {
      const notif = unpushed[0];
      const rawText = this.stripMarkdown(notif.markdown);
      console.log('[NotificationService] Triggering single alert:', rawText);
      this.triggerNativeNotification('New Member Notification', {
        body: rawText,
        icon: '/iliqchuan.png',
      });
    } else {
      console.log('[NotificationService] Triggering summary alert, count:', unpushed.length);
      this.triggerNativeNotification('New Notifications Summary', {
        body: `You have ${unpushed.length} new updates in your member portal.`,
        icon: '/iliqchuan.png',
      });
    }

    // Save newly pushed notification IDs to local storage
    const newPushedIds = Array.from(new Set([...pushedIds, ...unpushed.map((n) => n.docId)]));
    try {
      localStorage.setItem(this.pushedIdsKey, JSON.stringify(newPushedIds));
    } catch (e) {
      console.error('Error writing pushed notifications local storage cache:', e);
    }
  }

  private stripMarkdown(md: string): string {
    return md
      // Remove link URLs e.g. [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove other basic markdown formatting characters
      .replace(/[\#\*\_\[\]\-\(\)\`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private triggerNativeNotification(title: string, options: NotificationOptions) {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((registration) => {
        console.log('[NotificationService] Dispatching notification via Service Worker Registration:', title);
        registration.showNotification(title, options);
      }).catch((err) => {
        console.warn('[NotificationService] Service Worker not ready, falling back to window.Notification:', err);
        new Notification(title, options);
      });
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      console.log('[NotificationService] Service Worker API not active/present, using window.Notification fallback:', title);
      new Notification(title, options);
    } else {
      console.log('[NotificationService] Native Notification APIs not supported on this device context');
    }
  }

  public async dismissNotification(notificationId: string): Promise<void> {
    const member = this.firebaseService.user()?.member;
    if (!member) return;

    const notifRef = doc(this.db, 'members', member.docId, 'notifications', notificationId);
    await updateDoc(notifRef, { dismissed: true });
  }

  public async dismissAll(): Promise<void> {
    const member = this.firebaseService.user()?.member;
    const active = this.notifications();
    if (!member || active.length === 0) return;

    const batch = writeBatch(this.db);
    active.forEach((n) => {
      const ref = doc(this.db, 'members', member.docId, 'notifications', n.docId);
      batch.update(ref, { dismissed: true });
    });
    await batch.commit();
  }
}
