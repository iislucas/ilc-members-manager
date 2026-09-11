# Purchase Confirmations, Notifications & Event Digest Architecture Plan

This document defines the architectural plan for:
1. **Automated Email Confirmations for All Purchases** (Stripe & Squarespace).
2. **Upcoming Event Digests** (Weekly / Monthly scheduled emails for opted-in members, powered by a **two-tier template system**: overall email template + per-event card template).
3. **Unified Admin Email Templates Manager** (supporting view, edit, validation, and test sending).
4. **Enhanced Markdown Editor Toolbar** (foldable/unfoldable placeholder palette with short descriptions for each token).
5. **Cloud Project Operations & Setup Instructions** (Firebase Trigger Email extension, Cloud Scheduler, SMTP relay/SendGrid, DNS deliverability).

---

## 1. Status Review & Problem Statement

### 1.1 Current Implementation Status

| Capability | Current State | Notes |
|---|---|---|
| **In-App Notifications** | ✅ Fully Supported | Stored at `/members/{memberDocId}/notifications/{notifId}` (`MemberNotification`). Consumed in real-time via `onSnapshot` in `NotificationService`. |
| **Background Web Push** | ✅ Fully Supported | Cloud Function `sendPushOnNotification` in `functions/src/send-push.ts` uses `web-push` with VAPID keys; opt-in per member account and per notification kind. |
| **Outbound Email Dispatch** | ⚠️ Partial (Welcome only) | Only New Member Welcome (`membershipActivated`) and New Instructor Welcome (`instructorLicenseActivated`) are sent via `/mail` in `functions/src/on-member-update.ts`. |
| **Purchase Email Confirmations** | ❌ Missing | Neither Stripe Checkout orders, subscription renewals, VOD purchases, grading fees, event registrations, nor Squarespace orders send email confirmations to the purchaser. Only in-app `PurchaseFulfilled` notifications are generated. |
| **Upcoming Event Digests** | ❌ Missing | No automated weekly or monthly digest of upcoming events/workshops is currently sent to members. |
| **Admin Template Editor** | ⚠️ Limited to 2 templates | In `src/app/settings/email-templates/`: Only allows editing `membershipActivated` and `instructorLicenseActivated`. No purchase confirmation or event digest templates exist. |
| **Editor Placeholders Toolbar** | ⚠️ Basic inline buttons | In `src/app/markdown-editor/`: Chips appear as unadorned inline buttons at the end of the scrollable toolbar. No folding/unfolding, and no placeholder descriptions exist (`EditorChip` lacks a `description` field). |
| **Email Queue Processing** | ⚠️ Documented in `SETUP.md` | Cloud Functions enqueue tasks to `/mail`. Outbound delivery relies on the Firebase "Trigger Email" extension (`firebase/firestore-send-email`), but cloud setup steps, error tracking, and fallback handling need clear operational guidance. |

### 1.2 Objectives

1. **Automated Purchase Confirmations**: Send rich, branded Markdown email confirmations immediately upon successful completion of any purchase (Membership, License, Event Registration, VOD, Video Library, or Grading).
2. **Upcoming Event Digests (Weekly & Monthly)**: Scheduled email newsletters delivering forthcoming workshops/events to opted-in members, driven by a **two-tier template engine**:
   - **Per-Event Item Template**: Markdown template defining how an individual event card renders.
   - **Overall Digest Template**: Email subject & body template with an `{eventsList}` placeholder populated with all compiled event cards.
3. **Unified Admin Template Manager**: Allow ILC Administrators in `/settings?tab=email-templates` to view, customize, and test all email templates across purchase confirmations, member onboarding, and event digests.
4. **Foldable Markdown Placeholders with Descriptions**: Upgrade `MarkdownEditor` to display template placeholders in a clearly delineated, foldable/unfoldable section of the toolbar, showing short descriptions for every placeholder token.
5. **Cloud Project Readiness**: Provide exact CLI commands, Cloud Scheduler cron setup, SMTP configuration steps (Google Workspace Relay vs. SendGrid), DNS deliverability requirements (SPF/DKIM/DMARC), and IAM roles.
6. **Documentation Alignment**: Update `README.md` and cross-reference `SETUP.md` with complete instructions for local emulator testing and production deployment.

---

## 2. System Architecture

```mermaid
flowchart TD
    subgraph Client["Angular Client App"]
        AdminSettings["Admin Settings\n(/settings?tab=email-templates)"]
        MarkdownEditor["Markdown Editor\n(Foldable Toolbar + Placeholders + Descriptions)"]
        Purchaser["Purchaser / Member / Attendee"]
        MemberSettings["Notification Settings\n(Digest Opt-in: Weekly / Monthly / None)"]
    end

    subgraph Gateways["Payment Gateways & Schedulers"]
        StripeCheckout["Stripe Checkout / Subscriptions"]
        Squarespace["Squarespace Store"]
        CloudScheduler["Google Cloud Scheduler\n(Weekly & Monthly Cron)"]
    end

    subgraph Backend["Firebase Cloud Functions"]
        StripeWebhook["stripeWebhook\n(functions/src/stripe-webhook.ts)"]
        StripeFulfillment["stripe-fulfillment.ts\n(fulfillStripeOrder, fulfillEventRegistration)"]
        SquarespaceAPI["squarespace-orders/api.ts\n(notifyPurchaseFulfilled)"]
        MemberUpdateTrigger["on-member-update.ts\n(handleMembershipActivation)"]
        EventDigestCron["event-digest-scheduler.ts\n(Weekly / Monthly Fanout)"]
        EmailDispatcher["email-dispatcher.ts\n(Centralized Template Loader & Formatter)"]
    end

    subgraph Firestore["Cloud Firestore"]
        SystemTemplates["/system/email-templates\n(Purchase, Welcome & 2-Tier Digest Templates)"]
        EventsCol["/events/{eventId}\n(Public Listed Events)"]
        MembersCol["/members/{memberDocId}\n(Preferences & Emails)"]
        MailQueue["/mail/{mailId}\n(Task documents for outbound delivery)"]
        MemberNotifs["/members/{id}/notifications/{notifId}\n(In-App Notification Feed)"]
    end

    subgraph CloudExtension["GCP / Firebase Email Service"]
        TriggerEmailExt["Firebase Trigger Email Extension\n(firebase/firestore-send-email)"]
        SMTPRelay["SMTP Server / SendGrid API\n(Google Workspace / SendGrid)"]
    end

    AdminSettings -->|Edit & Preview Templates| MarkdownEditor
    AdminSettings -->|Save Templates| SystemTemplates
    MemberSettings -->|Save Digest Frequency| MembersCol

    Purchaser -->|Pay for Product / Event| StripeCheckout
    StripeCheckout -->|checkout.session.completed / invoice.paid| StripeWebhook
    StripeWebhook --> StripeFulfillment
    Squarespace -->|Fulfill Order| SquarespaceAPI

    CloudScheduler -->|Trigger Weekly/Monthly| EventDigestCron
    EventDigestCron -->|Read Upcoming Events| EventsCol
    EventDigestCron -->|Query Opted-In Members| MembersCol
    EventDigestCron -->|Compile 2-Tier Templates| EmailDispatcher

    StripeFulfillment -->|1. Create In-App Notification| MemberNotifs
    StripeFulfillment -->|2. Dispatch Confirmation Email| EmailDispatcher
    SquarespaceAPI -->|1. Create In-App Notification| MemberNotifs
    SquarespaceAPI -->|2. Dispatch Confirmation Email| EmailDispatcher
    MemberUpdateTrigger -->|Dispatch Welcome Email| EmailDispatcher

    EmailDispatcher -->|Load Custom Templates| SystemTemplates
    EmailDispatcher -->|Enqueue Email Task Payload| MailQueue

    MailQueue -->|Firestore onCreate Trigger| TriggerEmailExt
    TriggerEmailExt -->|Send via authenticated SMTP| SMTPRelay
    SMTPRelay -->|Deliver to Inbox| Purchaser
```

---

## 3. Data Model & Firestore Schema

### 3.1 Extended `EmailTemplates` Interface

File: [`functions/src/data-model/content-cache.ts`](../../functions/src/data-model/content-cache.ts)

Extend the document stored at `/system/email-templates` to support purchase categories and the **two-tier event digest templates**:

```typescript
export interface EmailTemplates {
  // --- Account & Activation Emails ---
  membershipActivatedSubject: string;
  membershipActivatedBody: string;
  instructorLicenseActivatedSubject: string;
  instructorLicenseActivatedBody: string;

  // --- Purchase & Order Confirmations ---
  orderConfirmationSubject: string;
  orderConfirmationBody: string;

  eventRegistrationConfirmationSubject: string;
  eventRegistrationConfirmationBody: string;

  vodPurchaseConfirmationSubject: string;
  vodPurchaseConfirmationBody: string;

  gradingPaymentConfirmationSubject: string;
  gradingPaymentConfirmationBody: string;

  subscriptionRenewalSubject: string;
  subscriptionRenewalBody: string;

  // --- Upcoming Event Digest (Two-Tier Template) ---
  // 1. Overall Email Template (contains subject and body with {eventsList} placeholder)
  eventDigestOverallSubject: string;
  eventDigestOverallBody: string;

  // 2. Per-Event Item Template (renders an individual event card within the list)
  eventDigestItemTemplate: string;
}
```

### 3.2 Member Notification Settings: Digest Preferences

File: [`functions/src/data-model/notifications.ts`](../../functions/src/data-model/notifications.ts)

Add `eventDigestFrequency` to allow members to control their event newsletter delivery:

```typescript
export type EventDigestFrequency = 'none' | 'weekly' | 'monthly';

export interface MemberNotificationSettings {
  pushEnabled: { [kind in NotificationKind]?: boolean };
  homeEnabled: { [kind in NotificationKind]?: boolean };
  globalPushEnabled?: boolean;
  
  // Frequency of upcoming events digest email (default: 'none' / opt-in)
  eventDigestFrequency?: EventDigestFrequency;
}
```

### 3.3 Extended `EditorChip` Contract

File: [`src/app/markdown-editor/markdown-editor.ts`](../../src/app/markdown-editor/markdown-editor.ts)

Add the `description` field to `EditorChip` so each placeholder token carries a human-readable explanation:

```typescript
export interface EditorChip {
  // Literal text inserted into markdown, e.g. '{name}'
  token: string;
  // Optional button label; defaults to token
  label?: string;
  // Short description of the dynamic value substituted into this placeholder
  description?: string;
}
```

### 3.4 Default Templates & Placeholder Dictionaries

File: [`functions/src/email-templates.ts`](../../functions/src/email-templates.ts)

Every template provides a default implementation so the application operates out-of-the-box even before an admin customizes templates:

| Template Key | Purpose | Supported Placeholders |
|---|---|---|
| `membershipActivated` | Welcome email when membership becomes active | `{name}`, `{memberId}`, `{email}`, `{appBase}` |
| `instructorLicenseActivated` | Welcome email when instructor license is issued | `{name}`, `{memberId}`, `{instructorId}`, `{email}`, `{appBase}`, `{instructorSopUrl}` |
| `orderConfirmation` | General store purchase or itemized Stripe order | `{name}`, `{orderNumber}`, `{orderDate}`, `{amount}`, `{currency}`, `{itemsSummary}`, `{receiptUrl}`, `{appBase}` |
| `eventRegistrationConfirmation` | Event/workshop registration receipt | `{name}`, `{eventTitle}`, `{eventDates}`, `{eventLocation}`, `{attendanceType}`, `{onlineJoiningLink}`, `{specialInstructions}`, `{amount}`, `{receiptUrl}`, `{appBase}` |
| `vodPurchaseConfirmation` | Video on Demand rental or lifetime purchase | `{name}`, `{videoTitle}`, `{videoUrl}`, `{amount}`, `{receiptUrl}`, `{appBase}` |
| `gradingPaymentConfirmation` | Assessment fee receipt and next steps | `{name}`, `{memberId}`, `{gradingLevel}`, `{gradingEventName}`, `{gradingDate}`, `{amount}`, `{gradingUrl}`, `{appBase}` |
| `subscriptionRenewal` | Recurring renewal notification (Class Library / Membership) | `{name}`, `{planName}`, `{amount}`, `{renewalDate}`, `{nextRenewalDate}`, `{receiptUrl}`, `{appBase}` |
| **`eventDigestOverall`** | Overall email wrapper for forthcoming events digest | `{name}`, `{period}` *(e.g. "this week" / "this month")*, `{eventsCount}`, **`{eventsList}`** *(replaced by compiled event items)*, `{calendarUrl}`, `{preferencesUrl}`, `{appBase}` |
| **`eventDigestItem`** | Markdown template for a single event card inside `{eventsList}` | `{eventTitle}`, `{eventDates}`, `{eventLocation}`, `{eventInstructors}`, `{eventDetailsUrl}`, `{eventPrice}`, `{attendanceType}`, `{eventSummary}` |

#### Default Digest Templates:

**Per-Event Item Template (`eventDigestItemTemplate`)**:
```markdown
### [{eventTitle}]({eventDetailsUrl})
- **Dates**: {eventDates}
- **Location**: {eventLocation} | **Type**: {attendanceType}
- **Instructor(s)**: {eventInstructors}
{eventSummary}

[View Details & Register →]({eventDetailsUrl})
```

**Overall Email Template (`eventDigestOverallBody`)**:
```markdown
Hi {name},

Here are the upcoming I Liq Chuan workshops and events for **{period}**:

{eventsList}

---

Browse the complete calendar anytime at [Events & Workshops Calendar]({calendarUrl}).

*You received this email because you opted into {period} event updates. You can change your frequency or unsubscribe in your [Notification Preferences]({preferencesUrl}).*
```

---

## 4. Markdown Editor Toolbar: Foldable Placeholders with Descriptions

### 4.1 UI / UX Requirements

1. **Clear Delineation**:
   - The placeholders toolbar does not blend into standard text formatting icons (Bold, Link, etc.).
   - It is housed in a distinct, styled section (`.toolbar-placeholders-group`) with a subtle background accent, dashed border, and a `{ } Placeholders` header badge.
2. **Foldable / Unfoldable**:
   - A toggle button in the toolbar allows collapsing the placeholder panel to save vertical/horizontal space, or expanding it when editing template text.
   - The toggle displays the token count (e.g. `{ } Placeholders (7)` + chevron `expand_more` / `expand_less`).
3. **Short Descriptions for Each Placeholder**:
   - When unfolded, placeholders are displayed with their short descriptions clearly visible (e.g. `[{orderNumber}] Official order or invoice #`, `[{eventsList}] List of all upcoming event cards compiled from the item template`).
4. **One-Click Cursor Insertion**:
   - Clicking a placeholder chip immediately inserts `{token}` at the user's cursor position in ProseMirror, preserves focus, and maintains touch compatibility on mobile devices.

### 4.2 Component Template Changes

File: [`src/app/markdown-editor/markdown-editor.html`](../../src/app/markdown-editor/markdown-editor.html)

```html
<!-- Delineated, Foldable Placeholder Toolbar Group -->
@if (chips().length > 0) {
  <div class="toolbar-divider"></div>
  <div class="toolbar-placeholders-group" [class.unfolded]="placeholdersUnfolded()">
    <!-- Fold / Unfold Toggle Button -->
    <button type="button" 
            class="placeholders-toggle-btn"
            (click)="togglePlaceholdersFold(); $event.stopPropagation()"
            [title]="placeholdersUnfolded() ? 'Fold placeholder palette' : 'Unfold placeholder palette'">
      <app-icon name="code" width="1.1em" height="1.1em"></app-icon>
      <span class="toggle-label">Placeholders ({{ chips().length }})</span>
      <app-icon [name]="placeholdersUnfolded() ? 'chevron_up' : 'chevron_down'" width="0.9em" height="0.9em"></app-icon>
    </button>

    <!-- Collapsible Chips Palette with Descriptions -->
    @if (placeholdersUnfolded()) {
      <div class="placeholders-palette">
        @for (chip of chips(); track chip.token) {
          <div class="placeholder-item" 
               (click)="insertChip(chip); $event.stopPropagation()"
               [title]="'Click to insert ' + chip.token">
            <button type="button" class="chip-insert">
              {{ chip.label || chip.token }}
            </button>
            @if (chip.description) {
              <span class="chip-description">{{ chip.description }}</span>
            }
          </div>
        }
      </div>
    }
  </div>
}
```

### 4.3 Component Styling

File: [`src/app/markdown-editor/markdown-editor.scss`](../../src/app/markdown-editor/markdown-editor.scss)

```scss
.toolbar-placeholders-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  background-color: rgba(0, 0, 0, 0.02);
  border: 1px dashed $border-color-light;
  border-radius: 6px;
  flex-shrink: 0;

  .placeholders-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    color: $text-secondary;
    border-radius: 4px;

    &:hover {
      background-color: $button-hover-bg-color;
      color: $text-primary;
    }
  }

  &.unfolded {
    background-color: #fcfcfc;
    border-style: solid;
    border-color: $theme-chip-border-color;
  }

  .placeholders-palette {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    max-width: 600px;
    padding: 2px 4px;

    .placeholder-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background-color 0.15s ease;

      &:hover {
        background-color: rgba(0, 0, 0, 0.05);
      }

      .chip-insert {
        font-family: monospace;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 10px;
        background: $theme-chip-bg-color;
        border: 1px solid $theme-chip-border-color;
        color: $text-primary;
      }

      .chip-description {
        font-size: 11px;
        color: $text-secondary;
        white-space: nowrap;
      }
    }
  }
}
```

---

## 5. Admin Settings: Viewing & Editing Email Templates

### 5.1 Redesigned Template Management Component

File: `src/app/settings/email-templates/email-templates.ts`, `email-templates.html`

The updated component organizes templates into three logical tabs:
1. **Purchase Confirmations Tab**:
   - Store / General Order (`orderConfirmation`)
   - Event Registration (`eventRegistrationConfirmation`)
   - Membership Purchase & Renewal (`membershipConfirmation`)
   - Instructor License Purchase & Renewal (`instructorLicenseConfirmation`)
   - Video on Demand (`vodPurchaseConfirmation`)
   - Grading Assessment Fee (`gradingPaymentConfirmation`)
   - Subscription Renewal (`subscriptionRenewal`)
2. **Onboarding & Welcome Tab**:
   - New Member Welcome (`membershipActivated`)
   - New Instructor Welcome (`instructorLicenseActivated`)
3. **Upcoming Events Digest Tab (Two-Tier Template Editor)**:
   - **Section 1: Overall Email Digest Template**:
     - Subject Line: `eventDigestOverallSubject` (e.g. `Upcoming I Liq Chuan Events - {period}`)
     - Body Editor: `eventDigestOverallBody` with `{eventsList}`, `{name}`, `{period}`, `{calendarUrl}`, `{preferencesUrl}`.
   - **Section 2: Per-Event Card Template**:
     - Body Editor: `eventDigestItemTemplate` with `{eventTitle}`, `{eventDates}`, `{eventLocation}`, `{eventInstructors}`, `{eventDetailsUrl}`, `{eventPrice}`, `{attendanceType}`.
   - **Live Combined Preview**:
     - Renders a live preview of the overall email with sample event data compiled into the `{eventsList}` block.
4. **Validation & Test Sending**:
   - Continuous syntax validation using `findUnsupportedEmailMarkdown()`.
   - "Send Test Email" modal with a recipient email field to preview inbox rendering.

---

## 6. Cloud Functions & Backend Automation

### 6.1 Centralized Dispatcher (`functions/src/email-dispatcher.ts`)

Extract email generation into a dedicated service module:

```typescript
export interface SendEmailOptions {
  to: string | string[];
  templateKey: keyof EmailTemplates;
  replacements: Record<string, string>;
  replyTo?: string;
}

export async function sendTransactionalEmail(
  db: admin.firestore.Firestore,
  options: SendEmailOptions,
): Promise<string | null> {
  const fromAddress = environment.email?.from;
  if (!fromAddress) {
    logger.info(`[EmailDispatcher] Outbound email disabled (environment.email.from is empty). Skipping.`);
    return null;
  }

  const toList = Array.isArray(options.to) ? options.to : [options.to];
  const validRecipients = toList.map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
  if (validRecipients.length === 0) return null;

  // 1. Fetch customized templates from Firestore, falling back to defaults
  const snap = await db.doc('system/email-templates').get();
  const customTemplates = snap.exists ? (snap.data() as Partial<EmailTemplates>) : {};
  const defaults = initEmailTemplates();

  const subjectTemplate = customTemplates[`${options.templateKey}Subject` as keyof EmailTemplates] ||
                          defaults[`${options.templateKey}Subject` as keyof EmailTemplates] || '';
  const bodyTemplate = customTemplates[`${options.templateKey}Body` as keyof EmailTemplates] ||
                       defaults[`${options.templateKey}Body` as keyof EmailTemplates] || '';

  // 2. Perform token substitution
  const formattedSubject = formatTemplate(subjectTemplate, options.replacements);
  const formattedMarkdown = formatTemplate(bodyTemplate, options.replacements);

  // 3. Render Markdown to Email-safe HTML
  const htmlBody = markdownToHtml(formattedMarkdown);

  // 4. Enqueue into /mail for the Trigger Email extension
  const mailRef = await db.collection('mail').add({
    to: validRecipients,
    from: fromAddress,
    replyTo: options.replyTo || environment.email?.contact || fromAddress,
    message: {
      subject: formattedSubject,
      text: formattedMarkdown,
      html: htmlBody,
    },
    metadata: {
      templateKey: options.templateKey,
      sentAt: new Date().toISOString(),
    },
  });

  logger.info(`[EmailDispatcher] Enqueued ${options.templateKey} email for ${validRecipients.join(', ')} (mailId: ${mailRef.id})`);
  return mailRef.id;
}
```

### 6.2 Scheduled Event Digest Runner (`functions/src/event-digest-scheduler.ts`)

Runs automatically via Cloud Scheduler to compile and fan out digests:

```typescript
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate } from './string-utils';
import { markdownToHtml } from './email-markdown';
import { Member } from './data-model/members';
import { IlcEvent } from './data-model/events';

export const sendWeeklyEventDigest = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'UTC' }, // Every Monday 08:00 UTC
  async () => {
    await processEventDigest('weekly', 'this week');
  }
);

export const sendMonthlyEventDigest = onSchedule(
  { schedule: '0 8 1 * *', timeZone: 'UTC' }, // 1st of every month 08:00 UTC
  async () => {
    await processEventDigest('monthly', 'this month');
  }
);

async function processEventDigest(frequency: 'weekly' | 'monthly', periodLabel: string): Promise<void> {
  const db = admin.firestore();
  const fromAddress = environment.email?.from;
  if (!fromAddress) {
    logger.info(`[EventDigest] Outbound email disabled; skipping ${frequency} digest.`);
    return;
  }

  // 1. Query upcoming listed events starting today or later
  const today = new Date().toISOString().split('T')[0];
  const eventsSnap = await db.collection('events')
    .where('status', '==', 'listed')
    .where('startDate', '>=', today)
    .orderBy('startDate', 'asc')
    .limit(20)
    .get();

  if (eventsSnap.empty) {
    logger.info(`[EventDigest] No upcoming events found; skipping ${frequency} digest.`);
    return;
  }

  const events = eventsSnap.docs.map(d => d.data() as IlcEvent);

  // 2. Query opted-in members
  const membersSnap = await db.collection('members')
    .where('notificationSettings.eventDigestFrequency', '==', frequency)
    .get();

  if (membersSnap.empty) {
    logger.info(`[EventDigest] No members opted into ${frequency} digest.`);
    return;
  }

  // 3. Load templates
  const templateSnap = await db.doc('system/email-templates').get();
  const templates = templateSnap.exists ? (templateSnap.data() as EmailTemplates) : initEmailTemplates();
  const itemTpl = templates.eventDigestItemTemplate || initEmailTemplates().eventDigestItemTemplate;
  const overallSubjectTpl = templates.eventDigestOverallSubject || initEmailTemplates().eventDigestOverallSubject;
  const overallBodyTpl = templates.eventDigestOverallBody || initEmailTemplates().eventDigestOverallBody;

  // 4. Compile the {eventsList} block by formatting each event with the item template
  const compiledEventItems = events.map(evt => {
    return formatTemplate(itemTpl, {
      eventTitle: evt.title || 'Untitled Event',
      eventDates: evt.startDate === evt.endDate ? evt.startDate : `${evt.startDate} - ${evt.endDate}`,
      eventLocation: evt.location || (evt.online ? 'Online' : 'TBD'),
      eventInstructors: (evt.instructorNames || []).join(', ') || 'ILC Instructors',
      eventDetailsUrl: `${environment.links.appBase}/events/${evt.docId || ''}`,
      eventPrice: evt.priceDescription || '',
      attendanceType: evt.inPerson && evt.online ? 'In-Person & Online' : evt.online ? 'Online' : 'In-Person',
      eventSummary: evt.description ? evt.description.slice(0, 160) + '...' : '',
    });
  });

  const eventsListMarkdown = compiledEventItems.join('\n\n---\n\n');

  // 5. Fan out to recipients
  const appBase = environment.links.appBase;
  const batch = db.batch();
  let count = 0;

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    const recipientEmail = (member.emails || [])[0];
    if (!recipientEmail) continue;

    const replacements = {
      name: member.name || 'ILC Member',
      period: periodLabel,
      eventsCount: String(events.length),
      eventsList: eventsListMarkdown,
      calendarUrl: `${appBase}/events`,
      preferencesUrl: `${appBase}/settings?tab=notifications`,
      appBase,
    };

    const subject = formatTemplate(overallSubjectTpl, replacements);
    const bodyMarkdown = formatTemplate(overallBodyTpl, replacements);
    const htmlBody = markdownToHtml(bodyMarkdown);

    const mailRef = db.collection('mail').doc();
    batch.set(mailRef, {
      to: [recipientEmail],
      from: fromAddress,
      replyTo: environment.email?.contact || fromAddress,
      message: {
        subject,
        text: bodyMarkdown,
        html: htmlBody,
      },
      metadata: {
        templateKey: 'eventDigestOverall',
        frequency,
        sentAt: new Date().toISOString(),
      },
    });
    count++;
  }

  await batch.commit();
  logger.info(`[EventDigest] Enqueued ${count} ${frequency} digest emails.`);
}
```

---

## 7. Cloud Project (GCP / Firebase) Actions

To enable transactional email sending and scheduled event digests in your Firebase project, complete the following administrative setup:

### 7.1 Install Firebase "Trigger Email" Extension

Run from the terminal with the active Firebase project:

```bash
# Using active Firebase project
firebase ext:install firebase/firestore-send-email --project=YOUR_FIREBASE_PROJECT_ID
```

When prompted interactively, specify:
- **Email documents collection**: `mail`
- **Default FROM address**: `orders@iliqchuan.com` (or your verified domain address)
- **Default Reply-To address**: `info@iliqchuan.com`
- **SMTP Connection URI**: Choose **Option A** or **Option B** below:

#### Option A: Google Workspace SMTP Relay (No external email service needed)
Use your Google Workspace email with an App Password:
```text
smtps://mailer@iliqchuan.com:YOUR_APP_PASSWORD@smtp-relay.gmail.com:465
```
> **Workspace Console Steps**:
> 1. Go to [Google Admin Console](https://admin.google.com/) -> **Apps** -> **Google Workspace** -> **Gmail** -> **Routing**.
> 2. Enable **SMTP relay service** (allow authenticated senders with TLS).
> 3. Generate an [App Password](https://myaccount.google.com/apppasswords) for the `mailer@iliqchuan.com` user account.

#### Option B: Twilio SendGrid
```text
smtps://apikey:YOUR_SENDGRID_API_KEY@smtp.sendgrid.net:465
```
> **SendGrid Steps**:
> 1. In the SendGrid Console, navigate to **Settings** -> **API Keys**.
> 2. Create a restricted API Key with **Mail Send** -> Full Access.
> 3. Under **Sender Authentication**, verify your domain (`iliqchuan.com`) by adding the generated DNS CNAME records.

### 7.2 Google Cloud Scheduler API Activation (CLI)

Scheduled Cloud Functions (`onSchedule`) require the Cloud Scheduler API. Enable it directly from the terminal via the `gcloud` CLI:

```bash
# Enable the Cloud Scheduler API for your active project
gcloud services enable cloudscheduler.googleapis.com --project=YOUR_FIREBASE_PROJECT_ID
```

*(Note: Ensure your Google Cloud SDK is authenticated with `gcloud auth login` and the project has an App Engine location initialized, which is created automatically when Firestore is first provisioned).*

### 7.3 Configure Cloud Functions Environment

In `functions/src/environment/environment.ts` (and `environment.template.ts`):

```typescript
export const environment: FunctionsEnvironment = {
  // ...
  email: {
    from: 'orders@iliqchuan.com', // Setting this enables outbound sending
    contact: 'info@iliqchuan.com',
  },
  links: {
    appBase: 'https://app.iliqchuan.com',
    instructorSopPath: '/instructors-area/post/instructor-packet',
  },
};
```

### 7.4 Domain DNS Authentication (SPF, DKIM, DMARC)

To prevent emails from landing in spam folders:
1. **SPF Record**: Ensure `v=spf1 include:_spf.google.com ~all` (if using Google Workspace) or `include:sendgrid.net ~all` (if using SendGrid) is in your domain's DNS TXT record.
2. **DKIM**: Add the DKIM TXT / CNAME records provided by Google Workspace or SendGrid.
3. **DMARC**: Add TXT record for `_dmarc.iliqchuan.com` with `v=DMARC1; p=none; rua=mailto:dmarc-reports@iliqchuan.com`.

### 7.5 Firestore Security Rules

Ensure [`firestore.rules`](../../firestore.rules) protects the `/mail` queue and grants admin access to `/system/email-templates`:

```javascript
// System settings & email templates
match /system/{docId} {
  allow read: if isAuthenticated();
  allow write: if isAdmin();
}

// Outbound email queue (Trigger Email extension)
// Client applications must NEVER write directly to /mail.
// Writes are performed exclusively by Cloud Functions via the Firebase Admin SDK.
match /mail/{mailId} {
  allow read, write: if false;
}
```

---

## 8. Post-Implementation Documentation & Reflection

> [!IMPORTANT]
> **Documentation Sequence Rationale**:
> Documentation updates (`README.md`, `SETUP.md`, architecture references) are deliberately scheduled to occur **after all implementation and verification work is completed**.
> This guarantees that the documentation reflects the actual implemented reality, exact CLI invocation outputs, verified environment configuration keys, and non-obvious edge cases discovered during testing, rather than speculative or pre-implementation assumptions.

### 8.1 Updates to `README.md` (Post-Implementation)

Following implementation and verification, update `README.md` to include:
- **Transactional Emails, Digests & Notifications Section**:
  - Architecture overview: purchases, activations, and digests write to Firestore `/mail`.
  - The Firebase "Trigger Email" extension reads `/mail` and dispatches via SMTP.
  - How event digests work: weekly and monthly cron runs evaluate opted-in members and compile the two-tier event digest.
  - How to test locally: in the Firebase Local Emulator, documents in `/mail` can be inspected in the Firestore Emulator UI (`http://localhost:4000/firestore`) without sending real emails.
  - How admins customize templates in the web portal (`/settings?tab=email-templates`).

### 8.2 Updates to `SETUP.md` (Post-Implementation)

Update `SETUP.md` Section 5 ("Setting Up Email Notifications") to include:
- Cloud Scheduler API activation via `gcloud services enable cloudscheduler.googleapis.com`.
- Purchase template setup details, two-tier event digest configuration, test email sending, and placeholder reference tables.
- Verification steps with the Firebase Functions emulator shell (`firebase functions:shell`).

---

## 9. Implementation Phases & Verification Checklist

### Phase 1: Markdown Editor Toolbar Enhancements
- [ ] Extend `EditorChip` interface with `description?: string`.
- [ ] Update `MarkdownEditor` template with the foldable `.toolbar-placeholders-group`, toggle chevron, and chip descriptions.
- [ ] Add SCSS styling matching the ILC design system.
- [ ] Add unit tests in `src/app/markdown-editor/markdown-editor.spec.ts` verifying fold/unfold behavior and insertion with descriptions.

### Phase 2: Domain Data Models & Admin Templates UI
- [ ] Expand `EmailTemplates` interface and `initEmailTemplates()` in `functions/src/data-model/content-cache.ts` and `email-templates.ts` (including `eventDigestOverallSubject`, `eventDigestOverallBody`, and `eventDigestItemTemplate`).
- [ ] Add `eventDigestFrequency` to `MemberNotificationSettings` in `notifications.ts`.
- [ ] Add digest preference selector to `NotificationSettingsComponent` in `src/app/settings/notification-settings/`.
- [ ] Redesign `EmailTemplatesComponent` in `src/app/settings/email-templates/` with categorized tabs (Purchases, Onboarding, and Event Digests with the two-tier editors).
- [ ] Update unit tests in `src/app/settings/email-templates/email-templates.spec.ts`.

### Phase 3: Cloud Functions Dispatcher, Schedulers & Webhook Triggers
- [ ] Implement `sendTransactionalEmail` in `functions/src/email-dispatcher.ts`.
- [ ] Wire purchase confirmation emails into `functions/src/stripe-fulfillment.ts` for Stripe checkouts and renewals.
- [ ] Wire order confirmation emails into `functions/src/squarespace-orders/api.ts` for Squarespace orders.
- [ ] Implement `sendWeeklyEventDigest` and `sendMonthlyEventDigest` scheduled Cloud Functions in `functions/src/event-digest-scheduler.ts`.
- [ ] Add Cloud Function unit tests verifying template loading, 2-tier digest compilation, token substitution, and error isolation.

### Phase 4: Local Verification & Integration Testing
- [ ] Run full emulator test suite: `pnpm test`, `pnpm test:functions`, and `pnpm test:rules`.
- [ ] Verify `pnpm build` and `pnpm build:functions` pass with zero errors.
- [ ] Test purchase confirmation flows and digest generation in the local emulator environment.

### Phase 5: Post-Implementation Documentation & Reflection
- [ ] Review implementation delta, learnings, and any edge cases discovered during testing.
- [ ] Update `README.md` with the new Transactional Emails & Event Digest section.
- [ ] Update `SETUP.md` with the Cloud Scheduler CLI command, SMTP extension setup, and emulator testing workflows.
- [ ] Commit and finalize documentation changes alongside code changes.
