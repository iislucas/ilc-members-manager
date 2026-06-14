import { inject, Injectable, signal, effect, OnDestroy } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  Unsubscribe,
  writeBatch,
} from 'firebase/firestore';
import { FirebaseStateService } from './firebase-state.service';
import {
  CachedBlogPost,
  ExpiryStatus,
  Member,
  MembershipType,
  MemberNotification,
  NotificationKind,
  PushSubscriptionDoc,
  firestoreDocToMemberNotification,
  initCachedBlogPost,
} from '../../functions/src/data-model';
import { getInstructorExpiryStatus } from './member-tags';
import { environment } from '../environments/environment';

export interface LocalNotificationSettings {
  pushEnabled: { [kind in NotificationKind]?: boolean };
  homeEnabled: { [kind in NotificationKind]?: boolean };
}

// The subset of PushSubscription.toJSON() we rely on: the endpoint plus the two
// keys the Web Push protocol requires. Typed explicitly so we read concrete
// properties rather than an index signature.
interface WebPushSubscriptionJson {
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService implements OnDestroy {
  private firebaseService = inject(FirebaseStateService);
  // Optional: SwPush is provided by provideServiceWorker in the running app,
  // but absent in unit tests and SSR — guard on it before use.
  private swPush = inject(SwPush, { optional: true });
  private db = getFirestore(this.firebaseService.app);

  public notifications = signal<MemberNotification[]>([]);
  // Full notification history (read + unread), populated lazily only while the
  // notifications view is mounted via subscribeToAllNotifications().
  public allNotifications = signal<MemberNotification[]>([]);
  public permissionStatus = signal<NotificationPermission>('default');
  // Whether THIS browser/device currently holds an active web-push subscription.
  // Reflects the live SwPush subscription so the settings UI can show a per-device
  // on/off state.
  public pushDeviceEnabled = signal<boolean>(false);
  public localSettings = signal<LocalNotificationSettings>({
    pushEnabled: {},
    homeEnabled: {},
  });

  private unsubscripton: Unsubscribe | null = null;
  private allUnsub: Unsubscribe | null = null;
  private pushedIdsKey = 'pushedNotificationDocIds';
  private isFirstSnapshot = true;
  // The member doc ID we have already run blog-post catch-up for this session,
  // so the auth effect re-firing (e.g. on member doc updates) doesn't re-run it.
  private blogSyncedForMemberDocId: string | null = null;
  // The member doc ID we have already registered a web-push subscription for
  // this session, to avoid redundant re-subscriptions on effect re-fires.
  private pushSubscribedForMemberDocId: string | null = null;

  // Maximum number of catch-up blog notifications to create per blog feed.
  private static readonly MAX_BLOG_NOTIFICATIONS = 3;

  // The blog feeds we surface notifications for. `route` is the hash-router
  // path prefix used to deep-link to an individual post by its urlId.
  private static readonly BLOG_FEEDS: { collection: string; label: string; route: string }[] = [
    { collection: 'members-post', label: 'the Members Area', route: 'members-area/post' },
    { collection: 'instructors-post', label: "the Instructors' Area", route: 'instructors-area/post' },
  ];

  constructor() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permissionStatus.set(Notification.permission);
    }
    this.loadLocalSettings();

    // Track this device's live push subscription so the UI reflects whether
    // push is currently enabled here.
    if (this.swPush?.isEnabled) {
      this.swPush.subscription.subscribe((sub) =>
        this.pushDeviceEnabled.set(!!sub),
      );
    }

    // Effect to react to changes in the authenticated user
    effect(() => {
      const user = this.firebaseService.user();
      if (user && user.member && user.member.docId) {
        this.subscribeToNotifications(user.member.docId);
        // Catch the member up on any blog posts published since they were last
        // notified. Runs once per member per session; failures are logged and
        // never block notification subscriptions.
        this.syncBlogPostNotifications(user.member).catch((e) =>
          console.error('Failed to sync blog post notifications:', e),
        );
        // If the member has already granted notification permission, (re)register
        // this device's web-push subscription so background pushes can reach them.
        this.registerPushSubscription(user.member.docId).catch((e) =>
          console.error('Failed to register push subscription:', e),
        );
      } else {
        this.unsubscribe();
        this.notifications.set([]);
        this.blogSyncedForMemberDocId = null;
        this.pushSubscribedForMemberDocId = null;
      }
    });
  }

  ngOnDestroy() {
    this.unsubscribe();
    this.unsubscribeFromAllNotifications();
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
    // On a fresh grant, register this device for background web push.
    if (permission === 'granted') {
      const memberDocId = this.firebaseService.user()?.member?.docId;
      if (memberDocId) {
        this.registerPushSubscription(memberDocId).catch((e) =>
          console.error('Failed to register push subscription:', e),
        );
      }
    }
    return permission;
  }

  // ---------------------------------------------------------------------------
  // Web Push subscription
  // ---------------------------------------------------------------------------

  // True when web push can be used on this device at all (service worker active
  // and a VAPID key configured). The UI uses this to show/hide push controls.
  public get isPushSupported(): boolean {
    return !!this.swPush?.isEnabled && !!environment.vapidPublicKey;
  }

  // Re-reads the browser's live push subscription and updates pushDeviceEnabled
  // to match. The constructor's swPush.subscription stream only emits once at
  // startup, so the settings UI calls this when shown to make sure the per-device
  // toggle reflects the actual on-device subscription state rather than a stale
  // signal value.
  public async refreshPushDeviceState(): Promise<void> {
    if (!this.swPush?.isEnabled) {
      this.pushDeviceEnabled.set(false);
      return;
    }
    try {
      const sub = await firstValueFrom(this.swPush.subscription);
      this.pushDeviceEnabled.set(!!sub);
    } catch (e) {
      console.error('Failed to read push subscription state:', e);
    }
  }

  // Turns on push for THIS device: requests notification permission if needed,
  // then registers the subscription. Returns true if the device ends up enabled.
  public async enablePushOnThisDevice(): Promise<boolean> {
    const memberDocId = this.firebaseService.user()?.member?.docId;
    if (!memberDocId || !this.isPushSupported) return false;

    let permission = this.permissionStatus();
    if (permission !== 'granted') {
      permission = await this.requestPermission(); // also registers on grant
    } else {
      await this.registerPushSubscription(memberDocId);
    }
    // registerPushSubscription may short-circuit on its per-session guard without
    // touching the signal, so reconcile against the real subscription here.
    await this.refreshPushDeviceState();
    return permission === 'granted' && this.pushDeviceEnabled();
  }

  // Turns off push for THIS device: removes the stored subscription document and
  // unsubscribes the browser. Other devices are unaffected.
  public async disablePushOnThisDevice(): Promise<void> {
    if (!this.swPush?.isEnabled) return;
    const memberDocId = this.firebaseService.user()?.member?.docId;
    try {
      const sub = await firstValueFrom(this.swPush.subscription);
      const endpoint = (sub?.toJSON() as WebPushSubscriptionJson | undefined)?.endpoint;
      if (memberDocId && endpoint) {
        const subId = await this.hashString(endpoint);
        await deleteDoc(doc(this.db, 'members', memberDocId, 'pushSubscriptions', subId));
      }
      await this.swPush.unsubscribe();
      this.pushDeviceEnabled.set(false);
    } catch (e) {
      console.error('Failed to disable push on this device:', e);
    } finally {
      // Allow a later re-enable to re-subscribe.
      this.pushSubscribedForMemberDocId = null;
    }
  }

  // Registers this device's Web Push subscription under the member so the
  // push-sending Cloud Function can deliver background notifications. No-ops
  // unless the service worker is active, a VAPID public key is configured, and
  // the user has granted notification permission. Safe to call repeatedly.
  private async registerPushSubscription(memberDocId: string): Promise<void> {
    if (this.pushSubscribedForMemberDocId === memberDocId) return;
    if (!this.swPush?.isEnabled) return; // SW not active (e.g. dev server / unsupported)
    if (!environment.vapidPublicKey) return; // web push not configured
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    this.pushSubscribedForMemberDocId = memberDocId;

    try {
      const sub = await this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey,
      });
      const json = sub.toJSON() as WebPushSubscriptionJson;
      const endpoint = json.endpoint;
      const keys = json.keys;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        console.warn('Push subscription missing endpoint/keys; skipping store.');
        return;
      }

      // Key the doc by a hash of the endpoint so the same device overwrites its
      // own entry rather than accumulating duplicates.
      const subId = await this.hashString(endpoint);
      const docData: PushSubscriptionDoc = {
        docId: subId,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        createdAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };
      await setDoc(
        doc(this.db, 'members', memberDocId, 'pushSubscriptions', subId),
        docData,
      );
      this.pushDeviceEnabled.set(true);
    } catch (e) {
      // Reset the guard so a later attempt (e.g. after the SW becomes ready)
      // can retry.
      this.pushSubscribedForMemberDocId = null;
      console.error('Failed to subscribe to web push:', e);
    }
  }

  // SHA-256 hex digest of a string, used to derive a stable Firestore doc ID
  // from a push endpoint (endpoints can exceed Firestore's doc-ID length limit).
  private async hashString(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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

  // Subscribes to the member's full notification history (read + unread). Used
  // by the dedicated notifications view; call unsubscribeFromAllNotifications()
  // when the view is torn down to stop paying for the listener.
  public subscribeToAllNotifications() {
    this.unsubscribeFromAllNotifications();
    const memberDocId = this.firebaseService.user()?.member?.docId;
    if (!memberDocId) {
      this.allNotifications.set([]);
      return;
    }

    const notifCollection = collection(this.db, 'members', memberDocId, 'notifications');
    this.allUnsub = onSnapshot(
      notifCollection,
      (snapshot) => {
        const list: MemberNotification[] = snapshot.docs.map(firestoreDocToMemberNotification);
        // Sort by createdAt desc (client-side, matching the unread feed, to
        // avoid requiring a composite Firestore index).
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        this.allNotifications.set(list);
      },
      (error) => {
        console.error('Error listening to full notifications subcollection:', error);
      }
    );
  }

  public unsubscribeFromAllNotifications() {
    if (this.allUnsub) {
      this.allUnsub();
      this.allUnsub = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Blog post catch-up notifications
  // ---------------------------------------------------------------------------

  // Whether this member currently has an active membership (and so should see
  // members-area blog posts). Mirrors the access gate used by the members-area
  // blog component so notifications never link to content they can't read.
  private isActiveMember(member: Member): boolean {
    if (member.membershipType === MembershipType.Life) return true;
    if (
      member.membershipType === MembershipType.Inactive ||
      member.membershipType === MembershipType.Deceased
    ) {
      return false;
    }
    if (!member.currentMembershipExpires) return false;
    return new Date(member.currentMembershipExpires) > new Date();
  }

  // Whether this member is an active, licensed instructor (and so should see
  // instructors-area blog posts).
  private isActiveInstructor(member: Member): boolean {
    if (!member.instructorId) return false;
    const today = new Date().toISOString().split('T')[0];
    return getInstructorExpiryStatus(member, today) === ExpiryStatus.Valid;
  }

  // Surfaces up to the latest few blog posts (per accessible feed) the member
  // hasn't been notified about yet, newest first. Idempotent: it uses the
  // member's own BlogPost notifications to find the last post they've already
  // seen and only adds notifications for posts published since.
  private async syncBlogPostNotifications(member: Member): Promise<void> {
    if (this.blogSyncedForMemberDocId === member.docId) return;
    this.blogSyncedForMemberDocId = member.docId;

    for (const feed of NotificationService.BLOG_FEEDS) {
      const hasAccess =
        feed.collection === 'instructors-post'
          ? this.isActiveInstructor(member)
          : this.isActiveMember(member);
      if (!hasAccess) continue;

      try {
        await this.syncBlogFeedNotifications(member.docId, feed);
      } catch (e) {
        console.error(`Failed to sync blog notifications for ${feed.collection}:`, e);
      }
    }
  }

  private async syncBlogFeedNotifications(
    memberDocId: string,
    feed: { collection: string; label: string; route: string },
  ): Promise<void> {
    const notifCollection = collection(this.db, 'members', memberDocId, 'notifications');

    // Find the most recent post (and the set of post IDs) we've already
    // notified this member about for this feed. We read all BlogPost
    // notifications (a single-field filter, so no composite index needed) and
    // narrow to this feed client-side.
    const existingSnap = await getDocs(
      query(notifCollection, where('kind', '==', NotificationKind.BlogPost)),
    );
    let cutoffMs = 0;
    const notifiedPostIds = new Set<string>();
    existingSnap.forEach((d) => {
      const data = (d.data() as MemberNotification).data as {
        blogPath?: string;
        lastSeenDateStr?: string;
        blogPostId?: string;
      };
      if (!data || data.blogPath !== feed.collection) return;
      if (data.blogPostId) notifiedPostIds.add(data.blogPostId);
      const ms = data.lastSeenDateStr ? Date.parse(data.lastSeenDateStr) : NaN;
      if (!isNaN(ms) && ms > cutoffMs) cutoffMs = ms;
    });

    // Query the latest posts: only those newer than the cut-off, or simply the
    // latest few the first time (no prior cut-off). `publishOn` is ms-epoch.
    const postsCollection = collection(this.db, feed.collection);
    const max = NotificationService.MAX_BLOG_NOTIFICATIONS;
    const postsQuery =
      cutoffMs > 0
        ? query(
            postsCollection,
            where('publishOn', '>', cutoffMs),
            orderBy('publishOn', 'desc'),
            limit(max),
          )
        : query(postsCollection, orderBy('publishOn', 'desc'), limit(max));

    const postsSnap = await getDocs(postsQuery);
    if (postsSnap.empty) return;

    // Newest first; skip any post we've already notified about.
    const posts = postsSnap.docs
      .map((d) => ({ ...initCachedBlogPost(), ...(d.data() as CachedBlogPost) }))
      .filter((p) => p.id && !notifiedPostIds.has(p.id));
    if (posts.length === 0) return;

    const batch = writeBatch(this.db);
    for (const post of posts) {
      const ref = doc(notifCollection); // auto-generated ID
      const link = `#/${feed.route}/${post.urlId}`;
      // Stamp the notification with the post's publish date (not "now") so the
      // date shown on the card reflects when the post was published.
      const publishedIso = new Date(post.publishOn || 0).toISOString();
      const notification: MemberNotification = {
        docId: ref.id,
        markdown: `New post in ${feed.label}: [${post.title || 'Untitled'}](${link})`,
        createdAt: publishedIso,
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: feed.collection,
          blogCategory: '',
          lastSeenDateStr: publishedIso,
          blogPostId: post.id,
          blogPostUrlId: post.urlId,
        },
      };
      batch.set(ref, notification);
    }
    await batch.commit();
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

  // Re-surfaces a previously dismissed notification on the home feed. In the
  // unified model, "read" === dismissed, so this marks the notification unread.
  public async markUnread(notificationId: string): Promise<void> {
    const member = this.firebaseService.user()?.member;
    if (!member) return;

    const notifRef = doc(this.db, 'members', member.docId, 'notifications', notificationId);
    await updateDoc(notifRef, { dismissed: false });
  }

  // Permanently removes a notification document.
  public async deleteNotification(notificationId: string): Promise<void> {
    const member = this.firebaseService.user()?.member;
    if (!member) return;

    const notifRef = doc(this.db, 'members', member.docId, 'notifications', notificationId);
    await deleteDoc(notifRef);
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
