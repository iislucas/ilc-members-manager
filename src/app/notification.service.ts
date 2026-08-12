import { inject, Injectable, signal, effect, OnDestroy } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
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
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { FirebaseStateService } from './firebase-state.service';
import {
  CachedBlogPost,
  EventStatus,
  ExpiryStatus,
  Grading,
  GradingStatus,
  IlcEvent,
  Member,
  MembershipType,
  MemberNotification,
  NotificationBlogPostData,
  NotificationBlogPostsSummaryData,
  NotificationEventData,
  NotificationGradingData,
  NotificationKind,
  NotificationOrderIssueData,
  NotificationOrderIssuesSummaryData,
  NotificationPendingEventsSummaryData,
  NotificationStyle,
  NotificationUnpaidGradingsSummaryData,
  NotificationUploadData,
  NotificationUploadsSummaryData,
  Order,
  OrderKind,
  OrderStatus,
  PushSubscriptionDoc,
  SquareSpaceOrder,
  SquarespaceFulfillmentStatus,
  UploadItem,
  eventStatusLabel,
  firestoreDocToGrading,
  firestoreDocToMemberNotification,
  firestoreDocToOrder,
  firestoreDocToUploadItem,
  initCachedBlogPost,
  initEvent,
  isGradingPaid,
  notificationStyle,
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
  // Surfaced error message for user-visible error display (e.g. missing indexes, permissions, query failures).
  public syncError = signal<string | null>(null);

  private unsubscripton: Unsubscribe | null = null;
  private allUnsub: Unsubscribe | null = null;
  private pushedIdsKey = 'pushedNotificationDocIds';
  private isFirstSnapshot = true;
  // The member doc ID we have already run blog-post catch-up for this session,
  // so the auth effect re-firing (e.g. on member doc updates) doesn't re-run it.
  private blogSyncedForMemberDocId: string | null = null;
  // The admin member doc ID we have already run pending-event catch-up for this
  // session, so the auth effect re-firing doesn't re-run it.
  private pendingEventsSyncedForMemberDocId: string | null = null;
  // The admin member doc ID we have already run order-issue catch-up for this
  // session, so the auth effect re-firing doesn't re-run it.
  private orderIssuesSyncedForMemberDocId: string | null = null;
  // The admin member doc ID we have already run new-upload catch-up for this
  // session, so the auth effect re-firing doesn't re-run it.
  private newUploadsSyncedForMemberDocId: string | null = null;
  // The member doc ID we have already run unpaid-grading catch-up for this
  // session, so the auth effect re-firing doesn't re-run it.
  private unpaidGradingsSyncedForMemberDocId: string | null = null;
  // The member doc ID we have already registered a web-push subscription for
  // this session, to avoid redundant re-subscriptions on effect re-fires.
  private pushSubscribedForMemberDocId: string | null = null;

  // Maximum number of individual notifications created per group / category.
  // When a sync batch has more than this number, the newest 3 get individual
  // notifications and the remaining items are grouped into a single summary notification.
  private static readonly MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP = 3;

  private static readonly MAX_BLOG_NOTIFICATIONS = NotificationService.MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP;
  private static readonly MAX_PENDING_EVENT_NOTIFICATIONS = NotificationService.MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP;
  private static readonly MAX_ORDER_ISSUE_NOTIFICATIONS = NotificationService.MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP;
  private static readonly MAX_NEW_UPLOAD_NOTIFICATIONS = NotificationService.MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP;
  private static readonly MAX_UNPAID_GRADING_NOTIFICATIONS = NotificationService.MAX_INDIVIDUAL_NOTIFICATIONS_PER_GROUP;

  // Grading statuses that count as "completed" for the unpaid-grading check.
  private static readonly COMPLETED_GRADING_STATUSES: GradingStatus[] = [
    GradingStatus.Passed,
    GradingStatus.NotPassed,
  ];

  // The order processing statuses that require admin attention.
  private static readonly ORDER_ATTENTION_STATUSES: OrderStatus[] = [
    OrderStatus.Error,
    OrderStatus.NeedsManualProcessing,
  ];

  // The blog feeds we surface notifications for. `route` is the hash-router
  // path prefix used to deep-link to an individual post by its urlId.
  private static readonly BLOG_FEEDS: { collection: string; label: string; route: string }[] = [
    { collection: 'members-post', label: 'Members', route: 'members-area/post' },
    { collection: 'instructors-post', label: "Instructors'", route: 'instructors-area/post' },
  ];

  public dismissSyncError() {
    this.syncError.set(null);
  }

  public setSyncError(prefix: string, err: unknown) {
    const raw = (err as Error)?.message || String(err);
    // Convert plain URLs to markdown links for easy one-click resolution (e.g. Firebase index creation links)
    const formatted = raw.replace(/(https:\/\/[^\s\)]+)/g, '[$1]($1)');
    this.syncError.set(`${prefix}: ${formatted}`);
  }

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
        // notified. Runs once per member per session.
        this.syncBlogPostNotifications(user.member).catch((e) => {
          console.error('Failed to sync blog post notifications:', e);
          this.setSyncError('Failed to sync blog post notifications', e);
        });
        // Surface any of the member's (or their students') gradings that are
        // completed but not yet paid as TODO notifications. Runs once per
        // member per session.
        this.syncUnpaidGradingNotifications(user.member).catch((e) => {
          console.error('Failed to sync unpaid grading notifications:', e);
          this.setSyncError('Failed to sync unpaid grading notifications', e);
        });
        // For admins, catch them up on any events still waiting for approval so
        // proposed events surface as actionable notifications. Runs once per
        // admin per session.
        if (user.isAdmin) {
          this.syncPendingEventNotifications(user.member).catch((e) => {
            console.error('Failed to sync pending event notifications:', e);
            this.setSyncError('Failed to sync pending event notifications', e);
          });
          // Also surface any orders that failed automatic processing and need a
          // human to resolve them.
          this.syncOrderIssueNotifications(user.member).catch((e) => {
            console.error('Failed to sync order issue notifications:', e);
            this.setSyncError('Failed to sync order issue notifications', e);
          });
          // Also surface newly uploaded materials across all members/instructors.
          this.syncNewUploadNotifications(user.member).catch((e) => {
            console.error('Failed to sync new upload notifications:', e);
            this.setSyncError('Failed to sync new upload notifications', e);
          });
        }
        // If the member has already granted notification permission, (re)register
        // this device's web-push subscription so background pushes can reach them.
        this.registerPushSubscription(user.member.docId).catch((e) =>
          console.error('Failed to register push subscription:', e),
        );
      } else {
        this.unsubscribe();
        this.notifications.set([]);
        this.syncError.set(null);
        this.blogSyncedForMemberDocId = null;
        this.pendingEventsSyncedForMemberDocId = null;
        this.orderIssuesSyncedForMemberDocId = null;
        this.newUploadsSyncedForMemberDocId = null;
        this.unpaidGradingsSyncedForMemberDocId = null;
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
        this.setSyncError('Error listening to notifications', error);
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
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        this.allNotifications.set(list);
      },
      (error) => {
        console.error('Error listening to full notifications subcollection:', error);
        this.setSyncError('Error listening to full notifications', error);
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
  // Reconciliation: keep existing catch-up notifications in step with their source
  // ---------------------------------------------------------------------------

  // Reconciles already-created notifications against the current state of the
  // entity they were generated from. For each existing notification of a kind,
  // `resolve` looks up the live entity (via the id in the notification's `data`)
  // and returns the markdown/data the notification *should* now carry, plus
  // whether the underlying condition is resolved:
  //   - condition still holds  -> content is refreshed in place, dismissed state
  //     is preserved (we never re-surface something the user has dismissed);
  //   - condition resolved      -> content is rewritten to say so and the
  //     notification is dismissed.
  // Only documents that actually differ are written, so re-running on the next
  // login is a no-op. `resolve` returning null leaves the notification untouched
  // (e.g. we couldn't read the entity); individual failures never abort the rest.
  private async reconcileNotifications(
    existingDocs: QueryDocumentSnapshot[],
    entityIdField: string,
    resolve: (
      notif: MemberNotification,
    ) => Promise<{ markdown: string; data: object; resolved: boolean; kind?: NotificationKind } | null>,
  ): Promise<void> {
    const batch = writeBatch(this.db);
    let writes = 0;

    for (const d of existingDocs) {
      const notif = firestoreDocToMemberNotification(d);
      const data = notif.data as unknown as Record<string, unknown> | undefined;
      if (!data || !data[entityIdField]) continue;

      let desired: { markdown: string; data: object; resolved: boolean; kind?: NotificationKind } | null;
      try {
        desired = await resolve(notif);
      } catch (e) {
        console.error('Failed to reconcile notification', notif.docId, e);
        continue;
      }
      if (!desired) continue;

      const patch: Record<string, unknown> = {};
      if (desired.markdown !== notif.markdown) patch['markdown'] = desired.markdown;
      if (this.stableStringify(desired.data) !== this.stableStringify(notif.data)) {
        patch['data'] = desired.data;
      }
      if (desired.kind && desired.kind !== notif.kind) {
        patch['kind'] = desired.kind;
      }
      if (desired.resolved && !notif.dismissed) patch['dismissed'] = true;

      if (Object.keys(patch).length > 0) {
        batch.update(d.ref, patch);
        writes++;
      }
    }

    if (writes > 0) await batch.commit();
  }

  // Order-stable JSON serialisation, used to compare a notification's stored
  // `data` against the freshly-built desired value so reconciliation only writes
  // on a real change regardless of object key ordering.
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.stableStringify(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + this.stableStringify(obj[k]))
        .join(',') +
      '}'
    );
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
      query(
        notifCollection,
        where('kind', 'in', [
          NotificationKind.BlogPost,
          NotificationKind.BlogPostsSummary,
        ]),
      ),
    );
    let cutoffMs = 0;
    const notifiedPostIds = new Set<string>();
    // Existing notifications for this specific feed, used for reconciliation below.
    const feedDocs: QueryDocumentSnapshot[] = [];
    existingSnap.forEach((d) => {
      const notif = firestoreDocToMemberNotification(d);
      if (notif.kind === NotificationKind.BlogPost) {
        const data = notif.data as NotificationBlogPostData;
        if (!data || data.blogPath !== feed.collection) return;
        feedDocs.push(d);
        if (data.blogPostId) notifiedPostIds.add(data.blogPostId);
        const ms = data.lastSeenDateStr ? Date.parse(data.lastSeenDateStr) : NaN;
        if (!isNaN(ms) && ms > cutoffMs) cutoffMs = ms;
      } else if (notif.kind === NotificationKind.BlogPostsSummary) {
        const data = notif.data as NotificationBlogPostsSummaryData;
        if (!data || data.feedCollection !== feed.collection) return;
        const ms = data.lastSeenDateStr ? Date.parse(data.lastSeenDateStr) : NaN;
        if (!isNaN(ms) && ms > cutoffMs) cutoffMs = ms;
      }
    });

    // Query the latest posts: only those newer than the cut-off, or simply the
    // latest posts the first time. `publishOn` is ms-epoch.
    const postsCollection = collection(this.db, feed.collection);
    const postsQuery =
      cutoffMs > 0
        ? query(
          postsCollection,
          where('publishOn', '>', cutoffMs),
          orderBy('publishOn', 'desc'),
        )
        : query(postsCollection, orderBy('publishOn', 'desc'), limit(50));

    const postsSnap = await getDocs(postsQuery);

    // Newest first; skip any post we've already notified about. May be empty when
    // nothing new has been published since the cut-off — that's the common case,
    // and we still fall through to reconciliation below.
    const posts = postsSnap.docs
      .map((d) => ({ ...initCachedBlogPost(), ...(d.data() as CachedBlogPost) }))
      .filter((p) => p.id && !notifiedPostIds.has(p.id))
      .sort((a, b) => (b.publishOn || 0) - (a.publishOn || 0));

    if (posts.length > 0) {
      const max = NotificationService.MAX_BLOG_NOTIFICATIONS;
      const batch = writeBatch(this.db);

      if (posts.length <= max) {
        for (const post of posts) {
          const ref = doc(notifCollection); // auto-generated ID
          const fields = this.blogPostFields(feed, post);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: fields.data.lastSeenDateStr,
            dismissed: false,
            kind: NotificationKind.BlogPost,
            data: fields.data,
          };
          batch.set(ref, notification);
        }
      } else {
        const latestPosts = posts.slice(0, max);
        const remainingPosts = posts.slice(max);

        for (const post of latestPosts) {
          const ref = doc(notifCollection);
          const fields = this.blogPostFields(feed, post);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: fields.data.lastSeenDateStr,
            dismissed: false,
            kind: NotificationKind.BlogPost,
            data: fields.data,
          };
          batch.set(ref, notification);
        }

        const count = remainingPosts.length;
        const plural = count === 1 ? 'post' : 'posts';
        const areaRoute = feed.collection === 'members-post' ? 'members-area' : 'instructors-area';
        const summaryMarkdown = `📰 **${count}** more ${feed.label} ${plural}: [View in ${feed.label} Area](/${areaRoute})`;
        const summaryRef = doc(notifCollection);
        const newestRemaining = remainingPosts[0];
        const lastSeenDateStr = newestRemaining.publishOn
          ? new Date(newestRemaining.publishOn).toISOString()
          : new Date().toISOString();

        const summaryNotification: MemberNotification = {
          docId: summaryRef.id,
          markdown: summaryMarkdown,
          createdAt: lastSeenDateStr,
          dismissed: false,
          kind: NotificationKind.BlogPostsSummary,
          data: {
            count,
            feedLabel: feed.label,
            feedCollection: feed.collection,
            areaRoute,
            lastSeenDateStr,
          },
        };
        batch.set(summaryRef, summaryNotification);
      }

      await batch.commit();
    }

    // Reconcile previously-created notifications for this feed against the posts
    // as they stand now: re-titled/re-slugged posts have their card refreshed in
    // place, and posts that have since been removed are marked as such + dismissed.
    // Runs regardless of whether there were new posts to create above.
    await this.reconcileNotifications(feedDocs, 'blogPostId', (notif) =>
      this.resolveBlogNotification(feed, notif),
    );
  }

  // Computes the desired state of a blog-post notification from the post as it
  // stands now. Posts are keyed in Firestore by an auto-generated doc ID, not by
  // their source `id`; blogPostId holds the source `id`, so the post is looked up
  // by querying that field rather than by document ID.
  private async resolveBlogNotification(
    feed: { collection: string; label: string; route: string },
    notif: MemberNotification,
  ): Promise<{ markdown: string; data: object; resolved: boolean } | null> {
    const data = notif.data as NotificationBlogPostData;
    if (!data.blogPostId) return null;
    const snap = await getDocs(
      query(
        collection(this.db, feed.collection),
        where('id', '==', data.blogPostId),
        limit(1),
      ),
    );
    if (snap.empty) {
      return {
        markdown: `~~New ${feed.label} post~~ (post removed)`,
        data: { ...data },
        resolved: true,
      };
    }
    const post = { ...initCachedBlogPost(), ...(snap.docs[0].data() as CachedBlogPost) };
    return { ...this.blogPostFields(feed, post), resolved: false };
  }

  // The markdown + data for a blog-post notification, shared by the create and
  // reconcile passes so both stay in lock-step.
  private blogPostFields(
    feed: { collection: string; label: string; route: string },
    post: CachedBlogPost,
  ): { markdown: string; data: NotificationBlogPostData } {
    const link = `/${feed.route}/${post.urlId}`;
    const publishedIso = new Date(post.publishOn || 0).toISOString();
    return {
      markdown: `New ${feed.label} post: [${post.title || 'Untitled'}](${link})`,
      data: {
        blogPath: feed.collection,
        blogCategory: '',
        lastSeenDateStr: publishedIso,
        blogPostId: post.id,
        blogPostUrlId: post.urlId,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Admin pending-event approval notifications
  // ---------------------------------------------------------------------------

  // Surfaces the events still waiting for admin approval (status='proposed') as
  // notifications in this admin's feed, newest first. Idempotent and modelled on
  // the blog-post catch-up: it reads the admin's own PendingEventApproval
  // notifications to find which events have already been surfaced and only adds
  // notifications for proposals it hasn't announced yet. Runs once per session.
  private async syncPendingEventNotifications(member: Member): Promise<void> {
    if (this.pendingEventsSyncedForMemberDocId === member.docId) return;
    this.pendingEventsSyncedForMemberDocId = member.docId;

    const notifCollection = collection(this.db, 'members', member.docId, 'notifications');

    // Which proposed events have we already notified this admin about?
    const existingSnap = await getDocs(
      query(
        notifCollection,
        where('kind', 'in', [
          NotificationKind.PendingEventApproval,
          NotificationKind.PendingEventsSummary,
        ]),
      ),
    );
    const notifiedEventIds = new Set<string>();
    const existingEventDocs: QueryDocumentSnapshot[] = [];
    existingSnap.forEach((d) => {
      const notif = firestoreDocToMemberNotification(d);
      if (notif.kind === NotificationKind.PendingEventApproval) {
        existingEventDocs.push(d);
        const data = notif.data as { eventId?: string };
        if (data?.eventId) notifiedEventIds.add(data.eventId);
      }
    });

    // The events currently waiting for approval, newest proposals first.
    // Requires a (status, createdAt) composite index on the events collection.
    const eventsSnap = await getDocs(
      query(
        collection(this.db, 'events'),
        where('status', '==', EventStatus.Proposed),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
    );
    // May be empty when no proposals are outstanding — we still fall through to
    // reconciliation below.
    const events = eventsSnap.docs
      .map((d) => ({ ...initEvent(), ...(d.data() as IlcEvent), docId: d.id }))
      .filter((e) => !notifiedEventIds.has(e.docId));

    if (events.length > 0) {
      const max = NotificationService.MAX_PENDING_EVENT_NOTIFICATIONS;
      const batch = writeBatch(this.db);

      if (events.length <= max) {
        for (const event of events) {
          const ref = doc(notifCollection); // auto-generated ID
          const title = event.title || 'Untitled event';
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: this.pendingEventMarkdown(event.docId, title),
            createdAt: event.createdAt || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.PendingEventApproval,
            data: { eventId: event.docId, title },
          };
          batch.set(ref, notification);
        }
      } else {
        const latestEvents = events.slice(0, max);
        const remainingEvents = events.slice(max);

        for (const event of latestEvents) {
          const ref = doc(notifCollection);
          const title = event.title || 'Untitled event';
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: this.pendingEventMarkdown(event.docId, title),
            createdAt: event.createdAt || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.PendingEventApproval,
            data: { eventId: event.docId, title },
          };
          batch.set(ref, notification);
        }

        const count = remainingEvents.length;
        const plural = count === 1 ? 'proposed event' : 'proposed events';
        const summaryMarkdown = `🗓️ **${count}** more ${plural} awaiting approval: [View in Manage Events](/manage-events?status=proposed)`;
        const summaryRef = doc(notifCollection);
        const summaryNotification: MemberNotification = {
          docId: summaryRef.id,
          markdown: summaryMarkdown,
          createdAt: remainingEvents[0].createdAt || new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.PendingEventsSummary,
          data: { count },
        };
        batch.set(summaryRef, summaryNotification);
      }

      await batch.commit();
    }

    // Reconcile already-surfaced approval notifications: a still-proposed event
    // has its title refreshed; an event that has since been approved/rejected/
    // cancelled (or deleted) is rewritten to say so and dismissed. A per-event
    // getDoc also lets us distinguish "no longer proposed" from "beyond the live
    // query's limit", which the create pass's capped query cannot.
    await this.reconcileNotifications(existingEventDocs, 'eventId', async (notif) => {
      const data = notif.data as NotificationEventData;
      const snap = await getDoc(doc(this.db, 'events', data.eventId));
      if (!snap.exists()) {
        return {
          markdown: `Event "${data.title}" — removed`,
          data: { ...data },
          resolved: true,
        };
      }
      const event = { ...initEvent(), ...(snap.data() as IlcEvent), docId: snap.id };
      const title = event.title || 'Untitled event';
      const link = `/manage-events/${event.docId}`;
      if (event.status !== EventStatus.Proposed) {
        return {
          markdown: `Event [${title}](${link}) — ${eventStatusLabel(event.status).toLowerCase()}`,
          data: { eventId: event.docId, title },
          resolved: true,
        };
      }
      return {
        markdown: this.pendingEventMarkdown(event.docId, title),
        data: { eventId: event.docId, title },
        resolved: false,
      };
    });
  }

  // The markdown for a pending-event-approval notification, shared by the create
  // and reconcile passes.
  private pendingEventMarkdown(eventDocId: string, title: string): string {
    return `Event awaiting approval: [${title}](/manage-events/${eventDocId})`;
  }

  // ---------------------------------------------------------------------------
  // Admin order-issue notifications
  // ---------------------------------------------------------------------------

  // Human-readable reference for an order: the Squarespace order number, or the
  // Sheets-import reference number, falling back to the doc ID.
  private orderRef(order: Order): string {
    if (order.ilcAppOrderKind === OrderKind.Squarespace) {
      return order.orderNumber || order.docId;
    }
    if (order.ilcAppOrderKind === OrderKind.Stripe) {
      return order.stripeObjectId || order.docId;
    }
    return order.referenceNumber || order.docId;
  }

  // Who placed the order: a name where available, falling back to the email.
  // Empty string when neither is known.
  private orderCustomer(order: Order): string {
    if (order.ilcAppOrderKind === OrderKind.Squarespace) {
      const name = [order.billingAddress?.firstName, order.billingAddress?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return name || order.customerEmail || '';
    }
    if (order.ilcAppOrderKind === OrderKind.Stripe) {
      return (order.customerName || order.customerEmail || '').trim();
    }
    const name = [order.firstName, order.lastName].filter(Boolean).join(' ').trim();
    return name || order.email || '';
  }

  // Short human-readable summary of what was purchased (line-item product names
  // or descriptions). Empty string when the order carries no itemised lines.
  private orderItemsSummary(order: Order): string {
    let names: string[] = [];
    if (order.ilcAppOrderKind === OrderKind.Squarespace) {
      names = (order.lineItems || []).map((li) => (li.productName || li.sku || '').trim());
    } else if (order.ilcAppOrderKind === OrderKind.Stripe) {
      names = (order.lineItems || []).map((li) => (li.description || '').trim());
    } else {
      names = [order.paidFor, order.orderType].map((s) => (s || '').trim());
    }
    return names.filter(Boolean).join(', ');
  }

  // Surfaces orders that failed automatic processing (ilcAppOrderStatus 'error'
  // or 'needs-manual-processing') as notifications in this admin's feed, most
  // recent first. Idempotent and modelled on the pending-event catch-up: it
  // reads the admin's own OrderNeedsAttention notifications to find which orders
  // have already been surfaced and only adds notifications for ones it hasn't
  // announced yet. Runs once per session.
  private async syncOrderIssueNotifications(member: Member): Promise<void> {
    if (this.orderIssuesSyncedForMemberDocId === member.docId) return;
    this.orderIssuesSyncedForMemberDocId = member.docId;

    const notifCollection = collection(this.db, 'members', member.docId, 'notifications');

    // Which order-issue notifications have we already created for this admin?
    // Single-field filter (no composite index needed).
    const existingSnap = await getDocs(
      query(
        notifCollection,
        where('kind', 'in', [
          NotificationKind.OrderNeedsAttention,
          NotificationKind.ManualOrderFulfilled,
          NotificationKind.OrderIssuesSummary,
        ]),
      ),
    );
    const notifiedOrderIds = new Set<string>();
    const existingOrderDocs: QueryDocumentSnapshot[] = [];
    existingSnap.forEach((d) => {
      const notif = firestoreDocToMemberNotification(d);
      if (
        notif.kind === NotificationKind.OrderNeedsAttention ||
        notif.kind === NotificationKind.ManualOrderFulfilled
      ) {
        existingOrderDocs.push(d);
        const data = notif.data as { orderDocId?: string };
        if (data?.orderDocId) notifiedOrderIds.add(data.orderDocId);
      }
    });

    // Orders flagged for attention. We filter by status only (an `in` filter on
    // a single field, so no composite index needed) and sort/cap client-side.
    const ordersSnap = await getDocs(
      query(
        collection(this.db, 'orders'),
        where('ilcAppOrderStatus', 'in', NotificationService.ORDER_ATTENTION_STATUSES),
      ),
    );
    // May be empty when no orders currently need attention — we still fall
    // through to reconciliation below.
    const orders = ordersSnap.docs
      .map((d) => firestoreDocToOrder(d))
      .filter((o) => !notifiedOrderIds.has(o.docId))
      // Most recently updated first
      .sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));

    if (orders.length > 0) {
      const max = NotificationService.MAX_ORDER_ISSUE_NOTIFICATIONS;
      const batch = writeBatch(this.db);

      if (orders.length <= max) {
        for (const order of orders) {
          const ref = doc(notifCollection); // auto-generated ID
          const fields = this.orderIssueFields(order);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: order.lastUpdated || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.OrderNeedsAttention,
            data: fields.data,
          };
          batch.set(ref, notification);
        }
      } else {
        const latestOrders = orders.slice(0, max);
        const remainingOrders = orders.slice(max);

        for (const order of latestOrders) {
          const ref = doc(notifCollection);
          const fields = this.orderIssueFields(order);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: order.lastUpdated || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.OrderNeedsAttention,
            data: fields.data,
          };
          batch.set(ref, notification);
        }

        const count = remainingOrders.length;
        const plural = count === 1 ? 'order' : 'orders';
        const summaryMarkdown = `📦 **${count}** more ${plural} need attention: [View in Manage Orders](/orders)`;
        const summaryRef = doc(notifCollection);
        const summaryNotification: MemberNotification = {
          docId: summaryRef.id,
          markdown: summaryMarkdown,
          createdAt: remainingOrders[0].lastUpdated || new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.OrderIssuesSummary,
          data: { count },
        };
        batch.set(summaryRef, summaryNotification);
      }

      await batch.commit();
    }

    // Reconcile already-surfaced order-issue notifications: an order still flagged
    // has its status/issues refreshed; an order that was manual and is now fulfilled
    // is rewritten as an FYI ManualOrderFulfilled notification; an order that has since
    // been resolved (no longer in an attention status, or deleted) is rewritten to say so
    // and dismissed.
    await this.reconcileNotifications(existingOrderDocs, 'orderDocId', async (notif) => {
      const data = notif.data as NotificationOrderIssueData;
      const snap = await getDoc(doc(this.db, 'orders', data.orderDocId));
      if (!snap.exists()) {
        return {
          markdown: `Order #${data.orderRef} — no longer present`,
          data: { ...data },
          resolved: true,
        };
      }
      const order = firestoreDocToOrder(snap);
      const status = order.ilcAppOrderStatus as OrderStatus;

      const hasErrors =
        order.ilcAppOrderStatus === OrderStatus.Error ||
        (order.ilcAppOrderKind === OrderKind.Squarespace &&
          (order.lineItems || []).some((li) => li.ilcAppProcessingStatus === OrderStatus.Error));

      const wasManual =
        !hasErrors &&
        (notif.kind === NotificationKind.ManualOrderFulfilled ||
          data.status === OrderStatus.NeedsManualProcessing ||
          notif.markdown.includes('needs manual processing') ||
          notif.markdown.includes('manual order was fulfilled'));

      const isFulfilled =
        (order as SquareSpaceOrder).fulfillmentStatus === SquarespaceFulfillmentStatus.Fulfilled ||
        status === OrderStatus.Processed;

      if (wasManual && isFulfilled && status === OrderStatus.Processed && !hasErrors) {
        return {
          markdown: this.manualOrderFulfilledMarkdown(order),
          data: {
            ...this.orderIssueFields(order).data,
            status: OrderStatus.Processed,
            issues: [],
          },
          resolved: false,
          kind: NotificationKind.ManualOrderFulfilled,
        };
      }

      if (!NotificationService.ORDER_ATTENTION_STATUSES.includes(status)) {
        return {
          markdown: `Order [#${this.orderRef(order)}](/order-view/${order.docId}) — now resolved (${status})`,
          data: this.orderIssueFields(order).data,
          resolved: true,
        };
      }
      return {
        ...this.orderIssueFields(order),
        resolved: false,
        kind: NotificationKind.OrderNeedsAttention,
      };
    });
  }

  private manualOrderFulfilledMarkdown(order: Order): string {
    const orderRef = this.orderRef(order);
    const customer = this.orderCustomer(order);
    const items = this.orderItemsSummary(order);
    const details = [
      customer ? `from ${customer}` : '',
      items ? `for ${items}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const detailsSuffix = details ? ` (${details})` : '';
    return `Order [#${orderRef}](/order-view/${order.docId})${detailsSuffix} — manual order was fulfilled`;
  }

  // The markdown + data for an order-issue notification, shared by the create and
  // reconcile passes.
  private orderIssueFields(order: Order): {
    markdown: string;
    data: NotificationOrderIssueData;
  } {
    const orderRef = this.orderRef(order);
    const status = order.ilcAppOrderStatus as OrderStatus;
    const verb = status === 'error' ? 'failed with an error' : 'needs manual processing';
    const issues = order.ilcAppOrderIssues || [];
    const issuesSuffix = issues.length > 0 ? ` — ${issues.join('; ')}` : '';
    // Basic context so the admin can tell what the order is at a glance: who
    // placed it and what it was for.
    const customer = this.orderCustomer(order);
    const items = this.orderItemsSummary(order);
    const details = [
      customer ? `from ${customer}` : '',
      items ? `for ${items}` : '',
    ].filter(Boolean).join(' ');
    const detailsSuffix = details ? ` (${details})` : '';
    return {
      markdown: `Order [#${orderRef}](/order-view/${order.docId})${detailsSuffix} ${verb}${issuesSuffix}`,
      data: { orderDocId: order.docId, orderRef, status, issues },
    };
  }

  // ---------------------------------------------------------------------------
  // Admin new upload notifications
  // ---------------------------------------------------------------------------

  // Surfaces newly uploaded materials across all members/instructors to admins.
  // Idempotent: it finds the most recent upload timestamp we've already notified
  // this admin about and only adds notifications for uploads created since.
  // Up to MAX_NEW_UPLOAD_NOTIFICATIONS (5) get individual notifications; any
  // additional uploads beyond that get a single summary notification with date
  // range links to Manage Materials.
  private async syncNewUploadNotifications(member: Member): Promise<void> {
    if (this.newUploadsSyncedForMemberDocId === member.docId) return;
    this.newUploadsSyncedForMemberDocId = member.docId;

    const notifCollection = collection(this.db, 'members', member.docId, 'notifications');

    // Find previous upload notifications to determine the cutoff timestamp and
    // the set of upload IDs already notified for this admin.
    const existingSnap = await getDocs(
      query(
        notifCollection,
        where('kind', 'in', [
          NotificationKind.NewUpload,
          NotificationKind.NewUploadsSummary,
        ]),
      ),
    );

    let cutoffIso = '';
    const notifiedUploadIds = new Set<string>();
    const existingUploadDocs: QueryDocumentSnapshot[] = [];

    existingSnap.forEach((d) => {
      const notif = firestoreDocToMemberNotification(d);
      if (notif.kind === NotificationKind.NewUpload) {
        existingUploadDocs.push(d);
        const data = notif.data as NotificationUploadData;
        if (data?.uploadDocId) notifiedUploadIds.add(data.uploadDocId);
        const ts = data?.uploadCreatedAt || notif.createdAt || '';
        if (ts && ts > cutoffIso) cutoffIso = ts;
      } else if (notif.kind === NotificationKind.NewUploadsSummary) {
        const data = notif.data as NotificationUploadsSummaryData;
        const ts = data?.lastSeenDateStr || data?.endDate || notif.createdAt || '';
        if (ts && ts > cutoffIso) cutoffIso = ts;
      }
    });

    const uploadsColGroup = collectionGroup(this.db, 'uploads');
    const uploadsQuery = cutoffIso
      ? query(uploadsColGroup, where('createdAt', '>', cutoffIso))
      : uploadsColGroup;

    const uploadsSnap = await getDocs(uploadsQuery);

    let newUploads = uploadsSnap.docs
      .map((d) => firestoreDocToUploadItem(d))
      .filter(
        (u) =>
          u.docId &&
          u.memberDocId !== member.docId &&
          !notifiedUploadIds.has(u.docId),
      );

    if (cutoffIso) {
      newUploads = newUploads.filter((u) => (u.createdAt || '') > cutoffIso);
    }

    // Sort newest first (descending by createdAt)
    newUploads.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    if (newUploads.length > 0) {
      const max = NotificationService.MAX_NEW_UPLOAD_NOTIFICATIONS;
      const batch = writeBatch(this.db);

      if (newUploads.length <= max) {
        for (const upload of newUploads) {
          const ref = doc(notifCollection);
          const fields = this.uploadNotificationFields(upload);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: upload.createdAt || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.NewUpload,
            data: fields.data,
          };
          batch.set(ref, notification);
        }
      } else {
        const latestUploads = newUploads.slice(0, max);
        const remainingUploads = newUploads.slice(max);

        for (const upload of latestUploads) {
          const ref = doc(notifCollection);
          const fields = this.uploadNotificationFields(upload);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: fields.markdown,
            createdAt: upload.createdAt || new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.NewUpload,
            data: fields.data,
          };
          batch.set(ref, notification);
        }

        // 1 summary notification for the remaining older uploads
        const oldestRemaining = remainingUploads[remainingUploads.length - 1];
        const newestRemaining = remainingUploads[0];
        const timeX = oldestRemaining.createdAt || oldestRemaining.date || '';
        const timeY = newestRemaining.createdAt || newestRemaining.date || '';
        const startDateStr = timeX.split('T')[0];
        const endDateStr = timeY.split('T')[0];

        const count = remainingUploads.length;
        const plural = count === 1 ? 'upload' : 'uploads';
        const dateDisplay = this.formatDateRangeDisplay(timeX, timeY);
        const link = `/manage-materials?startDate=${encodeURIComponent(startDateStr)}&endDate=${encodeURIComponent(endDateStr)}`;
        const summaryMarkdown = `📁 **${count}** more ${plural} ${dateDisplay}: [View in Materials Manager](${link})`;

        const summaryRef = doc(notifCollection);
        const summaryNotification: MemberNotification = {
          docId: summaryRef.id,
          markdown: summaryMarkdown,
          createdAt: timeY || new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.NewUploadsSummary,
          data: {
            count,
            startDate: startDateStr,
            endDate: endDateStr,
            lastSeenDateStr: timeY,
          },
        };
        batch.set(summaryRef, summaryNotification);
      }

      await batch.commit();
    }

    // Reconcile already-surfaced upload notifications: update title/metadata if
    // changed, or mark as removed + dismissed if deleted (or if uploaded by the user themselves).
    await this.reconcileNotifications(existingUploadDocs, 'uploadDocId', async (notif) => {
      const data = notif.data as NotificationUploadData;
      if (!data?.memberDocId || !data?.uploadDocId) return null;
      if (data.memberDocId === member.docId) {
        return {
          markdown: notif.markdown,
          data: { ...data },
          resolved: true,
        };
      }
      try {
        const snap = await getDoc(
          doc(this.db, 'members', data.memberDocId, 'uploads', data.uploadDocId),
        );
        if (!snap.exists()) {
          return {
            markdown: `Upload "${data.uploadName || 'item'}" — removed`,
            data: { ...data },
            resolved: true,
          };
        }
        const upload = firestoreDocToUploadItem(snap);
        return { ...this.uploadNotificationFields(upload), resolved: false };
      } catch (e) {
        console.error('Failed to reconcile upload notification:', e);
        return null;
      }
    });
  }

  // Formats a human-readable date range description, e.g. "on 2026-08-11" or "between 2026-08-01 and 2026-08-05".
  private formatDateRangeDisplay(timeX: string, timeY: string): string {
    const dX = timeX.split('T')[0] || timeX;
    const dY = timeY.split('T')[0] || timeY;
    if (dX === dY) {
      return `on ${dX}`;
    }
    return `between ${dX} and ${dY}`;
  }

  // The markdown + data for an upload notification, shared by create and reconcile passes.
  private uploadNotificationFields(upload: UploadItem): {
    markdown: string;
    data: NotificationUploadData;
  } {
    const uploader = upload.memberName
      ? `${upload.memberName}${upload.memberId ? ` (${upload.memberId})` : ''}`
      : (upload.memberId || 'a member');
    const eventSuffix = upload.eventTitle ? ` for **${upload.eventTitle}**` : '';
    const locationSuffix = upload.location ? ` in ${upload.location}` : '';
    const link = `/manage-materials?q=${encodeURIComponent(upload.name)}`;
    return {
      markdown: `New upload from **${uploader}**: [${upload.name}](${link})${eventSuffix}${locationSuffix}`,
      data: {
        uploadDocId: upload.docId,
        memberDocId: upload.memberDocId,
        uploadName: upload.name,
        uploaderName: upload.memberName || '',
        uploaderMemberId: upload.memberId || '',
        uploadCreatedAt: upload.createdAt,
        eventDocId: upload.eventDocId || '',
        eventTitle: upload.eventTitle || '',
      },
    };
  }

  // Surfaces gradings that are completed (passed/not-passed) but not yet paid as
  // TODO notifications, for the student themselves and for the instructors
  // responsible for that student's grading. Idempotent and modelled on the
  // order-issue catch-up: it reads the member's own GradingUnpaid notifications
  // to find which gradings have already been surfaced. Runs once per session.
  private async syncUnpaidGradingNotifications(member: Member): Promise<void> {
    if (this.unpaidGradingsSyncedForMemberDocId === member.docId) return;
    this.unpaidGradingsSyncedForMemberDocId = member.docId;

    const notifCollection = collection(this.db, 'members', member.docId, 'notifications');

    // Which gradings have we already surfaced as unpaid for this member?
    const existingSnap = await getDocs(
      query(
        notifCollection,
        where('kind', 'in', [
          NotificationKind.GradingUnpaid,
          NotificationKind.UnpaidGradingsSummary,
        ]),
      ),
    );
    const notifiedGradingIds = new Set<string>();
    const existingGradingDocs: QueryDocumentSnapshot[] = [];
    existingSnap.forEach((d) => {
      const notif = firestoreDocToMemberNotification(d);
      if (notif.kind === NotificationKind.GradingUnpaid) {
        existingGradingDocs.push(d);
        const data = notif.data as { gradingDocId?: string };
        if (data?.gradingDocId) notifiedGradingIds.add(data.gradingDocId);
      }
    });

    // Candidate gradings, de-duplicated by docId: the member's own gradings (as a
    // student, via gradingDocIds) plus this member's students' gradings (from the
    // instructor mirror at /instructors/{memberDocId}/gradings).
    const gradings = new Map<string, Grading>();
    for (const gradingId of member.gradingDocIds || []) {
      try {
        const snap = await getDoc(doc(this.db, 'gradings', gradingId));
        if (snap.exists()) gradings.set(snap.id, firestoreDocToGrading(snap));
      } catch {
        // Ignore individual read failures (e.g. permissions) and continue.
      }
    }
    if (member.instructorId) {
      try {
        const mirrorSnap = await getDocs(
          collection(this.db, 'instructors', member.docId, 'gradings'),
        );
        mirrorSnap.forEach((d) => gradings.set(d.id, firestoreDocToGrading(d)));
      } catch {
        // No instructor mirror / no access — ignore.
      }
    }

    const unpaid = [...gradings.values()]
      .filter(
        (g) =>
          NotificationService.COMPLETED_GRADING_STATUSES.includes(g.status) &&
          !isGradingPaid(g) &&
          !notifiedGradingIds.has(g.docId),
      )
      .sort((a, b) =>
        (b.gradingEventDate || b.lastUpdated || '').localeCompare(
          a.gradingEventDate || a.lastUpdated || '',
        ),
      );

    // May be empty when nothing new is outstanding — we still fall through to
    // reconciliation below.
    if (unpaid.length > 0) {
      const max = NotificationService.MAX_UNPAID_GRADING_NOTIFICATIONS;
      const batch = writeBatch(this.db);

      if (unpaid.length <= max) {
        for (const g of unpaid) {
          const ref = doc(notifCollection);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: this.unpaidGradingMarkdown(g, g.studentMemberDocId === member.docId),
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingUnpaid,
            data: { gradingDocId: g.docId, level: g.level },
          };
          batch.set(ref, notification);
        }
      } else {
        const latestUnpaid = unpaid.slice(0, max);
        const remainingUnpaid = unpaid.slice(max);

        for (const g of latestUnpaid) {
          const ref = doc(notifCollection);
          const notification: MemberNotification = {
            docId: ref.id,
            markdown: this.unpaidGradingMarkdown(g, g.studentMemberDocId === member.docId),
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingUnpaid,
            data: { gradingDocId: g.docId, level: g.level },
          };
          batch.set(ref, notification);
        }

        const count = remainingUnpaid.length;
        const plural = count === 1 ? 'unpaid grading' : 'unpaid gradings';
        const isStudent = member.docId === remainingUnpaid[0].studentMemberDocId;
        const link = member.instructorId ? '/gradings' : '/my-gradings';
        const summaryMarkdown = `🥋 **${count}** more ${plural}: [View in Gradings](${link})`;
        const summaryRef = doc(notifCollection);
        const summaryNotification: MemberNotification = {
          docId: summaryRef.id,
          markdown: summaryMarkdown,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.UnpaidGradingsSummary,
          data: { count, isStudent },
        };
        batch.set(summaryRef, summaryNotification);
      }

      await batch.commit();
    }

    // Reconcile already-surfaced unpaid-grading TODOs: a grading that is now paid
    // (or no longer completed, or deleted) is rewritten to say so and dismissed; an
    // outstanding one has its message refreshed in place.
    await this.reconcileNotifications(existingGradingDocs, 'gradingDocId', async (notif) => {
      const data = notif.data as NotificationGradingData;
      const snap = await getDoc(doc(this.db, 'gradings', data.gradingDocId));
      if (!snap.exists()) {
        return {
          markdown: `Grading for **${data.level}** — no longer present.`,
          data: { ...data },
          resolved: true,
        };
      }
      const g = firestoreDocToGrading(snap);
      const gradingData = { gradingDocId: g.docId, level: g.level };
      if (!NotificationService.COMPLETED_GRADING_STATUSES.includes(g.status)) {
        return {
          markdown: `Grading for **${g.level}** — no longer awaiting payment.`,
          data: gradingData,
          resolved: true,
        };
      }
      if (isGradingPaid(g)) {
        return {
          markdown: `✅ Grading for **${g.level}** is now paid.`,
          data: gradingData,
          resolved: true,
        };
      }
      return {
        markdown: this.unpaidGradingMarkdown(g, g.studentMemberDocId === member.docId),
        data: gradingData,
        resolved: false,
      };
    });
  }

  // The markdown for an unpaid-grading TODO notification, shared by the create and
  // reconcile passes. `forSelf` is true when the recipient is the student.
  private unpaidGradingMarkdown(g: Grading, forSelf: boolean): string {
    const link = `/gradings/${g.docId}`;
    return forSelf
      ? `⚠️ Your grading for **${g.level}** is complete but **not yet paid**. ` +
          `Please arrange payment so it can be finalised. [Open the grading](${link}).`
      : `⚠️ **${g.studentName || 'A student'}**'s grading for **${g.level}** is complete but ` +
          `**not yet paid**. [Open the grading](${link}).`;
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

  public async dismissAllFyi(): Promise<void> {
    const member = this.firebaseService.user()?.member;
    const active = this.notifications().filter(
      (n) => notificationStyle(n.kind) === NotificationStyle.Info,
    );
    if (!member || active.length === 0) return;

    const batch = writeBatch(this.db);
    active.forEach((n) => {
      const ref = doc(this.db, 'members', member.docId, 'notifications', n.docId);
      batch.update(ref, { dismissed: true });
    });
    await batch.commit();
  }
}
