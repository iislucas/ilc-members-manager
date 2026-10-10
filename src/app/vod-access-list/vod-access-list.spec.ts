import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VodAccessListComponent } from './vod-access-list';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
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

describe('VodAccessListComponent', () => {
  let component: VodAccessListComponent;
  let fixture: ComponentFixture<VodAccessListComponent>;
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
      imports: [VodAccessListComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VodAccessListComponent);
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

  it('should link purchases directly to the order page by order doc id', () => {
    fixture.detectChanges();
    expect(mockRoutingService.hrefForView).toHaveBeenCalledWith(Views.OrderView, { orderId: 'order_123' });
    expect(mockRoutingService.hrefForView).not.toHaveBeenCalledWith(Views.ManageOrders, expect.anything());
  });

  it('should open and close the inline grant dialog', () => {
    expect(component.grantModalOpen()).toBe(false);
    component.openGrantModal();
    expect(component.grantModalOpen()).toBe(true);
    component.closeGrantModal();
    expect(component.grantModalOpen()).toBe(false);
  });

  it('should reload grants after access is granted', async () => {
    mockDataManagerService.getSeriesGrants.mockClear();
    component.onAccessGranted();
    await fixture.whenStable();
    expect(mockDataManagerService.getSeriesGrants).toHaveBeenCalledTimes(1);
  });

  it('should not refetch when given an equivalent series object', async () => {
    mockDataManagerService.getSeriesGrants.mockClear();
    fixture.componentRef.setInput('series', { ...mockSeries, videos: [...mockSeries.videos] });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(mockDataManagerService.getSeriesGrants).not.toHaveBeenCalled();
  });

  it('should ignore a slower response for a previous target', async () => {
    let resolveFirst: (g: VideoGrant[]) => void = () => {};
    mockDataManagerService.getSeriesGrants
      .mockImplementationOnce(() => new Promise<VideoGrant[]>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([mockGrants[1]]);
    fixture.componentRef.setInput('series', { ...mockSeries, seriesId: 'series_a' });
    fixture.detectChanges();
    fixture.componentRef.setInput('series', { ...mockSeries, seriesId: 'series_b' });
    fixture.detectChanges();
    await fixture.whenStable();
    resolveFirst(mockGrants);
    await Promise.resolve();
    expect(component.rawGrants()).toEqual([mockGrants[1]]);
  });

  it('should not be in video mode when given a series', () => {
    expect(component.isVideoMode()).toBe(false);
    expect(component.targetTitle()).toBe('Spinning Hands Series');
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

  it('should deduplicate amountPaidCents across multiple bundled grants sharing the same order', () => {
    // When a recipient has multiple grants (series + constituent episodes) all stamped with order amount
    component.rawGrants.set([
      {
        ...initVideoGrant('series_spin', 'mem_1'),
        memberEmail: 'alice@example.com',
        grantKind: VideoGrantKind.StripePurchase,
        amountPaidCents: 4999,
        orderDocId: 'order_bundle_1',
        grantedAt: '2026-09-20T10:00:00Z',
      },
      {
        ...initVideoGrant('vid_1', 'mem_1'),
        memberEmail: 'alice@example.com',
        grantKind: VideoGrantKind.StripePurchase,
        amountPaidCents: 4999,
        orderDocId: 'order_bundle_1',
        grantedAt: '2026-09-20T10:00:01Z',
      },
      {
        ...initVideoGrant('vid_2', 'mem_1'),
        memberEmail: 'alice@example.com',
        grantKind: VideoGrantKind.StripePurchase,
        amountPaidCents: 4999,
        orderDocId: 'order_bundle_1',
        grantedAt: '2026-09-20T10:00:02Z',
      },
    ]);

    const recipients = component.recipients();
    expect(recipients.length).toBe(1);
    expect(recipients[0].amountPaidCents).toBe(4999);
  });

  describe('single video mode', () => {
    beforeEach(async () => {
      mockDataManagerService.getSeriesGrants.mockClear();
      fixture.componentRef.setInput('series', null);
      fixture.componentRef.setInput('video', mockVideo1);
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should load grants for the video and its parent series', () => {
      expect(component.isVideoMode()).toBe(true);
      expect(component.targetTitle()).toBe('Episode 1: Fundamentals');
      const ids = mockDataManagerService.getSeriesGrants.mock.calls[0][0] as string[];
      expect(ids).toEqual(expect.arrayContaining(['series_spin', 'vid_1']));
      expect(ids).not.toContain('vid_2');
    });

    it('should distinguish whole-series access from direct video access', () => {
      const recipients = component.recipients();
      const alice = recipients.find((r) => r.memberEmail === 'alice@example.com');
      const bob = recipients.find((r) => r.memberEmail === 'bob@example.com');
      expect(alice?.viaSeriesGrant).toBe(true);
      expect(bob?.viaSeriesGrant).toBe(false);
      // Alice and Charlie have series grants; Bob was gifted this episode directly.
      expect(component.summaryStats().fullSeriesCount).toBe(2);
    });

    it('should only revoke direct video grants, keeping whole-series grants', async () => {
      const alice = component.recipients().find((r) => r.memberEmail === 'alice@example.com')!;
      const bob = component.recipients().find((r) => r.memberEmail === 'bob@example.com')!;
      // Alice's only grant is on the whole series: nothing is revocable from this video.
      expect(component.revocableGrants(alice)).toEqual([]);
      // Bob's gift is for this episode directly.
      expect(component.revocableGrants(bob).map((g) => g.videoId)).toEqual(['vid_1']);

      mockDataManagerService.revokeVideoGrant.mockClear();
      await component.confirmRevoke(alice);
      expect(mockDataManagerService.revokeVideoGrant).not.toHaveBeenCalled();
    });

    it('should offer a link to the series page instead of revoke for series-level access', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      // Alice and Charlie: series-only access; Bob: direct grant.
      expect(el.querySelectorAll('.series-access-link').length).toBe(2);
      expect(el.querySelectorAll('.revoke-btn').length).toBe(1);
      expect(mockRoutingService.hrefForView).toHaveBeenCalledWith(
        Views.ManageVodSeries, { seriesId: 'series_spin' }, { tab: 'access' },
      );
    });

    it('should use the page-resolved parent series id for grouped series', async () => {
      mockDataManagerService.getSeriesGrants.mockClear();
      fixture.componentRef.setInput('video', { ...mockVideo1, seriesId: undefined });
      fixture.componentRef.setInput('parentSeries', { ...mockSeries, seriesId: 'grouped_series' });
      fixture.detectChanges();
      await fixture.whenStable();
      const ids = mockDataManagerService.getSeriesGrants.mock.calls.at(-1)![0] as string[];
      expect(ids).toEqual(expect.arrayContaining(['grouped_series', 'vid_1']));
    });

    it('should render video-specific labels', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Access Via');
      expect(el.textContent).toContain('This video');
      expect(el.textContent).toContain('Whole series');
      expect(el.textContent).not.toContain('Full Series Only');
    });
  });
});
