import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailNotificationsComponent } from './email-notifications.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { signal } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { SearchableSet } from '../searchable-set';
import { Member } from '../../../functions/src/data-model/members';
import { initEmailTemplates } from '../../../functions/src/data-model/content-cache';
import { initMailSettings, MailSendingStatus } from '../../../functions/src/data-model/mail';

describe('EmailNotificationsComponent', () => {
  let component: EmailNotificationsComponent;
  let fixture: ComponentFixture<EmailNotificationsComponent>;
  let mockDataManager: any;
  let mockFirebaseState: any;
  let mockRoutingService: any;
  let tabSignal: any;
  let subtabSignal: any;
  let mailIdSignal: any;
  let mockTestMember: Member;

  beforeEach(async () => {
    tabSignal = signal('onboarding');
    subtabSignal = signal('order');
    mailIdSignal = signal('');

    mockRoutingService = {
      signals: {
        [Views.EmailNotifications]: {
          urlParams: {
            tab: tabSignal,
            subtab: subtabSignal,
            mailId: mailIdSignal,
          },
        },
      },
      navigateTo: vi.fn(),
    };

    mockTestMember = {
      docId: 'doc_101',
      memberId: 'US101',
      name: 'Master Sam Chin',
      instructorId: '101',
      emails: ['samchin@iliqchuan.com'],
      publicEmail: 'samchin@iliqchuan.com',
      isAdmin: false,
      lastUpdated: '2026-01-01',
      primaryInstructorId: '',
      primarySchoolId: '',
      primarySchoolDocId: '',
      membershipType: '' as any,
      firstMembershipStarted: '',
      lastRenewalDate: '',
      currentMembershipExpires: '',
      membershipNextAutoRenewDate: '',
      membershipSubscriptionId: '',
      address: '',
      city: '',
      zipCode: '',
      countyOrState: '',
      country: '',
      phone: '',
      gender: '',
      dateOfBirth: '',
      publicPhone: '',
      publicRegionOrCity: '',
      publicCountyOrState: '',
      instructorWebsite: '',
      publicClassGoogleCalendarId: '',
      publicProfileImageUrl: '',
      publicProfileImageThumbUrl: '',
      publicCoverImageUrl: '',
      publicBioMarkdown: '',
      studentLevel: '' as any,
      applicationLevel: '' as any,
      mastersLevels: [],
    };

    const membersSet = new SearchableSet<'docId', Member>(['name', 'memberId', 'instructorId'], 'docId');
    membersSet.setEntries([mockTestMember]);

    mockDataManager = {
      members: membersSet,
      getMember: vi.fn((id: string) => (id === 'US101' || id === 'doc_101' ? mockTestMember : undefined)),
      getMemberByMemberId: vi.fn((id: string) => (id === 'US101' ? mockTestMember : undefined)),
      emailTemplates: signal(initEmailTemplates()),
      mailSettings: signal(initMailSettings()),
      saveEmailTemplates: vi.fn().mockResolvedValue({}),
      setMailSendingState: vi.fn().mockResolvedValue({ success: true, status: MailSendingStatus.Paused, resumedCount: 0 }),
      setMailSendingPaused: vi.fn().mockResolvedValue({ success: true, paused: true, resumedCount: 0 }),
      sendAdminTestEmail: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'msg_test_123',
        docId: 'mail_doc_456',
      }),
      getRecentMailDocs: vi.fn().mockResolvedValue([
        {
          docId: 'mail_1',
          to: ['student@example.com'],
          status: 'SUCCESS',
          delivery: { state: 'SUCCESS', info: { messageId: 'msg_1' } },
          message: { subject: 'Welcome Student', html: '<p>Welcome!</p>' },
          createdAt: new Date().toISOString(),
        },
        {
          docId: 'mail_2',
          to: ['fail@example.com'],
          status: 'ERROR',
          delivery: { state: 'ERROR', error: 'SMTP Timeout' },
          message: { subject: 'Order Confirmation' },
          createdAt: new Date().toISOString(),
        },
        {
          docId: 'mail_3',
          to: ['paused@example.com'],
          status: 'PAUSED',
          templateKey: 'orderConfirmation',
          templateData: { name: 'Paused User', orderNumber: 'ORD-999' },
          delivery: { state: 'PAUSED' },
          message: { subject: '[Queued / Paused] Template: orderConfirmation' },
          createdAt: new Date().toISOString(),
        },
      ]),
      getMailDoc: vi.fn().mockImplementation(async (id: string) => {
        const list = [
          {
            docId: 'mail_1',
            to: ['student@example.com'],
            status: 'SUCCESS',
            delivery: { state: 'SUCCESS', info: { messageId: 'msg_1' } },
            message: { subject: 'Welcome Student', html: '<p>Welcome!</p>' },
            createdAt: new Date().toISOString(),
          },
          {
            docId: 'mail_2',
            to: ['fail@example.com'],
            status: 'ERROR',
            delivery: { state: 'ERROR', error: 'SMTP Timeout' },
            message: { subject: 'Order Confirmation' },
            createdAt: new Date().toISOString(),
          },
          {
            docId: 'mail_3',
            to: ['paused@example.com'],
            status: 'PAUSED',
            templateKey: 'orderConfirmation',
            templateData: { name: 'Paused User', orderNumber: 'ORD-999' },
            delivery: { state: 'PAUSED' },
            message: { subject: '[Queued / Paused] Template: orderConfirmation' },
            createdAt: new Date().toISOString(),
          },
        ];
        return list.find((d) => d.docId === id) || null;
      }),
      retryMailItem: vi.fn().mockResolvedValue({ success: true, docId: 'mail_2' }),
      deleteMailItems: vi.fn().mockResolvedValue({
        success: true,
        deletedCount: 1,
        skippedCount: 0,
        skippedProcessingIds: [],
      }),
      updateMailItem: vi.fn().mockResolvedValue({
        success: true,
        docId: 'mail_2',
      }),
    };

    mockFirebaseState = {
      user: signal({
        firebaseUser: { email: 'admin@iliqchuan.com' },
        isAdmin: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [EmailNotificationsComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailNotificationsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display the subjects of onboarding templates by default', () => {
    const el = fixture.nativeElement;
    const inputs = el.querySelectorAll('input');

    expect(inputs[0].value).toBe('Welcome to the I Liq Chuan Family!');
    expect(inputs[1].value).toBe('Congratulations on your Instructor License!');
  });

  it('renders pill tabs in the requested order with shortened names', () => {
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.header-extension-tabs .pill-tab')) as HTMLElement[];
    expect(tabs.length).toBe(6);
    expect(tabs.map(t => t.textContent?.trim())).toEqual([
      'Settings',
      'Test',
      'Onboarding',
      'Purchases',
      'Event Digests',
      'Logs & Queue',
    ]);
  });

  it('defaults activeCategory to settings when urlParams.tab is empty', () => {
    tabSignal.set('');
    expect(component.activeCategory()).toBe('settings');
  });

  it('renders status controls and explanations when on settings tab', async () => {
    await component.setCategory('settings');
    fixture.detectChanges();
    await fixture.whenStable();

    const statusBanner = fixture.nativeElement.querySelector('.settings-banner');
    expect(statusBanner).toBeTruthy();
    expect(statusBanner.textContent).toContain('Current Status: OFF');

    const toggleButtons = Array.from(fixture.nativeElement.querySelectorAll('.settings-banner .status-btn')) as HTMLElement[];
    expect(toggleButtons.map(b => b.textContent?.trim())).toEqual(['Off', 'Pause', 'Turn On']);
  });

  it('should update activeCategory when urlParams.tab changes', async () => {
    tabSignal.set('purchases');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.activeCategory()).toBe('purchases');
    const subPills = fixture.nativeElement.querySelectorAll('.purchase-sub-tabs .pill-tab');
    expect(subPills.length).toBe(5);

    const subSelect = fixture.nativeElement.querySelector('.purchase-sub-select') as HTMLSelectElement;
    expect(subSelect).toBeTruthy();
    expect(subSelect.options.length).toBe(5);
  });

  it('should update activePurchaseSubtype when setPurchaseSubtype is called', () => {
    component.setPurchaseSubtype('vod');
    expect(subtabSignal()).toBe('vod');
    expect(component.activePurchaseSubtype()).toBe('vod');
  });

  it('should feed each template body into a markdown editor', () => {
    const el = fixture.nativeElement;
    const editors = el.querySelectorAll('app-markdown-editor');
    expect(editors.length).toBe(2);
    expect(component.templates().membershipActivatedBody).toContain(
      'Welcome to the I Liq Chuan family!',
    );
    expect(component.templates().instructorLicenseActivatedBody).toContain(
      'Congratulations on getting your Instructor ID',
    );
  });

  it('should update the body model when the editor emits a change', () => {
    component.setMemberBody('New **welcome** body with {name}.');
    expect(component.templates().membershipActivatedBody).toBe(
      'New **welcome** body with {name}.',
    );
    expect(component.templates().membershipActivatedSubject).toBe(
      'Welcome to the I Liq Chuan Family!',
    );
  });

  it('should persist templates when saveTemplates is called', async () => {
    component.setMemberBody('Saved body.');
    await component.saveTemplates();

    expect(mockDataManager.saveEmailTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipActivatedBody: 'Saved body.',
      }),
    );
    expect(component.statusMessage()).toBe('Templates saved successfully.');
  });

  it('should dispatch test email when sendTestEmail is called', async () => {
    await component.setCategory('test');
    component.testRecipient.set('tester@example.com');
    component.testSubject.set('Test Email');
    component.setTestBody('Hello world');
    fixture.detectChanges();

    await component.sendTestEmail();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDataManager.sendAdminTestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tester@example.com',
        subject: 'Test Email',
        bodyMarkdown: 'Hello world',
      }),
    );

    const successBox = fixture.nativeElement.querySelector('.success-box');
    expect(successBox).toBeTruthy();
    expect(successBox.textContent).toContain('Email Dispatched Successfully!');
    expect(successBox.textContent).toContain('msg_test_123');
  });

  it('should handle test email failure gracefully', async () => {
    mockDataManager.sendAdminTestEmail.mockRejectedValueOnce(
      new Error('SMTP authentication failed: Invalid credentials'),
    );

    await component.setCategory('test');
    component.testRecipient.set('test@example.com');
    fixture.detectChanges();

    await component.sendTestEmail();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.testResult()?.success).toBe(false);
    expect(component.testResult()?.error).toContain('Invalid credentials');

    const errorBox = fixture.nativeElement.querySelector('.status-msg.error');
    expect(errorBox).toBeTruthy();
    expect(errorBox.textContent).toContain('Invalid credentials');
  });

  it('should switch to logs category, load logs, and display summary stats including paused', async () => {
    await component.setCategory('logs');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDataManager.getRecentMailDocs).toHaveBeenCalled();
    expect(component.mailLogs().length).toBe(3);
    expect(component.logCounts().total).toBe(3);
    expect(component.logCounts().success).toBe(1);
    expect(component.logCounts().error).toBe(1);
    expect(component.logCounts().paused).toBe(1);

    const rows = fixture.nativeElement.querySelectorAll('.table-row');
    expect(rows.length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('student@example.com');
    expect(fixture.nativeElement.textContent).toContain('fail@example.com');
    expect(fixture.nativeElement.textContent).toContain('paused@example.com');
  });

  it('should filter logs by status including PAUSED and search query', async () => {
    await component.setCategory('logs');
    await component.loadMailLogs();
    fixture.detectChanges();

    component.logsFilter.set('ERROR');
    expect(component.filteredMailLogs().length).toBe(1);
    expect(component.filteredMailLogs()[0].docId).toBe('mail_2');

    component.logsFilter.set('PAUSED');
    expect(component.filteredMailLogs().length).toBe(1);
    expect(component.filteredMailLogs()[0].docId).toBe('mail_3');

    component.logsFilter.set('ALL');
    component.logsSearch.set('student');
    expect(component.filteredMailLogs().length).toBe(1);
    expect(component.filteredMailLogs()[0].docId).toBe('mail_1');
  });

  it('should call retryMailItem when retrying a failed email', async () => {
    await component.setCategory('logs');
    await component.loadMailLogs();
    fixture.detectChanges();

    await component.retryMail('mail_2');
    expect(mockDataManager.retryMailItem).toHaveBeenCalledWith('mail_2');
    expect(component.retryFeedback()?.success).toBe(true);
  });

  it('should manage 3-way mail sending status (Off, Paused, Active)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await component.setCategory('settings');
    fixture.detectChanges();
    await fixture.whenStable();

    // 1. Initial state: OFF
    expect(component.mailStatus()).toBe(MailSendingStatus.Off);
    expect(fixture.nativeElement.querySelector('.banner-off')).toBeTruthy();

    // 2. Transition to PAUSED
    await component.setMailStatus(MailSendingStatus.Paused);
    expect(mockDataManager.setMailSendingState).toHaveBeenCalledWith(MailSendingStatus.Paused);
    expect(component.statusActionFeedback()?.success).toBe(true);

    // Simulate settings update to PAUSED
    mockDataManager.mailSettings.set({ status: MailSendingStatus.Paused, sendingPaused: true });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.mailStatus()).toBe(MailSendingStatus.Paused);
    expect(fixture.nativeElement.querySelector('.banner-paused')).toBeTruthy();

    // 3. Transition to ACTIVE
    mockDataManager.setMailSendingState.mockResolvedValueOnce({
      success: true,
      status: MailSendingStatus.Active,
      resumedCount: 2,
    });
    await component.setMailStatus(MailSendingStatus.Active);
    expect(mockDataManager.setMailSendingState).toHaveBeenCalledWith(MailSendingStatus.Active);
    expect(component.statusActionFeedback()?.message).toContain('2 queued email(s) released');

    // Simulate settings update to ACTIVE
    mockDataManager.mailSettings.set({ status: MailSendingStatus.Active, sendingPaused: false });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.mailStatus()).toBe(MailSendingStatus.Active);
    expect(fixture.nativeElement.querySelector('.banner-active')).toBeTruthy();

    // 4. Transition back to OFF
    await component.setMailStatus(MailSendingStatus.Off);
    expect(mockDataManager.setMailSendingState).toHaveBeenCalledWith(MailSendingStatus.Off);
  });

  it('should extract templateData entries in getTemplateDataEntries', () => {
    const entries = component.getTemplateDataEntries({
      name: 'Bob',
      orderNumber: '1001',
    });
    expect(entries).toEqual([
      { key: 'name', value: 'Bob' },
      { key: 'orderNumber', value: '1001' },
    ]);
  });

  describe('Mail Selection & Batch Delete', () => {
    beforeEach(async () => {
      await component.setCategory('logs');
      await component.loadMailLogs();
      fixture.detectChanges();
    });

    it('toggles selection of individual and all emails', () => {
      expect(component.selectedMailIds().size).toBe(0);
      expect(component.isSelected('mail_1')).toBe(false);

      // Select individual
      component.toggleSelect('mail_1');
      expect(component.isSelected('mail_1')).toBe(true);
      expect(component.selectedMailIds().size).toBe(1);
      expect(component.isSomeSelected()).toBe(true);
      expect(component.isAllSelected()).toBe(false);

      // Deselect individual
      component.toggleSelect('mail_1');
      expect(component.isSelected('mail_1')).toBe(false);
      expect(component.selectedMailIds().size).toBe(0);

      // Select all
      component.toggleSelectAll();
      expect(component.selectedMailIds().size).toBe(3);
      expect(component.isAllSelected()).toBe(true);

      // Deselect all
      component.toggleSelectAll();
      expect(component.selectedMailIds().size).toBe(0);
      expect(component.isAllSelected()).toBe(false);

      // Clear selection
      component.toggleSelect('mail_2');
      expect(component.selectedMailIds().size).toBe(1);
      component.clearSelection();
      expect(component.selectedMailIds().size).toBe(0);
    });

    it('batch deletes selected emails with user confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      component.toggleSelect('mail_1');
      component.toggleSelect('mail_2');
      expect(component.selectedMailIds().size).toBe(2);

      mockDataManager.deleteMailItems.mockResolvedValueOnce({
        success: true,
        deletedCount: 2,
        skippedCount: 0,
        skippedProcessingIds: [],
      });

      await component.deleteSelectedMail();

      expect(mockDataManager.deleteMailItems).toHaveBeenCalledWith(['mail_1', 'mail_2']);
      expect(component.selectedMailIds().size).toBe(0);
      expect(component.deleteActionFeedback()?.success).toBe(true);
      expect(component.deleteActionFeedback()?.message).toContain('Successfully deleted 2 email item(s)');
      expect(mockDataManager.getRecentMailDocs).toHaveBeenCalled();
    });

    it('cancels batch delete when user declines confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      component.toggleSelect('mail_1');
      await component.deleteSelectedMail();

      expect(mockDataManager.deleteMailItems).not.toHaveBeenCalled();
      expect(component.selectedMailIds().size).toBe(1);
    });

    it('deletes a single email from row action', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      await component.deleteSingleMail('mail_2');

      expect(mockDataManager.deleteMailItems).toHaveBeenCalledWith(['mail_2']);
      expect(component.deleteActionFeedback()?.success).toBe(true);
      expect(component.deleteActionFeedback()?.message).toContain('Email "mail_2" deleted successfully');
    });
  });

  describe('Mail Editing Modal', () => {
    beforeEach(async () => {
      await component.setCategory('logs');
      await component.loadMailLogs();
      fixture.detectChanges();
    });

    it('opens and closes edit modal with populated form state', () => {
      const mailItem = component.mailLogs()[1]; // mail_2
      component.openEditMail(mailItem);

      expect(component.editingMail()).toBe(mailItem);
      expect(component.editTo()).toBe('fail@example.com');
      expect(component.editSubject()).toBe('Order Confirmation');
      expect(component.editStatus()).toBe('ERROR');

      component.closeEditMail();
      expect(component.editingMail()).toBeNull();
    });

    it('handles adding and removing template parameter entries', () => {
      const mailItem = component.mailLogs()[2]; // mail_3 with templateData
      component.openEditMail(mailItem);

      expect(component.editTemplateDataEntries().length).toBe(2);

      component.addTemplateDataEntry();
      expect(component.editTemplateDataEntries().length).toBe(3);

      component.removeTemplateDataEntry(2);
      expect(component.editTemplateDataEntries().length).toBe(2);
    });

    it('validates recipient and saves edited mail via updateMailItem', async () => {
      const mailItem = component.mailLogs()[1]; // mail_2
      component.openEditMail(mailItem);

      // Try empty recipient
      component.editTo.set('   ');
      await component.saveEditedMail();
      expect(component.editFeedback()?.message).toContain('Recipient (To) email is required');
      expect(mockDataManager.updateMailItem).not.toHaveBeenCalled();

      // Provide valid updates
      component.editTo.set('fixed@example.com');
      component.editSubject.set('Updated Subject');
      component.editText.set('Updated **Body**');
      component.editStatus.set('PENDING');

      await component.saveEditedMail();

      expect(mockDataManager.updateMailItem).toHaveBeenCalledWith(
        expect.objectContaining({
          mailId: 'mail_2',
          to: 'fixed@example.com',
          subject: 'Updated Subject',
          text: 'Updated **Body**',
          status: 'PENDING',
        }),
      );
      expect(component.editingMail()).toBeNull();
      expect(component.deleteActionFeedback()?.success).toBe(true);
      expect(component.deleteActionFeedback()?.message).toContain('Email "mail_2" updated successfully');
    });
  });

  describe('Single Email Detail View Navigation', () => {
    beforeEach(async () => {
      await component.setCategory('logs');
      await component.loadMailLogs();
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('swaps list view for single email detail view upon selection, and returns on Back to Logs', async () => {
      // Initially, list view is shown and detail view is hidden
      expect(component.selectedLog()).toBeNull();
      expect(fixture.nativeElement.querySelector('.logs-table')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.log-detail-view')).toBeFalsy();

      // Select an email
      const target = component.mailLogs()[0]; // mail_1
      component.selectLog(target);
      fixture.detectChanges();
      await fixture.whenStable();

      // List should disappear, detail view should appear
      expect(component.selectedLog()).toBe(target);
      expect(mailIdSignal()).toBe('mail_1');
      expect(fixture.nativeElement.querySelector('.logs-table')).toBeFalsy();
      expect(fixture.nativeElement.querySelector('.logs-header-bar')).toBeFalsy();
      const detailView = fixture.nativeElement.querySelector('.log-detail-view');
      expect(detailView).toBeTruthy();
      expect(detailView.textContent).toContain('Document ID: mail_1');
      expect(detailView.textContent).toContain('student@example.com');
      expect(detailView.textContent).toContain('Back to Logs');

      // Check rendered email display contains To line and Subject
      const previewBox = detailView.querySelector('.log-email-preview');
      expect(previewBox).toBeTruthy();
      expect(previewBox.textContent).toContain('student@example.com');
      expect(previewBox.textContent).toContain('Welcome Student');
      expect(previewBox.querySelector('.preview-body')?.innerHTML).toContain('Welcome!');

      // Check Copy Link button
      const copyBtn = detailView.querySelector('.copy-link-btn') as HTMLButtonElement;
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.textContent).toContain('Copy Link');

      // Click "Back to Logs"
      component.clearSelectedLog();
      fixture.detectChanges();
      await fixture.whenStable();

      // List should reappear, detail view should be gone, mailId reset
      expect(component.selectedLog()).toBeNull();
      expect(mailIdSignal()).toBe('');
      expect(fixture.nativeElement.querySelector('.logs-table')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.log-detail-view')).toBeFalsy();
    });

    it('copies direct log URL to clipboard with feedback', async () => {
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextSpy,
        },
      });

      await component.copyLogUrl('mail_1');
      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('?tab=logs&mailId=mail_1'));
      expect(component.copiedLogUrl()).toBe(true);
    });

    it('syncs mailId from URL param into selectedLog on init or param change', async () => {
      tabSignal.set('logs');
      mailIdSignal.set('mail_2');
      fixture.detectChanges();
      await fixture.whenStable();

      // The effect should synchronize mailId 'mail_2' to selectedLog
      expect(component.selectedLog()?.docId).toBe('mail_2');
      expect(component.selectedLog()?.to).toEqual(['fail@example.com']);
    });
  });

  describe('Rendered Preview Token Substitutions', () => {
    it('substitutes {name} in onboarding preview computeds', () => {
      expect(component.memberWelcomePreviewSubject()).toBe('Welcome to the I Liq Chuan Family!');
      expect(component.memberWelcomePreviewHtml()).toContain('Alex Chen');
      expect(component.memberWelcomePreviewHtml()).not.toContain('{name}');

      expect(component.instructorWelcomePreviewSubject()).toBe('Congratulations on your Instructor License!');
      expect(component.instructorWelcomePreviewHtml()).toContain('Alex Chen');
      expect(component.instructorWelcomePreviewHtml()).not.toContain('{name}');
    });

    it('substitutes tokens in purchases preview computeds', () => {
      expect(component.orderPreviewSubject()).toBe('Your I Liq Chuan Order Confirmation (1001)');
      expect(component.orderPreviewHtml()).toContain('Alex Chen');
      expect(component.orderPreviewHtml()).toContain('1001');
      expect(component.orderPreviewHtml()).not.toContain('{name}');
      expect(component.orderPreviewHtml()).not.toContain('{orderNumber}');

      expect(component.eventRegPreviewSubject()).toBe('Registration Confirmed: Zhong Xin Dao Summer Retreat');
      expect(component.eventRegPreviewHtml()).toContain('Alex Chen');
      expect(component.eventRegPreviewHtml()).toContain('Zhong Xin Dao Summer Retreat');

      expect(component.vodPreviewSubject()).toBe('Access Granted: 21 Form Detailed Breakdown');
      expect(component.vodPreviewHtml()).toContain('Alex Chen');

      expect(component.gradingPreviewSubject()).toBe('Grading Assessment Fee Received: Student Level 3');
      expect(component.gradingPreviewHtml()).toContain('Alex Chen');

      expect(component.subscriptionPreviewSubject()).toBe('Subscription Renewal Receipt: Annual Instructor Association Membership');
      expect(component.subscriptionPreviewHtml()).toContain('Alex Chen');
    });

    it('substitutes tokens in digest preview computeds', () => {
      expect(component.digestPreviewSubject()).toBe('Upcoming I Liq Chuan Events - this month');
      expect(component.digestPreviewHtml()).toContain('Workshop');
    });

    it('substitutes {name} and tokens in test email preview and outbound test send', async () => {
      await component.setCategory('test');
      component.testRecipient.set('tester@example.com');
      component.testSubject.set('Hello {name}');
      component.setTestBody('Dear {name}, your code is {orderNumber}.');

      expect(component.testPreviewSubject()).toBe('Hello Alex Chen');
      expect(component.testPreviewHtml()).toContain('Dear Alex Chen, your code is 1001.');
      expect(component.testPreviewHtml()).not.toContain('{name}');

      await component.sendTestEmail();

      expect(mockDataManager.sendAdminTestEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'tester@example.com',
          subject: 'Hello Alex Chen',
          bodyMarkdown: 'Dear Alex Chen, your code is 1001.',
        }),
      );
    });

    it('populates recipient email, substitutes member tokens, and displays profile link when a member is selected', async () => {
      await component.setCategory('test');
      component.testSubject.set('Welcome {name} ({memberId})');
      component.setTestBody('Instructor ID: {instructorId}');
      fixture.detectChanges();

      // Select member via handler
      component.onTestMemberSelected(mockTestMember);
      component.selectedTestMemberId.set('US101');
      fixture.detectChanges();

      expect(component.selectedTestMember()).toBe(mockTestMember);
      expect(component.testRecipient()).toBe('samchin@iliqchuan.com');
      expect(component.testPreviewSubject()).toBe('Welcome Master Sam Chin (US101)');
      expect(component.testPreviewHtml()).toContain('Instructor ID: 101');

      // Verify DOM renders profile link and details
      const profileLink = fixture.nativeElement.querySelector('.view-profile-btn');
      expect(profileLink).toBeTruthy();
      expect(profileLink.getAttribute('href')).toBe('/members/US101');
      expect(fixture.nativeElement.querySelector('.selected-member-card')?.textContent).toContain('Master Sam Chin');
      expect(fixture.nativeElement.querySelector('.selected-member-card')?.textContent).toContain('US101');

      // Test send uses the selected member's info
      await component.sendTestEmail();
      expect(mockDataManager.sendAdminTestEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'samchin@iliqchuan.com',
          subject: 'Welcome Master Sam Chin (US101)',
          bodyMarkdown: 'Instructor ID: 101',
          name: 'Master Sam Chin',
        }),
      );

      // Clearing resets selection
      component.clearSelectedTestMember();
      fixture.detectChanges();

      expect(component.selectedTestMember()).toBeNull();
      expect(component.selectedTestMemberId()).toBe('');
      expect(fixture.nativeElement.querySelector('.view-profile-btn')).toBeNull();
    });

    it('updates member selection when memberId is entered via onTestMemberIdChange', async () => {
      await component.setCategory('test');
      component.onTestMemberIdChange('US101');
      fixture.detectChanges();

      expect(component.selectedTestMember()).toBe(mockTestMember);
      expect(component.testRecipient()).toBe('samchin@iliqchuan.com');

      // Clearing via empty string
      component.onTestMemberIdChange('');
      fixture.detectChanges();
      expect(component.selectedTestMember()).toBeNull();
    });

    it('renders email-to-send pill selector and displays To: in rendered preview', async () => {
      await component.setCategory('test');
      component.testRecipient.set('test@example.com');
      fixture.detectChanges();

      const pills = fixture.nativeElement.querySelectorAll('.email-to-send-pills .pill-tab');
      expect(pills.length).toBe(4);
      expect(pills[0].textContent.trim()).toBe('Quick Ping');
      expect(pills[1].textContent.trim()).toBe('Welcome Notice');
      expect(pills[2].textContent.trim()).toBe('Order Confirmation');
      expect(pills[3].textContent.trim()).toBe('Event Digest');

      // Check rendered preview To: and Subject:
      const meta = fixture.nativeElement.querySelector('.preview-header-meta');
      expect(meta).toBeTruthy();
      expect(meta.textContent).toContain('To:');
      expect(meta.textContent).toContain('test@example.com');
      expect(meta.textContent).toContain('Subject:');
    });

    it('shows test template inputs with reset button when Quick Ping is selected and allows resetting', async () => {
      await component.setCategory('test');
      component.setTestEmailType('ping');
      fixture.detectChanges();

      // Inputs should exist
      expect(fixture.nativeElement.querySelector('#test-subject')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('app-markdown-editor')).toBeTruthy();

      // Modify subject and body
      component.testSubject.set('Custom Subject');
      component.testBodyMarkdown.set('Custom Body');
      fixture.detectChanges();

      // Click Reset Template button
      const resetBtn = fixture.nativeElement.querySelector('.reset-ping-btn') as HTMLButtonElement;
      expect(resetBtn).toBeTruthy();
      resetBtn.click();
      fixture.detectChanges();

      expect(component.testSubject()).toContain('[Test] I Liq Chuan Email Verification');
      expect(component.testBodyMarkdown()).toContain('This is a test verification email');
    });

    it('hides template editor inputs and shows rendered html preview when a non-ping template is selected', async () => {
      await component.setCategory('test');
      component.testRecipient.set('newbie@example.com');
      component.onTestMemberSelected(mockTestMember);
      component.setTestEmailType('welcome');
      fixture.detectChanges();

      // Editor inputs should NOT be rendered
      expect(fixture.nativeElement.querySelector('#test-subject')).toBeNull();
      expect(fixture.nativeElement.querySelector('.ping-template-section')).toBeNull();

      // Preview should show Welcome Notice with replaced tokens
      expect(component.testPreviewSubject()).toBe('Welcome to the I Liq Chuan Family!');
      expect(component.testPreviewTo()).toBe('Master Sam Chin <samchin@iliqchuan.com>');

      const meta = fixture.nativeElement.querySelector('.preview-header-meta');
      expect(meta.textContent).toContain('Master Sam Chin <samchin@iliqchuan.com>');
      expect(meta.textContent).toContain('Welcome to the I Liq Chuan Family!');

      // Sending dispatches the welcome notice template
      await component.sendTestEmail();
      expect(mockDataManager.sendAdminTestEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'samchin@iliqchuan.com',
          subject: 'Welcome to the I Liq Chuan Family!',
        }),
      );
    });
  });
});

