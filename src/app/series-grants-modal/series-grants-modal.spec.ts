import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SeriesGrantsModalComponent } from './series-grants-modal';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import {
  initVideoItem,
  VideoSeries,
  VideoGrant,
  VideoGrantKind,
  initVideoGrant,
} from '../../../functions/src/data-model/vod';
import { initMember, Member } from '../../../functions/src/data-model/members';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('SeriesGrantsModalComponent', () => {
  let component: SeriesGrantsModalComponent;
  let fixture: ComponentFixture<SeriesGrantsModalComponent>;
  let mockDataManagerService: {
    members: SearchableSet<'docId', Member>;
    getSeriesGrants: ReturnType<typeof vi.fn>;
    revokeVideoGrant: ReturnType<typeof vi.fn>;
  };
  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
  };

  const mockVideo1 = {
    ...initVideoItem(),
    docId: 'vid_1',
    title: 'Episode 1: Fundamentals',
    seriesId: 'series_spin',
    seriesTitle: 'Spinning Hands Series',
    seriesPartIndex: 1,
  };

  const mockVideo2 = {
    ...initVideoItem(),
    docId: 'vid_2',
    title: 'Episode 2: Advanced Applications',
    seriesId: 'series_spin',
    seriesTitle: 'Spinning Hands Series',
    seriesPartIndex: 2,
  };

  const mockSeries: VideoSeries = {
    seriesId: 'series_spin',
    title: 'Spinning Hands Series',
    description: 'Complete guide to spinning hands',
    priceCents: 4999,
    tags: ['spinning'],
    videoCount: 2,
    totalDurationSeconds: 3600,
    videos: [mockVideo1, mockVideo2],
  };

  const mockMember1: Member = {
    ...initMember(),
    docId: 'mem_1',
    memberId: 'US402',
    name: 'Alice Cooper',
    emails: ['alice@example.com'],
  };

  const mockMember2: Member = {
    ...initMember(),
    docId: 'mem_2',
    memberId: 'PL100',
    name: 'Bob Martin',
    emails: ['bob@example.com'],
  };

  const mockGrants: VideoGrant[] = [
    // Alice purchased the direct series
    {
      ...initVideoGrant('series_spin', 'mem_1'),
      memberEmail: 'alice@example.com',
      grantKind: VideoGrantKind.StripePurchase,
      amountPaidCents: 4999,
      orderDocId: 'order_123',
      grantedAt: '2026-09-20T10:00:00Z',
    },
    // Bob was gifted Episode 1 by Sam
    {
      ...initVideoGrant('vid_1', 'mem_2'),
      memberEmail: 'bob@example.com',
      grantKind: VideoGrantKind.GiftPurchase,
      giftedByName: 'Sam Chin',
      giftedByEmail: 'sam@iliqchuan.com',
      giftMessage: 'Enjoy practicing!',
      grantedAt: '2026-09-22T14:00:00Z',
    },
    // Charlie (non-member) was granted by admin
    {
      ...initVideoGrant('series_spin', ''),
      memberEmail: 'charlie@example.com',
      grantKind: VideoGrantKind.AdminGrant,
      notes: 'Complimentary review copy',
      grantedAt: '2026-09-25T08:00:00Z',
    },
  ];

  beforeEach(async () => {
    const memberSet = new SearchableSet<'docId', Member>(['name', 'memberId'], 'docId');
    memberSet.setEntries([mockMember1, mockMember2]);

    mockDataManagerService = {
      members: memberSet,
      getSeriesGrants: vi.fn().mockResolvedValue(mockGrants),
      revokeVideoGrant: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      hrefForView: vi.fn().mockReturnValue('/test-href'),
    };

    await TestBed.configureTestingModule({
      imports: [SeriesGrantsModalComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SeriesGrantsModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('series', mockSeries);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should initialize and load grants for the series', () => {
    expect(component).toBeTruthy();
    expect(mockDataManagerService.getSeriesGrants).toHaveBeenCalledWith(
      expect.arrayContaining(['series_spin', 'vid_1', 'vid_2']),
    );
    expect(component.rawGrants().length).toBe(3);
  });

  it('should aggregate recipients correctly with member lookup and grant kind', () => {
    const recipients = component.recipients();
    expect(recipients.length).toBe(3);

    // Alice
    const alice = recipients.find((r) => r.memberEmail === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice?.memberName).toBe('Alice Cooper');
    expect(alice?.memberId).toBe('US402');
    expect(alice?.hasFullSeries).toBe(true);
    expect(alice?.primaryGrantKind).toBe(VideoGrantKind.StripePurchase);
    expect(alice?.amountPaidCents).toBe(4999);
    expect(alice?.orderDocId).toBe('order_123');

    // Bob
    const bob = recipients.find((r) => r.memberEmail === 'bob@example.com');
    expect(bob).toBeDefined();
    expect(bob?.memberName).toBe('Bob Martin');
    expect(bob?.memberId).toBe('PL100');
    expect(bob?.hasFullSeries).toBe(false); // Only 1 of 2 videos
    expect(bob?.grantedVideoCount).toBe(1);
    expect(bob?.primaryGrantKind).toBe(VideoGrantKind.GiftPurchase);
    expect(bob?.isGift).toBe(true);
    expect(bob?.giftedByName).toBe('Sam Chin');
    expect(bob?.giftMessage).toBe('Enjoy practicing!');

    // Charlie (non-member)
    const charlie = recipients.find((r) => r.memberEmail === 'charlie@example.com');
    expect(charlie).toBeDefined();
    expect(charlie?.memberName).toBe('charlie@example.com');
    expect(charlie?.memberId).toBe('');
    expect(charlie?.hasFullSeries).toBe(true);
    expect(charlie?.primaryGrantKind).toBe(VideoGrantKind.AdminGrant);
    expect(charlie?.notes).toBe('Complimentary review copy');
  });

  it('should compute summary stats accurately', () => {
    const stats = component.summaryStats();
    expect(stats.totalCount).toBe(3);
    expect(stats.purchasedCount).toBe(1);
    expect(stats.giftedCount).toBe(1);
    expect(stats.adminGrantedCount).toBe(1);
    expect(stats.fullSeriesCount).toBe(2);
    expect(stats.partialCount).toBe(1);
    expect(stats.totalRevenueDollars).toBe('49.99');
  });

  it('should filter recipients by search term', () => {
    component.searchTerm.set('Alice');
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberName).toBe('Alice Cooper');

    component.searchTerm.set('Sam Chin'); // Search in giftedByName
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberName).toBe('Bob Martin');

    component.searchTerm.set('nonexistent');
    expect(component.filteredRecipients().length).toBe(0);
  });

  it('should filter recipients by grant kind', () => {
    component.grantKindFilter.set(VideoGrantKind.StripePurchase);
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberEmail).toBe('alice@example.com');

    component.grantKindFilter.set(VideoGrantKind.GiftPurchase);
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberEmail).toBe('bob@example.com');

    component.grantKindFilter.set(VideoGrantKind.AdminGrant);
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberEmail).toBe('charlie@example.com');
  });

  it('should filter recipients by access scope', () => {
    component.accessScopeFilter.set('full');
    expect(component.filteredRecipients().length).toBe(2);

    component.accessScopeFilter.set('partial');
    expect(component.filteredRecipients().length).toBe(1);
    expect(component.filteredRecipients()[0].memberEmail).toBe('bob@example.com');
  });

  it('should copy all emails to clipboard', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    await component.copyAllEmails();
    expect(writeTextSpy).toHaveBeenCalled();
    const copiedText = writeTextSpy.mock.calls[0][0];
    expect(copiedText).toContain('alice@example.com');
    expect(copiedText).toContain('bob@example.com');
    expect(copiedText).toContain('charlie@example.com');
    expect(component.copiedEmailsToast()).toBe(true);
  });

  it('should emit grantRequested when openGrantModal is called', () => {
    const emitSpy = vi.fn();
    component.grantRequested.subscribe(emitSpy);
    component.openGrantModal();
    expect(emitSpy).toHaveBeenCalledWith(mockSeries);
  });

  it('should emit closed when close is called', () => {
    const emitSpy = vi.fn();
    component.closed.subscribe(emitSpy);
    component.close();
    expect(emitSpy).toHaveBeenCalled();
  });

  it('should prompt and execute revoke for a recipient', async () => {
    const charlie = component.recipients().find((r) => r.memberEmail === 'charlie@example.com')!;
    component.promptRevoke(charlie);
    expect(component.revokeConfirmRecipient()).toEqual(charlie);

    await component.confirmRevoke(charlie);
    expect(mockDataManagerService.revokeVideoGrant).toHaveBeenCalled();
    expect(component.revokeConfirmRecipient()).toBeNull();
    // Charlie should be removed from rawGrants
    expect(component.rawGrants().length).toBe(2);
  });
});
