# Notifications & Push

This document describes how notifications flow through the system — from the
event that triggers them, to the in‑app feed, to a background push that can
reach a member's phone even when the app is closed.

## Two layers, one source of truth

Every notification is a Firestore document stored under the member it belongs to:

```
/members/{memberDocId}/notifications/{notifId}   →  MemberNotification
```

That document is the single source of truth. Two independent things consume it:

1. **The in‑app feed** — while the member has the app open, the client streams
   these documents live and renders them in the "Updates & Notifications" list
   (home feed) and the full notifications view.
2. **Background web push** — a Cloud Function reacts to each newly created
   document and sends an OS‑level push to the member's registered devices, so a
   banner appears even when the app/tab is closed.

The two layers never disagree, because both derive from the same document.

## What creates a notification document

Notification documents are written from a few places. All server‑side writes go
through the shared helper `createMemberNotification` in
[`functions/src/notifications.ts`](../functions/src/notifications.ts), which also
de‑duplicates by the entity a notification is about (`gradingDocId`, `eventId`,
or `orderId`).

| Trigger | Where | Kind(s) |
| --- | --- | --- |
| A grading is purchased / created | `onGradingCreated` in [`functions/src/on-grading-update.ts`](../functions/src/on-grading-update.ts) | `GradingPurchased`, `GradingRequestsYouAsInstructor` |
| A grading is accepted/declined/assigned/passed/not‑passed | `onGradingUpdated` (same file) | `GradingRequestAccepted`, `GradingPassed`, `GradingNotPassed`, … |
| Any order is fully processed | `notifyPurchaseFulfilled` in [`functions/src/squarespace-orders/api.ts`](../functions/src/squarespace-orders/api.ts) | `PurchaseFulfilled` |
| New blog posts the member hasn't seen | `syncBlogPostNotifications` in [`src/app/notification.service.ts`](../src/app/notification.service.ts) (runs on the **client** at login) | `BlogPost` |

Note that blog‑post notifications are written by the client, while the rest are
written by Cloud Functions. It doesn't matter for the rest of the flow — once a
document lands in the `notifications` subcollection, the same machinery picks it
up regardless of who wrote it.

## The in‑app feed (app open)

[`NotificationService`](../src/app/notification.service.ts) subscribes to the
member's `notifications` subcollection with `onSnapshot`:

- The home feed shows **unread** notifications (`dismissed == false`).
- The full notifications view shows the complete history.

While the app is open and the OS has granted permission, the service can also
pop a *local* OS banner via the service worker
(`registration.showNotification`). This is gated by the per‑device "Browser
Push" preferences in localStorage and only works while a tab is alive — it is
**not** the same as background push below.

## Background web push (app closed)

This is the standards‑based [Web Push](https://web.dev/articles/push-notifications-overview)
path. It uses Angular's `SwPush` on the client (which reuses the existing
`ngsw-worker.js`) and the `web-push` library on the server. We use this rather
than Firebase Cloud Messaging because FCM's API targets FCM registration tokens,
whereas `SwPush` produces standard `PushSubscription`s.

### One‑time: registering a device

```
Member toggles "Receive push notifications" (account‑wide)   ── settings UI
        │  writes member.notificationSettings.globalPushEnabled = true
        ▼
Member toggles "Enable push on this device"                  ── settings UI
        │  (only enable‑able while the account switch is on)
        ▼
NotificationService.enablePushOnThisDevice()
        │  asks the browser for Notification permission
        │  SwPush.requestSubscription({ serverPublicKey: VAPID_PUBLIC })
        ▼
Browser returns a PushSubscription { endpoint, keys: { p256dh, auth } }
        │
        ▼
Stored at /members/{id}/pushSubscriptions/{sha256(endpoint)}   (PushSubscriptionDoc)
```

The document id is a SHA‑256 of the endpoint, so the same device re‑subscribing
overwrites its own entry instead of piling up duplicates. Disabling on a device
deletes that document and calls `SwPush.unsubscribe()`.

### Each notification: sending the push

When a notification document is created, the Firestore trigger
`sendPushOnNotification` in [`functions/src/send-push.ts`](../functions/src/send-push.ts)
runs:

```
notification doc created at /members/{id}/notifications/{notifId}
        │
        ▼
sendPushOnNotification (onDocumentCreated)
        │  1. read /members/{id}.notificationSettings
        │     • stop unless globalPushEnabled === true        (push is opt‑in)
        │     • stop if pushEnabled[kind] === false            (muted kind)
        │  2. read /members/{id}/pushSubscriptions/*
        │  3. for each subscription:
        │       webpush.sendNotification(sub, payload)         (VAPID‑signed,
        │                                                        encrypted)
        ▼
Browser push service (Google / Mozilla / Apple)
        │  delivers to the device, waking the service worker
        ▼
ngsw-worker.js  →  shows the notification banner
        │  tap → focuses an open tab or opens /#/notifications
        ▼
Member sees the banner even with the app closed
```

Expired/invalid subscriptions (HTTP 404/410 from the push service) are pruned
automatically during sending.

## Settings & gating

There are two scopes of preference:

- **Account‑wide (server)** — `member.notificationSettings`:
  - `globalPushEnabled` — the master switch. Background push is **opt‑in**: if
    this is not `true`, `sendPushOnNotification` sends nothing.
  - `pushEnabled[kind]` — lets a member mute specific kinds for background push.
- **Per‑device (this browser)** — whether *this* browser holds an active push
  subscription, controlled by the "Enable push on this device" toggle. It can
  only be turned on while the account‑wide switch is on.

Managed from [`src/app/settings/notification-settings/`](../src/app/settings/notification-settings/).

## Configuration

Web push is authenticated with a [VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
key pair (generated with `pnpm dlx web-push generate-vapid-keys`):

- **Public key** — must match on both ends:
  - client: `environment.vapidPublicKey` (`src/environments/*`)
  - functions: `environment.vapidPublicKey` (`functions/src/environment/environment.ts`)
- **Private key** — stored only as the Cloud Function secret `VAPID_PRIVATE_KEY`
  (never committed).

If either key is missing, the client quietly skips subscribing and the server
quietly skips sending, so the in‑app feed still works.

## Access control

Defined in [`firestore.rules`](../firestore.rules):

- `/members/{id}/notifications/{notifId}` — readable/writable by the member (and
  admins); the member may only flip `dismissed` on update.
- `/members/{id}/pushSubscriptions/{subId}` — the member manages their own
  subscriptions; the sending Cloud Function reads/prunes them via the Admin SDK
  (which bypasses rules).

## Platform notes

- Background push only works in the **installed PWA over HTTPS** with the service
  worker active. Angular's service worker is disabled under `ng serve`, so
  `SwPush.isEnabled` is `false` there and the device toggle is hidden.
- On iOS, web push requires the PWA be **added to the Home Screen** (iOS 16.4+).
- A member can be subscribed on several devices at once; each has its own
  `pushSubscriptions` document and all receive the push.
