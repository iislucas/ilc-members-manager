import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailNotificationsComponent } from './email-notifications.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { signal } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
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

  beforeEach(async () => {
    tabSignal = signal('onboarding');
    subtabSignal = signal('order');

    mockRoutingService = {
      signals: {
        [Views.EmailNotifications]: {
          urlParams: {
            tab: tabSignal,
            subtab: subtabSignal,
          },
        },
      },
      navigateTo: vi.fn(),
    };

    mockDataManager = {
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
          message: { subject: 'Welcome Student' },
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

  it('should update activeCategory when urlParams.tab changes', async () => {
    tabSignal.set('purchases');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.activeCategory()).toBe('purchases');
    const subPills = fixture.nativeElement.querySelectorAll('.sub-nav-pills .pill-btn');
    expect(subPills.length).toBe(5);
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

    expect(mockDataManager.sendAdminTestEmail).toHaveBeenCalledWith({
      to: 'tester@example.com',
      subject: 'Test Email',
      bodyMarkdown: 'Hello world',
    });

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
});

