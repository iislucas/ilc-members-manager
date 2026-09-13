import { Component, inject, signal, linkedSignal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownEditor, EditorChip, MarkdownFeature } from '../markdown-editor/markdown-editor';
import { EmailTemplates, initEmailTemplates } from '../../../functions/src/data-model/content-cache';
import { MailQueueDoc, MailSendingStatus } from '../../../functions/src/data-model/mail';
import {
  findUnsupportedEmailMarkdown,
  SUPPORTED_EMAIL_MARKDOWN,
  markdownToHtml,
  formatTemplate,
} from '../../../functions/src/email-markdown';

export type TemplateCategory = 'onboarding' | 'purchases' | 'digest' | 'test' | 'logs';
export type PurchaseSubtype = 'order' | 'event' | 'vod' | 'grading' | 'subscription';

const VALID_CATEGORIES: TemplateCategory[] = ['onboarding', 'purchases', 'digest', 'test', 'logs'];
const VALID_PURCHASE_SUBTYPES: PurchaseSubtype[] = ['order', 'event', 'vod', 'grading', 'subscription'];

@Component({
  selector: 'app-email-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent, MarkdownEditor],
  templateUrl: './email-notifications.component.html',
  styleUrl: './email-notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailNotificationsComponent {
  dataManager = inject(DataManagerService);
  firebaseState = inject(FirebaseStateService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.EmailNotifications];

  // Derive active category from the URL `tab` query param, with fallback to 'onboarding'
  activeCategory = computed<TemplateCategory>(() => {
    const tab = this.viewSignals.urlParams.tab();
    if (tab && VALID_CATEGORIES.includes(tab as TemplateCategory)) {
      return tab as TemplateCategory;
    }
    return 'onboarding';
  });

  // Derive active purchase subtype from URL `subtab` query param, with fallback to 'order'
  activePurchaseSubtype = computed<PurchaseSubtype>(() => {
    const subtab = this.viewSignals.urlParams.subtab();
    if (subtab && VALID_PURCHASE_SUBTYPES.includes(subtab as PurchaseSubtype)) {
      return subtab as PurchaseSubtype;
    }
    return 'order';
  });

  // Placeholder tokens each template supports with human-readable descriptions.
  // Kept in lock-step with backend substitution keys.
  readonly memberChips: EditorChip[] = [
    { token: '{name}', description: "Recipient's full name" },
    { token: '{memberId}', description: 'Official ILC Member ID' },
    { token: '{email}', description: "Recipient's email address" },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly instructorChips: EditorChip[] = [
    { token: '{name}', description: "Recipient's full name" },
    { token: '{memberId}', description: 'Official ILC Member ID' },
    { token: '{instructorId}', description: 'Official Instructor ID' },
    { token: '{email}', description: "Recipient's email address" },
    { token: '{appBase}', description: 'Application base URL' },
    { token: '{instructorSopUrl}', description: 'Link to Instructor SOP' },
  ];

  readonly orderChips: EditorChip[] = [
    { token: '{name}', description: "Customer's full name" },
    { token: '{orderNumber}', description: 'Order or invoice number' },
    { token: '{orderDate}', description: 'Date order was placed' },
    { token: '{amount}', description: 'Total amount paid' },
    { token: '{currency}', description: 'Currency code (e.g. USD)' },
    { token: '{itemsSummary}', description: 'Itemized list of items' },
    { token: '{receiptUrl}', description: 'Link to receipt / invoice' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly eventRegChips: EditorChip[] = [
    { token: '{name}', description: "Attendee's full name" },
    { token: '{eventTitle}', description: 'Workshop or event title' },
    { token: '{eventDates}', description: 'Event dates' },
    { token: '{eventLocation}', description: 'Event venue or Online' },
    { token: '{attendanceType}', description: 'In-Person, Online, or Both' },
    { token: '{onlineJoiningLink}', description: 'Online meeting or Zoom link' },
    { token: '{specialInstructions}', description: 'Instructions from organizer' },
    { token: '{amount}', description: 'Registration fee paid' },
    { token: '{receiptUrl}', description: 'Link to receipt' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly vodChips: EditorChip[] = [
    { token: '{name}', description: "Member's full name" },
    { token: '{videoTitle}', description: 'Title of the Video on Demand' },
    { token: '{videoUrl}', description: 'Direct link to watch video' },
    { token: '{amount}', description: 'Purchase price paid' },
    { token: '{receiptUrl}', description: 'Link to receipt' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly gradingChips: EditorChip[] = [
    { token: '{name}', description: "Student's full name" },
    { token: '{memberId}', description: "Student's Member ID" },
    { token: '{gradingLevel}', description: 'Grading curriculum level' },
    { token: '{gradingEventName}', description: 'Grading event or session name' },
    { token: '{gradingDate}', description: 'Date of grading examination' },
    { token: '{amount}', description: 'Assessment fee paid' },
    { token: '{gradingUrl}', description: 'Grading portal link' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly subscriptionChips: EditorChip[] = [
    { token: '{name}', description: "Subscriber's full name" },
    { token: '{planName}', description: 'Subscription plan name' },
    { token: '{amount}', description: 'Renewal price paid' },
    { token: '{renewalDate}', description: 'Date of current renewal' },
    { token: '{receiptUrl}', description: 'Link to receipt' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly digestOverallChips: EditorChip[] = [
    { token: '{name}', description: "Recipient's full name" },
    { token: '{period}', description: 'Digest period (this week or this month)' },
    { token: '{eventsCount}', description: 'Number of upcoming events' },
    { token: '{eventsList}', description: 'Compiled Markdown list of upcoming events' },
    { token: '{calendarUrl}', description: 'Link to full events calendar' },
    { token: '{preferencesUrl}', description: 'Link to update notification preferences' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly digestItemChips: EditorChip[] = [
    { token: '{eventTitle}', description: 'Workshop or event title' },
    { token: '{eventDetailsUrl}', description: 'Direct link to event page' },
    { token: '{eventDates}', description: 'Formatted event dates' },
    { token: '{eventLocation}', description: 'Event venue or online notation' },
    { token: '{attendanceType}', description: 'In-Person, Online, or Both' },
    { token: '{eventInstructors}', description: 'Names of event instructors' },
    { token: '{eventPrice}', description: 'Event price or free' },
    { token: '{eventSummary}', description: 'Short summary or description' },
    { token: '{appBase}', description: 'Application base URL' },
  ];

  readonly bodyFeatures: MarkdownFeature[] = ['bold', 'link'];
  readonly supportedMarkdown = SUPPORTED_EMAIL_MARKDOWN;

  templates = linkedSignal<EmailTemplates>(() =>
    this.dataManager.emailTemplates() || initEmailTemplates()
  );

  // Markdown validation warnings
  memberBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().membershipActivatedBody || '')
  );
  instructorBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().instructorLicenseActivatedBody || '')
  );
  orderBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().orderConfirmationBody || '')
  );
  eventRegBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().eventRegistrationConfirmationBody || '')
  );
  vodBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().vodPurchaseConfirmationBody || '')
  );
  gradingBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().gradingPaymentConfirmationBody || '')
  );
  subscriptionBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().subscriptionRenewalBody || '')
  );
  digestOverallBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().eventDigestOverallBody || '')
  );
  digestItemTemplateWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().eventDigestItemTemplate || '')
  );

  // Test Email Sender state
  testRecipient = signal<string>('');
  testSubject = signal<string>('[Test] I Liq Chuan Email Verification');
  testBodyMarkdown = signal<string>(
    'Hello **{name}**,\n\nThis is a test verification email from the I Liq Chuan system.\n\nAll systems operational.\n\nBest regards,\n[I Liq Chuan Association]({appBase})',
  );
  isSendingTest = signal(false);
  testResult = signal<{
    success?: boolean;
    simulated?: boolean;
    messageId?: string;
    error?: string;
    docId?: string;
  } | null>(null);

  testBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.testBodyMarkdown())
  );

  testPreviewHtml = computed(() =>
    markdownToHtml(this.testBodyMarkdown())
  );

  isSaving = signal(false);
  statusMessage = signal('');

  // Sample data for the live combined digest preview
  private readonly sampleDigestEvents = [
    {
      eventTitle: 'Zhong Xin Dao Summer Retreat',
      eventDetailsUrl: 'https://app.iliqchuan.com/events/summer-retreat',
      eventDates: 'July 15 - July 20, 2026',
      eventLocation: 'Fishkill, NY, USA',
      attendanceType: 'In-Person & Online',
      eventInstructors: 'Grandmaster Sam F.S. Chin, Master Hsin Chin',
      eventPrice: '$750',
      eventSummary: 'Intensive 5-day retreat focusing on the 21 Form and spinning hands applications.',
    },
    {
      eventTitle: 'European Instructors Workshop & Grading',
      eventDetailsUrl: 'https://app.iliqchuan.com/events/europe-workshop',
      eventDates: 'August 8 - August 10, 2026',
      eventLocation: 'Vienna, Austria',
      attendanceType: 'In-Person',
      eventInstructors: 'Master Joshua Craig',
      eventPrice: '€280',
      eventSummary: 'Specialized seminar for certified instructors and senior students preparing for grading.',
    },
  ];

  // Live combined preview of the two-tier digest
  digestPreviewHtml = computed(() => {
    const tpl = this.templates();
    const overall = tpl.eventDigestOverallBody || '';
    const itemTpl = tpl.eventDigestItemTemplate || '';

    const compiledItems = this.sampleDigestEvents
      .map((evt) => formatTemplate(itemTpl, evt))
      .join('\n\n');

    const appBase = typeof window !== 'undefined' ? window.location.origin : 'https://app.iliqchuan.com';
    const compiledOverall = formatTemplate(overall, {
      name: 'Alex Chen',
      period: 'this month',
      eventsCount: String(this.sampleDigestEvents.length),
      eventsList: compiledItems,
      calendarUrl: `${appBase}/events`,
      preferencesUrl: `${appBase}/settings/notifications`,
      appBase,
    });

    return markdownToHtml(compiledOverall);
  });

  updateSubject(field: keyof EmailTemplates, value: string) {
    this.templates.update((t) => ({ ...t, [field]: value }));
  }

  setMemberBody(markdown: string) {
    this.updateBody('membershipActivatedBody', markdown);
  }

  setInstructorBody(markdown: string) {
    this.updateBody('instructorLicenseActivatedBody', markdown);
  }

  setOrderBody(markdown: string) {
    this.updateBody('orderConfirmationBody', markdown);
  }

  setEventRegBody(markdown: string) {
    this.updateBody('eventRegistrationConfirmationBody', markdown);
  }

  setVodBody(markdown: string) {
    this.updateBody('vodPurchaseConfirmationBody', markdown);
  }

  setGradingBody(markdown: string) {
    this.updateBody('gradingPaymentConfirmationBody', markdown);
  }

  setSubscriptionBody(markdown: string) {
    this.updateBody('subscriptionRenewalBody', markdown);
  }

  setDigestOverallBody(markdown: string) {
    this.updateBody('eventDigestOverallBody', markdown);
  }

  setDigestItemTemplate(markdown: string) {
    this.updateBody('eventDigestItemTemplate', markdown);
  }

  updateBody(field: keyof EmailTemplates, markdown: string) {
    this.templates.update((t) => ({ ...t, [field]: markdown }));
  }

  async setCategory(cat: TemplateCategory) {
    this.viewSignals.urlParams.tab.set(cat);
    if (cat === 'logs') {
      await this.loadMailLogs();
    }
  }

  setPurchaseSubtype(subtype: PurchaseSubtype) {
    this.viewSignals.urlParams.subtab.set(subtype);
  }

  constructor() {
    const userEmail = this.firebaseState.user()?.firebaseUser?.email;
    if (userEmail) {
      this.testRecipient.set(userEmail);
    }
    // If the view initializes directly with tab='logs', load logs immediately
    if (this.viewSignals.urlParams.tab() === 'logs') {
      this.loadMailLogs();
    }
  }

  setTestBody(markdown: string) {
    this.testBodyMarkdown.set(markdown);
  }

  loadTestSample(preset: 'welcome' | 'order' | 'digest' | 'blank') {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.iliqchuan.com';
    const userEmail =
      this.testRecipient() ||
      this.firebaseState.user()?.firebaseUser?.email ||
      'admin@iliqchuan.com';
    const t = this.templates();

    if (preset === 'welcome') {
      this.testSubject.set(t.membershipActivatedSubject || 'Welcome to I Liq Chuan - Official Member Notice');
      const rawBody = t.membershipActivatedBody || '';
      const formatted = formatTemplate(rawBody, {
        name: 'Test Member',
        memberId: 'US123',
        email: userEmail,
        appBase: origin,
      });
      this.testBodyMarkdown.set(
        formatted.includes('Test Member')
          ? formatted
          : `Hello **Test Member**,\n\n${formatted}`,
      );
    } else if (preset === 'order') {
      this.testSubject.set(t.orderConfirmationSubject || 'I Liq Chuan - Order Confirmation #1001');
      const rawBody = t.orderConfirmationBody || '';
      this.testBodyMarkdown.set(
        formatTemplate(rawBody, {
          name: 'Test Customer',
          orderNumber: '1001',
          orderDate: new Date().toLocaleDateString(),
          amount: '$120.00',
          currency: 'USD',
          itemsSummary: '- 1x Annual Membership Renewal ($120.00)',
          receiptUrl: `${origin}/orders/1001`,
          appBase: origin,
        }),
      );
    } else if (preset === 'digest') {
      this.testSubject.set(t.eventDigestOverallSubject || 'Upcoming I Liq Chuan Events');
      const itemTpl = t.eventDigestItemTemplate || '';
      const overallTpl = t.eventDigestOverallBody || '';
      const compiledItems = this.sampleDigestEvents
        .map((evt) => formatTemplate(itemTpl, evt))
        .join('\n\n');
      this.testBodyMarkdown.set(
        formatTemplate(overallTpl, {
          name: 'Test Member',
          period: 'this month',
          eventsCount: String(this.sampleDigestEvents.length),
          eventsList: compiledItems,
          calendarUrl: `${origin}/events`,
          preferencesUrl: `${origin}/settings/notifications`,
          appBase: origin,
        }),
      );
    } else {
      this.testSubject.set('[Test] I Liq Chuan Email Verification');
      this.testBodyMarkdown.set(
        `Hello **Test Member**,\n\nThis is a test verification email from the I Liq Chuan system.\n\nAll systems operational.\n\nBest regards,\n[I Liq Chuan Association](${origin})`,
      );
    }
  }

  async sendTestEmail() {
    const to = this.testRecipient().trim();
    const subject = this.testSubject().trim();
    const bodyMarkdown = this.testBodyMarkdown().trim();

    if (!to || !to.includes('@')) {
      this.testResult.set({ success: false, error: 'Please provide a valid recipient email address.' });
      return;
    }
    if (!subject) {
      this.testResult.set({ success: false, error: 'Please provide an email subject.' });
      return;
    }
    if (!bodyMarkdown) {
      this.testResult.set({ success: false, error: 'Please provide email body text.' });
      return;
    }

    this.isSendingTest.set(true);
    this.testResult.set(null);

    try {
      const res = await this.dataManager.sendAdminTestEmail({ to, subject, bodyMarkdown });
      this.testResult.set({
        success: res.success,
        simulated: res.simulated,
        messageId: res.messageId,
        docId: res.docId,
        error: res.error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.testResult.set({
        success: false,
        error: msg || 'Failed to dispatch test email.',
      });
    } finally {
      this.isSendingTest.set(false);
    }
  }

  async saveTemplates() {
    this.isSaving.set(true);
    this.statusMessage.set('');
    try {
      await this.dataManager.saveEmailTemplates(this.templates());
      this.statusMessage.set('Templates saved successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusMessage.set(`Error: ${msg}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  // --- GLOBAL MAIL SENDING 3-STATE SYSTEM ---
  readonly MailSendingStatus = MailSendingStatus;
  mailStatus = computed<MailSendingStatus>(() => {
    const settings = this.dataManager.mailSettings();
    if (settings.status) {
      return settings.status;
    }
    return settings.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off;
  });
  isMailPaused = computed(() => this.mailStatus() === MailSendingStatus.Paused);
  mailSettingsInfo = computed(() => this.dataManager.mailSettings());
  isUpdatingStatus = signal(false);
  isTogglingPause = this.isUpdatingStatus; // alias for backwards compatibility with any template bindings
  statusActionFeedback = signal<{ success: boolean; message: string } | null>(null);
  pauseActionFeedback = this.statusActionFeedback; // alias for backwards compatibility

  async setMailStatus(target: MailSendingStatus) {
    if (target === this.mailStatus()) return;

    let confirmMsg = '';
    if (target === MailSendingStatus.Off) {
      confirmMsg =
        'Are you sure you want to turn email sending OFF? Automated notifications (purchases, registrations, digests) will NOT be sent and will NOT be queued.';
    } else if (target === MailSendingStatus.Paused) {
      confirmMsg =
        'Are you sure you want to PAUSE email sending? Outbound transactional notifications will be queued as placeholders without sending.';
    } else {
      confirmMsg =
        'Are you sure you want to ACTIVATE email sending? Any queued placeholder emails will be rendered using current templates and dispatched via SMTP.';
    }

    if (!window.confirm(confirmMsg)) return;

    this.isUpdatingStatus.set(true);
    this.statusActionFeedback.set(null);

    try {
      const res = await this.dataManager.setMailSendingState(target);
      if (target === MailSendingStatus.Off) {
        this.statusActionFeedback.set({
          success: true,
          message: 'Mail sending is now OFF. Automated notifications are disabled and will not be queued.',
        });
      } else if (target === MailSendingStatus.Paused) {
        this.statusActionFeedback.set({
          success: true,
          message: 'Mail sending is now PAUSED. Outgoing notifications are being held as placeholders in the queue.',
        });
      } else {
        this.statusActionFeedback.set({
          success: true,
          message: `Mail sending is now ACTIVE. ${res.resumedCount} queued email(s) released for template interpretation and delivery.`,
        });
        await this.loadMailLogs(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusActionFeedback.set({
        success: false,
        message: `Failed to update mail sending state: ${msg}`,
      });
    } finally {
      this.isUpdatingStatus.set(false);
    }
  }

  async toggleMailPause() {
    const nextStatus = this.isMailPaused() ? MailSendingStatus.Active : MailSendingStatus.Paused;
    await this.setMailStatus(nextStatus);
  }

  // --- MAIL QUEUE & LOGS FUNCTIONALITY ---
  mailLogs = signal<MailQueueDoc[]>([]);
  isLoadingLogs = signal<boolean>(false);
  logsFilter = signal<'ALL' | 'SUCCESS' | 'ERROR' | 'PENDING' | 'PROCESSING' | 'PAUSED'>('ALL');
  logsSearch = signal<string>('');
  selectedLog = signal<MailQueueDoc | null>(null);
  isRetryingId = signal<string | null>(null);
  retryFeedback = signal<{ success: boolean; message: string } | null>(null);

  filteredMailLogs = computed(() => {
    const logs = this.mailLogs();
    const filter = this.logsFilter();
    const query = this.logsSearch().trim().toLowerCase();

    return logs.filter((log) => {
      const state = log.status || log.delivery?.state || 'PENDING';
      if (filter === 'SUCCESS' && state !== 'SUCCESS') return false;
      if (filter === 'ERROR' && state !== 'ERROR') return false;
      if (filter === 'PENDING' && state !== 'PENDING' && state !== 'PROCESSING') return false;
      if (filter === 'PROCESSING' && state !== 'PROCESSING') return false;
      if (filter === 'PAUSED' && state !== 'PAUSED') return false;

      if (query) {
        const toStr = Array.isArray(log.to) ? log.to.join(' ') : log.to || '';
        const subject = log.message?.subject || log.subject || '';
        const docId = log.docId || '';
        const templateKey = log.templateKey || '';
        const match =
          toStr.toLowerCase().includes(query) ||
          subject.toLowerCase().includes(query) ||
          docId.toLowerCase().includes(query) ||
          templateKey.toLowerCase().includes(query);
        if (!match) return false;
      }
      return true;
    });
  });

  logCounts = computed(() => {
    const logs = this.mailLogs();
    let success = 0;
    let error = 0;
    let pending = 0;
    let paused = 0;
    for (const log of logs) {
      const state = log.status || log.delivery?.state || 'PENDING';
      if (state === 'SUCCESS') success++;
      else if (state === 'ERROR') error++;
      else if (state === 'PAUSED') paused++;
      else pending++;
    }
    return {
      total: logs.length,
      success,
      error,
      pending,
      paused,
    };
  });

  getTemplateDataEntries(data?: Record<string, string>): Array<{ key: string; value: string }> {
    if (!data) return [];
    return Object.entries(data).map(([key, value]) => ({ key, value }));
  }

  async loadMailLogs(clearFeedback = true) {
    this.isLoadingLogs.set(true);
    if (clearFeedback) {
      this.retryFeedback.set(null);
    }
    try {
      const docs = await this.dataManager.getRecentMailDocs(100);
      this.mailLogs.set(docs);
      if (this.selectedLog()) {
        const updated = docs.find((d) => d.docId === this.selectedLog()?.docId);
        if (updated) {
          this.selectedLog.set(updated);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.retryFeedback.set({ success: false, message: `Failed to load mail logs: ${msg}` });
    } finally {
      this.isLoadingLogs.set(false);
    }
  }

  async retryMail(mailId: string) {
    if (!mailId) return;
    this.isRetryingId.set(mailId);
    this.retryFeedback.set(null);

    try {
      await this.dataManager.retryMailItem(mailId);
      this.retryFeedback.set({
        success: true,
        message: `Email ${mailId} successfully reset to PENDING. Processing courier will re-attempt delivery shortly.`,
      });
      await this.loadMailLogs(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.retryFeedback.set({
        success: false,
        message: `Failed to retry email: ${msg}`,
      });
    } finally {
      this.isRetryingId.set(null);
    }
  }

  selectLog(log: MailQueueDoc | null) {
    this.selectedLog.set(log);
  }

  formatLogTimestamp(val: unknown): string {
    if (!val) return '—';
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().toLocaleString();
    }
    if (typeof val === 'string' || typeof val === 'number') {
      try {
        return new Date(val).toLocaleString();
      } catch {
        return String(val);
      }
    }
    return '—';
  }
}
