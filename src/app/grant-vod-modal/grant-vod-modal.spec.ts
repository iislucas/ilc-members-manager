import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GrantVodModalComponent } from './grant-vod-modal';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { initVideoItem, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { initMember } from '../../../functions/src/data-model/members';
import { initMailSettings, MailSendingStatus } from '../../../functions/src/data-model/mail';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('GrantVodModalComponent', () => {
  let component: GrantVodModalComponent;
  let fixture: ComponentFixture<GrantVodModalComponent>;
  let mockDataManagerService: any;

  const mockVideo = {
    ...initVideoItem(),
    docId: 'vid_test_1',
    title: 'Neutral Stance Practice',
    seriesId: 'series_basics',
    seriesTitle: 'Basics Series',
  };

  const mockMember = {
    ...initMember(),
    docId: 'mem_123',
    memberId: 'US402',
    name: 'Test Student',
    emails: ['student@example.com'],
  };

  beforeEach(async () => {
    const memberSet = new SearchableSet(['name'], 'memberId');
    memberSet.setEntries([mockMember]);

    mockDataManagerService = {
      members: memberSet,
      mailSettings: signal(initMailSettings()),
      getMember: vi.fn(),
      getMemberByMemberId: vi.fn().mockReturnValue(mockMember),
      grantVideoAccess: vi.fn().mockResolvedValue({
        success: true,
        grantedCount: 1,
        recipientEmail: 'student@example.com',
      }),
      getVideoSeriesList: vi.fn().mockReturnValue([
        { seriesId: 'series_basics', title: 'Basics Series', videoCount: 3 },
      ]),
      videos: { entries: signal([]) },
    };

    await TestBed.configureTestingModule({
      imports: [GrantVodModalComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GrantVodModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('video', mockVideo);
    fixture.detectChanges();
  });

  it('should create and default to series access when item belongs to a series', () => {
    expect(component).toBeTruthy();
    expect(component.canGrantSeries()).toBe(true);
    expect(component.grantScope()).toBe('series');
    expect(component.effectiveTitle()).toBe('Basics Series');
  });

  it('should toggle scope to video and update effectiveTitle and targetId', () => {
    component.grantScope.set('video');
    expect(component.effectiveTitle()).toBe('Neutral Stance Practice');
    expect(component.effectiveTargetId()).toBe('vid_test_1');
  });

  it('should submit grant successfully for selected member', async () => {
    component.grantScope.set('video');
    component.onMemberSelected(mockMember);
    component.grantKind.set(VideoGrantKind.AdminGrant);
    component.notes.set('Complimentary pass');

    const grantedSpy = vi.fn();
    component.granted.subscribe(grantedSpy);
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    await component.submitGrant();

    expect(mockDataManagerService.grantVideoAccess).toHaveBeenCalledWith({
      targetType: 'video',
      targetId: 'vid_test_1',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'mem_123',
      recipientName: 'Test Student',
      grantKind: 'admin_grant',
      notes: 'Complimentary pass',
      sendNotification: true,
    });

    expect(grantedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'vid_test_1',
        recipientEmail: 'student@example.com',
        grantedCount: 1,
      }),
    );
    expect(closedSpy).toHaveBeenCalled();
  });

  it('should submit series grant with series target and series video count in button', async () => {
    component.onMemberSelected(mockMember);
    component.grantKind.set(VideoGrantKind.GiftPurchase);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const submitBtn = compiled.querySelector('.btn-primary');
    expect(submitBtn?.textContent).toContain('Grant Series Access');

    await component.submitGrant();

    expect(mockDataManagerService.grantVideoAccess).toHaveBeenCalledWith({
      targetType: 'series',
      targetId: 'series_basics',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'mem_123',
      recipientName: 'Test Student',
      grantKind: 'gift_purchase',
      notes: undefined,
      sendNotification: true,
    });
  });

  it('should allow disabling sendNotification option', async () => {
    component.onMemberSelected(mockMember);
    expect(component.sendNotification()).toBe(true);

    component.sendNotification.set(false);
    expect(component.sendNotification()).toBe(false);

    await component.submitGrant();

    expect(mockDataManagerService.grantVideoAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        sendNotification: false,
      }),
    );
  });

  it('should validate missing recipient email', async () => {
    component.useManualEmail.set(true);
    component.manualEmail.set('');

    await component.submitGrant();

    expect(component.errorMessage()).toContain('valid email');
    expect(mockDataManagerService.grantVideoAccess).not.toHaveBeenCalled();
  });

  it('should display warning banner and prevent manual entry to non-member when mail sending is Off', async () => {
    mockDataManagerService.mailSettings.set({
      ...initMailSettings(),
      status: MailSendingStatus.Off,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isMailOff()).toBe(true);
    const banner = fixture.nativeElement.querySelector('.mail-off-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Email notifications are currently turned off');

    // Toggling manual email button is hidden when mail is off
    const toggleBtn = fixture.nativeElement.querySelector('.text-link-btn');
    expect(toggleBtn).toBeNull();

    // If manual email is somehow attempted for an outsider
    component.useManualEmail.set(true);
    component.manualEmail.set('outsider@example.com');
    await component.submitGrant();

    expect(component.errorMessage()).toContain('Access can only be granted to existing member accounts');
    expect(mockDataManagerService.grantVideoAccess).not.toHaveBeenCalled();

    // If manual email matches an existing member, grant should succeed
    component.manualEmail.set('student@example.com');
    await component.submitGrant();
    expect(mockDataManagerService.grantVideoAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'student@example.com',
      }),
    );
  });
});
