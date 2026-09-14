import { Component, inject, signal, linkedSignal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownEditor, EditorChip, MarkdownFeature } from '../markdown-editor/markdown-editor';
import { IconComponent } from '../icons/icon.component';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import { Member } from '../../../functions/src/data-model/members';
import { EmailTemplates, initEmailTemplates } from '../../../functions/src/data-model/content-cache';
import { MailQueueDoc, MailSendingStatus } from '../../../functions/src/data-model/mail';
import {
  findUnsupportedEmailMarkdown,
  SUPPORTED_EMAIL_MARKDOWN,
  markdownToHtml,
  formatTemplate,
} from '../../../functions/src/email-markdown';

export type TemplateCategory = 'settings' | 'test' | 'onboarding' | 'purchases' | 'digest' | 'logs';
export type PurchaseSubtype = 'order' | 'event' | 'vod' | 'grading' | 'subscription';
export type TestEmailType = 'ping' | 'welcome' | 'order' | 'digest';

export const DEFAULT_PING_SUBJECT = '[Test] I Liq Chuan Email Verification';
export const DEFAULT_PING_BODY =
  'Hello **{name}**,\n\nThis is a test verification email from the I Liq Chuan system.\n\nAll systems operational.\n\nBest regards,\n[I Liq Chuan Association]({appBase})';

const VALID_CATEGORIES: TemplateCategory[] = ['settings', 'test', 'onboarding', 'purchases', 'digest', 'logs'];
const VALID_PURCHASE_SUBTYPES: PurchaseSubtype[] = ['order', 'event', 'vod', 'grading', 'subscription'];

@Component({
  selector: 'app-email-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent, MarkdownEditor, IconComponent, MemberSelectorComponent],
  templateUrl: './email-notifications.component.html',
  styleUrl: './email-notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailNotificationsComponent {
  dataManager = inject(DataManagerService);
  firebaseState = inject(FirebaseStateService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.EmailNotifications];

  // Derive active category from the URL `tab` query param, with fallback to 'settings'
  activeCategory = computed<TemplateCategory>(() => {
    const tab = this.viewSignals.urlParams.tab();
    if (tab && VALID_CATEGORIES.includes(tab as TemplateCategory)) {
      return tab as TemplateCategory;
    }
    if (this.viewSignals.urlParams.mailId()) {
      return 'logs';
    }
    return 'settings';
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
  testEmailType = signal<TestEmailType>('ping');
  selectedTestMemberId = signal<string>('');
  selectedTestMember = signal<Member | null>(null);
  testRecipient = signal<string>('');
  testSubject = signal<string>(DEFAULT_PING_SUBJECT);
  testBodyMarkdown = signal<string>(DEFAULT_PING_BODY);
  isSendingTest = signal(false);
  testResult = signal<{
    success?: boolean;
    simulated?: boolean;
    messageId?: string;
    error?: string;
    docId?: string;
  } | null>(null);

  setTestEmailType(type: TestEmailType) {
    this.testEmailType.set(type);
  }

  resetPingTemplate() {
    this.testSubject.set(DEFAULT_PING_SUBJECT);
    this.testBodyMarkdown.set(DEFAULT_PING_BODY);
  }

  testBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.testBodyMarkdown())
  );

  onTestMemberSelected(member: Member | null) {
    this.selectedTestMember.set(member);
    if (member) {
      const email = member.emails?.[0] || member.publicEmail || '';
      if (email) {
        this.testRecipient.set(email);
      }
    }
  }

  onTestMemberIdChange(memberId: string) {
    this.selectedTestMemberId.set(memberId);
    if (!memberId) {
      this.selectedTestMember.set(null);
    } else {
      const member = this.dataManager.getMember(memberId) ?? null;
      if (member) {
        this.onTestMemberSelected(member);
      }
    }
  }

  clearSelectedTestMember() {
    this.selectedTestMemberId.set('');
    this.selectedTestMember.set(null);
  }

  getTestReplacements(): Record<string, string> {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.iliqchuan.com';
    const user = this.firebaseState.user();
    const selMember = this.selectedTestMember();
    const recipientEmail = this.testRecipient().trim() || selMember?.emails?.[0] || selMember?.publicEmail || user?.firebaseUser?.email || 'member@example.com';
    const recipientName = selMember?.name || user?.member?.name || user?.firebaseUser?.displayName || 'Alex Chen';
    const memberId = selMember?.memberId || user?.member?.memberId || 'US402';
    const instructorId = selMember?.instructorId || '101';

    return {
      name: recipientName,
      email: recipientEmail,
      memberId,
      instructorId,
      appBase: origin,
      instructorSopUrl: `${origin}/instructors-area/sop`,
      orderNumber: '1001',
      orderDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      amount: '$120.00',
      currency: 'USD',
      itemsSummary: '- 1x Annual Membership Renewal ($120.00)',
      receiptUrl: `${origin}/orders/1001`,
      eventTitle: 'Zhong Xin Dao Summer Retreat',
      eventDates: 'July 15 - July 20, 2026',
      eventLocation: 'Fishkill, NY, USA',
      attendanceType: 'In-Person & Online',
      onlineJoiningLink: 'https://zoom.us/j/123456789',
      specialInstructions: 'Please arrive 15 minutes prior to the first session.',
      videoTitle: '21 Form Detailed Breakdown',
      videoUrl: `${origin}/videos/v-21-form`,
      gradingLevel: 'Student Level 3',
      gradingEventName: 'Annual International Grading Examination',
      gradingDate: 'October 12, 2026',
      gradingUrl: `${origin}/gradings`,
      planName: 'Annual Instructor Association Membership',
      renewalDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      nextRenewalDate: 'Next billing cycle',
      period: 'this month',
      eventsCount: '2',
      calendarUrl: `${origin}/events`,
      preferencesUrl: `${origin}/settings/notifications`,
    };
  }

  testPreviewTo = computed(() => {
    const to = this.testRecipient().trim();
    const selMember = this.selectedTestMember();
    if (selMember?.name) {
      if (to) {
        return `${selMember.name} <${to}>`;
      }
      return `${selMember.name} (no email set)`;
    }
    return to || '(No recipient specified)';
  });

  testPreviewSubject = computed(() => {
    const type = this.testEmailType();
    let raw = '';
    if (type === 'ping') {
      raw = this.testSubject();
    } else if (type === 'welcome') {
      raw = this.templates().membershipActivatedSubject || 'Welcome to the I Liq Chuan Family!';
    } else if (type === 'order') {
      raw = this.templates().orderConfirmationSubject || 'Your I Liq Chuan Order Confirmation ({orderNumber})';
    } else if (type === 'digest') {
      raw = this.templates().eventDigestOverallSubject || 'Upcoming I Liq Chuan Events - {period}';
    }
    return formatTemplate(raw, this.getTestReplacements());
  });

  testPreviewHtml = computed(() => {
    const type = this.testEmailType();
    const replacements = this.getTestReplacements();
    let raw = '';
    if (type === 'ping') {
      raw = this.testBodyMarkdown();
    } else if (type === 'welcome') {
      raw = this.templates().membershipActivatedBody || '';
    } else if (type === 'order') {
      raw = this.templates().orderConfirmationBody || '';
    } else if (type === 'digest') {
      const itemTpl = this.templates().eventDigestItemTemplate || '';
      const overallTpl = this.templates().eventDigestOverallBody || '';
      const compiledItems = this.sampleDigestEvents
        .map((evt) => formatTemplate(itemTpl, evt))
        .join('\n\n');
      raw = formatTemplate(overallTpl, {
        ...replacements,
        eventsList: compiledItems,
      });
    }
    const formatted = formatTemplate(raw, replacements);
    return markdownToHtml(formatted);
  });

  // Rendered previews for Onboarding templates
  memberWelcomePreviewSubject = computed(() => {
    return formatTemplate(this.templates().membershipActivatedSubject || '', this.getTestReplacements());
  });
  memberWelcomePreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().membershipActivatedBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  instructorWelcomePreviewSubject = computed(() => {
    return formatTemplate(this.templates().instructorLicenseActivatedSubject || '', this.getTestReplacements());
  });
  instructorWelcomePreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().instructorLicenseActivatedBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  // Rendered previews for Purchases templates
  orderPreviewSubject = computed(() => {
    return formatTemplate(this.templates().orderConfirmationSubject || '', this.getTestReplacements());
  });
  orderPreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().orderConfirmationBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  eventRegPreviewSubject = computed(() => {
    return formatTemplate(this.templates().eventRegistrationConfirmationSubject || '', this.getTestReplacements());
  });
  eventRegPreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().eventRegistrationConfirmationBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  vodPreviewSubject = computed(() => {
    return formatTemplate(this.templates().vodPurchaseConfirmationSubject || '', this.getTestReplacements());
  });
  vodPreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().vodPurchaseConfirmationBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  gradingPreviewSubject = computed(() => {
    return formatTemplate(this.templates().gradingPaymentConfirmationSubject || '', this.getTestReplacements());
  });
  gradingPreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().gradingPaymentConfirmationBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  subscriptionPreviewSubject = computed(() => {
    return formatTemplate(this.templates().subscriptionRenewalSubject || '', this.getTestReplacements());
  });
  subscriptionPreviewHtml = computed(() => {
    const formatted = formatTemplate(this.templates().subscriptionRenewalBody || '', this.getTestReplacements());
    return markdownToHtml(formatted);
  });

  digestPreviewSubject = computed(() => {
    return formatTemplate(this.templates().eventDigestOverallSubject || '', this.getTestReplacements());
  });

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
    if (cat !== 'logs' && this.viewSignals.urlParams.mailId()) {
      this.viewSignals.urlParams.mailId.set('');
    }
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
    // If the view initializes directly with tab='logs' or mailId is present, load logs immediately
    if (this.viewSignals.urlParams.tab() === 'logs' || this.viewSignals.urlParams.mailId()) {
      this.loadMailLogs();
    }

    // Two-way synchronization between URL parameter `mailId` and `selectedLog`
    effect(() => {
      const tab = this.viewSignals.urlParams.tab();
      const mailId = this.viewSignals.urlParams.mailId();
      if ((tab === 'logs' || (!tab && mailId)) && mailId) {
        if (this.selectedLog()?.docId === mailId) {
          return;
        }
        const existing = this.mailLogs().find((d) => d.docId === mailId);
        if (existing) {
          this.selectedLog.set(existing);
        } else {
          this.dataManager.getMailDoc(mailId).then((item) => {
            if (item && this.viewSignals.urlParams.mailId() === mailId) {
              this.selectedLog.set(item);
            }
          });
        }
      } else if (tab === 'logs' && !mailId && this.selectedLog()) {
        this.selectedLog.set(null);
      }
    });
  }

  setTestBody(markdown: string) {
    this.testBodyMarkdown.set(markdown);
  }

  loadTestSample(preset: 'welcome' | 'order' | 'digest' | 'blank') {
    if (preset === 'blank') {
      this.setTestEmailType('ping');
      this.resetPingTemplate();
    } else {
      this.setTestEmailType(preset);
    }
  }

  async sendTestEmail() {
    const to = this.testRecipient().trim();
    if (!to || !to.includes('@')) {
      this.testResult.set({ success: false, error: 'Please provide a valid recipient email address.' });
      return;
    }

    const type = this.testEmailType();
    let rawSubject = '';
    let rawBodyMarkdown = '';

    if (type === 'ping') {
      rawSubject = this.testSubject().trim();
      rawBodyMarkdown = this.testBodyMarkdown().trim();
      if (!rawSubject) {
        this.testResult.set({ success: false, error: 'Please provide an email subject.' });
        return;
      }
      if (!rawBodyMarkdown) {
        this.testResult.set({ success: false, error: 'Please provide email body text.' });
        return;
      }
    } else if (type === 'welcome') {
      rawSubject = this.templates().membershipActivatedSubject || 'Welcome to the I Liq Chuan Family!';
      rawBodyMarkdown = this.templates().membershipActivatedBody || '';
    } else if (type === 'order') {
      rawSubject = this.templates().orderConfirmationSubject || 'Your I Liq Chuan Order Confirmation ({orderNumber})';
      rawBodyMarkdown = this.templates().orderConfirmationBody || '';
    } else if (type === 'digest') {
      rawSubject = this.templates().eventDigestOverallSubject || 'Upcoming I Liq Chuan Events - {period}';
      const itemTpl = this.templates().eventDigestItemTemplate || '';
      const overallTpl = this.templates().eventDigestOverallBody || '';
      const compiledItems = this.sampleDigestEvents
        .map((evt) => formatTemplate(itemTpl, evt))
        .join('\n\n');
      rawBodyMarkdown = formatTemplate(overallTpl, {
        eventsList: compiledItems,
      });
    }

    const replacements = this.getTestReplacements();
    const subject = formatTemplate(rawSubject, replacements);
    const bodyMarkdown = formatTemplate(rawBodyMarkdown, replacements);

    this.isSendingTest.set(true);
    this.testResult.set(null);

    try {
      const res = await this.dataManager.sendAdminTestEmail({
        to,
        subject,
        bodyMarkdown,
        name: replacements['name'],
        replacements,
      });
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

  async retryMail(mailId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
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
    this.viewSignals.urlParams.mailId.set(log?.docId || '');
  }

  copiedLogUrl = signal<boolean>(false);
  copiedDocId = signal<boolean>(false);

  formatLogTo(to: string | string[] | undefined): string {
    if (!to) return '(No recipient)';
    if (Array.isArray(to)) return to.join(', ');
    return to;
  }

  async copyLogUrl(mailId?: string) {
    if (!mailId) return;
    try {
      const url = `${window.location.origin}${window.location.pathname}?tab=logs&mailId=${encodeURIComponent(mailId)}`;
      await navigator.clipboard.writeText(url);
      this.copiedLogUrl.set(true);
      setTimeout(() => this.copiedLogUrl.set(false), 2500);
    } catch (err) {
      console.error('Failed to copy mail URL', err);
    }
  }

  async copyDocId(docId?: string) {
    if (!docId) return;
    try {
      await navigator.clipboard.writeText(docId);
      this.copiedDocId.set(true);
      setTimeout(() => this.copiedDocId.set(false), 2000);
    } catch (err) {
      console.error('Failed to copy doc ID', err);
    }
  }

  // --- MULTI-SELECT & BATCH DELETION ---
  selectedMailIds = signal<Set<string>>(new Set());
  isDeleting = signal<boolean>(false);
  deleteActionFeedback = signal<{ success: boolean; message: string } | null>(null);

  isAllSelected = computed(() => {
    const logs = this.filteredMailLogs().map((l) => l.docId).filter((id): id is string => Boolean(id));
    if (logs.length === 0) return false;
    const selected = this.selectedMailIds();
    return logs.every((id) => selected.has(id));
  });

  isSomeSelected = computed(() => {
    const logs = this.filteredMailLogs().map((l) => l.docId).filter((id): id is string => Boolean(id));
    if (logs.length === 0) return false;
    const selected = this.selectedMailIds();
    const count = logs.filter((id) => selected.has(id)).length;
    return count > 0 && count < logs.length;
  });

  isSelected(mailId?: string): boolean {
    return mailId ? this.selectedMailIds().has(mailId) : false;
  }

  toggleSelect(mailId?: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    if (!mailId) return;
    this.selectedMailIds.update((set) => {
      const next = new Set(set);
      if (next.has(mailId)) {
        next.delete(mailId);
      } else {
        next.add(mailId);
      }
      return next;
    });
  }

  toggleSelectAll() {
    const logs = this.filteredMailLogs().map((l) => l.docId).filter((id): id is string => Boolean(id));
    if (logs.length === 0) return;

    const allSelected = this.isAllSelected();
    this.selectedMailIds.update((set) => {
      const next = new Set(set);
      if (allSelected) {
        for (const id of logs) {
          next.delete(id);
        }
      } else {
        for (const id of logs) {
          next.add(id);
        }
      }
      return next;
    });
  }

  clearSelection() {
    this.selectedMailIds.set(new Set());
  }

  async deleteSelectedMail() {
    const ids = Array.from(this.selectedMailIds());
    if (ids.length === 0) return;

    const confirmMsg = `Are you sure you want to delete ${ids.length} selected email queue item(s)? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    this.isDeleting.set(true);
    this.deleteActionFeedback.set(null);

    try {
      const res = await this.dataManager.deleteMailItems(ids);
      let message = `Successfully deleted ${res.deletedCount} email item(s).`;
      if (res.skippedCount > 0) {
        message += ` (${res.skippedCount} item(s) in PROCESSING state were skipped for safety).`;
      }
      this.deleteActionFeedback.set({ success: true, message });

      if (this.selectedLog() && ids.includes(this.selectedLog()!.docId!)) {
        this.selectedLog.set(null);
        this.viewSignals.urlParams.mailId.set('');
      }
      this.clearSelection();
      await this.loadMailLogs(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deleteActionFeedback.set({ success: false, message: `Failed to delete mail items: ${msg}` });
    } finally {
      this.isDeleting.set(false);
    }
  }

  async deleteSingleMail(mailId?: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    if (!mailId) return;

    const confirmMsg = `Are you sure you want to delete email "${mailId}" from the queue?`;
    if (!window.confirm(confirmMsg)) return;

    this.isDeleting.set(true);
    this.deleteActionFeedback.set(null);

    try {
      const res = await this.dataManager.deleteMailItems([mailId]);
      if (res.skippedCount > 0) {
        this.deleteActionFeedback.set({
          success: false,
          message: `Cannot delete mail "${mailId}": currently being processed by the delivery courier.`,
        });
      } else {
        this.deleteActionFeedback.set({
          success: true,
          message: `Email "${mailId}" deleted successfully.`,
        });
        if (this.selectedLog()?.docId === mailId) {
          this.selectedLog.set(null);
          this.viewSignals.urlParams.mailId.set('');
        }
        this.selectedMailIds.update((set) => {
          const next = new Set(set);
          next.delete(mailId);
          return next;
        });
        await this.loadMailLogs(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deleteActionFeedback.set({ success: false, message: `Failed to delete email: ${msg}` });
    } finally {
      this.isDeleting.set(false);
    }
  }

  // --- MAIL EDITING MODAL STATE & ACTIONS ---
  editingMail = signal<MailQueueDoc | null>(null);
  editTo = signal<string>('');
  editSubject = signal<string>('');
  editText = signal<string>('');
  editStatus = signal<'PENDING' | 'PAUSED' | 'ERROR'>('PENDING');
  editTemplateDataEntries = signal<Array<{ key: string; value: string }>>([]);
  isSavingEdit = signal<boolean>(false);
  editFeedback = signal<{ success: boolean; message: string } | null>(null);

  editPreviewHtml = computed(() => {
    const text = this.editText();
    const templateData: Record<string, string> = {};
    for (const entry of this.editTemplateDataEntries()) {
      const k = entry.key.trim();
      if (k) {
        templateData[k] = entry.value;
      }
    }
    const formatted = formatTemplate(text, { ...this.getTestReplacements(), ...templateData });
    return markdownToHtml(formatted);
  });

  clearSelectedLog() {
    this.selectedLog.set(null);
    this.viewSignals.urlParams.mailId.set('');
  }

  openEditMail(mail: MailQueueDoc, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.editingMail.set(mail);
    this.editTo.set(Array.isArray(mail.to) ? mail.to.join(', ') : mail.to || '');
    this.editSubject.set(mail.message?.subject || mail.subject || '');
    this.editText.set(mail.message?.text || mail.text || '');

    const curState = mail.status || mail.delivery?.state || 'PENDING';
    if (curState === 'PAUSED') {
      this.editStatus.set('PAUSED');
    } else if (curState === 'ERROR') {
      this.editStatus.set('ERROR');
    } else {
      this.editStatus.set('PENDING');
    }

    if (mail.templateData) {
      this.editTemplateDataEntries.set(
        Object.entries(mail.templateData).map(([key, value]) => ({ key, value })),
      );
    } else {
      this.editTemplateDataEntries.set([]);
    }
    this.editFeedback.set(null);
  }

  closeEditMail() {
    this.editingMail.set(null);
    this.editFeedback.set(null);
  }

  addTemplateDataEntry() {
    this.editTemplateDataEntries.update((entries) => [...entries, { key: '', value: '' }]);
  }

  removeTemplateDataEntry(index: number) {
    this.editTemplateDataEntries.update((entries) => entries.filter((_, i) => i !== index));
  }

  async saveEditedMail() {
    const mail = this.editingMail();
    if (!mail || !mail.docId) return;

    const to = this.editTo().trim();
    if (!to) {
      this.editFeedback.set({ success: false, message: 'Recipient (To) email is required.' });
      return;
    }

    this.isSavingEdit.set(true);
    this.editFeedback.set(null);

    let templateData: Record<string, string> | undefined = undefined;
    if (mail.templateKey || this.editTemplateDataEntries().length > 0) {
      templateData = {};
      for (const entry of this.editTemplateDataEntries()) {
        const k = entry.key.trim();
        if (k) {
          templateData[k] = entry.value;
        }
      }
    }

    try {
      await this.dataManager.updateMailItem({
        mailId: mail.docId,
        to,
        subject: this.editSubject().trim(),
        text: this.editText(),
        status: this.editStatus(),
        templateData,
      });

      this.closeEditMail();
      this.deleteActionFeedback.set({
        success: true,
        message: `Email "${mail.docId}" updated successfully.`,
      });
      await this.loadMailLogs(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.editFeedback.set({ success: false, message: `Failed to update email: ${msg}` });
    } finally {
      this.isSavingEdit.set(false);
    }
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

