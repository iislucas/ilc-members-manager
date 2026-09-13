import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GrantVodModalComponent } from './grant-vod-modal';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { initVideoItem, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { initMember } from '../../../functions/src/data-model/members';
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
    mockDataManagerService = {
      members: new SearchableSet(['name'], 'memberId'),
      getMember: vi.fn(),
      getMemberByMemberId: vi.fn().mockReturnValue(mockMember),
      grantVideoAccess: vi.fn().mockResolvedValue({
        success: true,
        grantedCount: 1,
        recipientEmail: 'student@example.com',
      }),
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

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.effectiveTitle()).toBe('Neutral Stance Practice');
    expect(component.canGrantSeries()).toBe(true);
  });

  it('should toggle scope to series and update effectiveTitle', () => {
    component.grantScope.set('series');
    expect(component.effectiveTitle()).toBe('Basics Series');
    expect(component.effectiveTargetId()).toBe('series_basics');
  });

  it('should submit grant successfully for selected member', async () => {
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

  it('should validate missing recipient email', async () => {
    component.useManualEmail.set(true);
    component.manualEmail.set('');

    await component.submitGrant();

    expect(component.errorMessage()).toContain('valid email');
    expect(mockDataManagerService.grantVideoAccess).not.toHaveBeenCalled();
  });
});
