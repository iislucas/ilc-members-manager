import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageMaterialsComponent } from './manage-materials';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { UploadItem, initUploadItem, InstructorPublicData, VodStatus } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn().mockReturnValue(() => {}),
  doc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage/download'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

describe('ManageMaterialsComponent', () => {
  let component: ManageMaterialsComponent;
  let fixture: ComponentFixture<ManageMaterialsComponent>;

  const mockUploads: UploadItem[] = [
    {
      ...initUploadItem(),
      docId: 'upload1',
      memberDocId: 'mem1',
      memberId: 'US402',
      memberName: 'Jane Doe',
      instructorId: '10',
      name: 'Workshop 2026 Part 1.mp4',
      contentType: 'video/mp4',
      size: 104857600,
      url: 'https://storage/vid1.mp4',
      previewUrl: 'https://storage/vid1.jpg',
      date: '2026-05-10',
      location: 'New York',
      eventDocId: 'ev1',
      eventTitle: 'NYC Spring Workshop',
      notes: 'Notes on spinning hands',
      createdAt: '2026-05-10T12:00:00.000Z',
    },
    {
      ...initUploadItem(),
      docId: 'upload2',
      memberDocId: 'mem2',
      memberId: 'PL100',
      memberName: 'John Smith',
      instructorId: '20',
      name: 'Seminar Photo.jpg',
      contentType: 'image/jpeg',
      size: 2048000,
      url: 'https://storage/photo.jpg',
      previewUrl: 'https://storage/photo_thumb.jpg',
      date: '2025-11-20',
      location: 'Warsaw',
      eventDocId: '',
      eventTitle: '',
      notes: 'Group photo Warsaw',
      createdAt: '2025-11-20T10:00:00.000Z',
    },
  ];

  const mockDataManagerService = {
    getAllUploads: vi.fn().mockResolvedValue([...mockUploads]),
    updateUploadMetadata: vi.fn().mockResolvedValue(undefined),
    deleteUploadItem: vi.fn().mockResolvedValue(undefined),
    instructors: new SearchableSet<'instructorId', InstructorPublicData>(
      ['name', 'instructorId', 'city', 'country'],
      'instructorId',
      [
        {
          docId: 'mem1',
          name: 'Jane Doe',
          instructorId: '10',
          memberId: 'US402',
        } as unknown as InstructorPublicData,
        {
          docId: 'mem2',
          name: 'John Smith',
          instructorId: '20',
          memberId: 'PL100',
        } as unknown as InstructorPublicData,
      ],
    ),
    transcodeVideoForVod: vi.fn().mockResolvedValue({ success: true, videoId: 'upload1', vodStatus: 'ready' }),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    searchEvents: vi.fn().mockResolvedValue([
      { docId: 'ev1', title: 'NYC Spring Workshop', start: '2026-05-10T10:00:00Z', location: 'New York' },
      { docId: 'ev2', title: 'Paris Summer Retreat', start: '2026-07-15T09:00:00Z', location: 'Paris' },
    ]),
  };

  const mockFirebaseStateService = {
    user: signal({
      member: { docId: 'admin1', name: 'Admin User', memberId: 'US536' },
      isAdmin: true,
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageMaterialsComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        RoutingService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageMaterialsComponent);
    component = fixture.componentInstance;
  });

  it('should create and load all uploads on init', async () => {
    expect(component).toBeTruthy();
    await component.loadAllMaterials();
    expect(component.materials().length).toBe(2);
  });

  it('should filter by instructor using autocomplete selection and clear', async () => {
    await component.loadAllMaterials();
    component.onInstructorFilterSelected({
      docId: 'mem1',
      name: 'Jane Doe',
      instructorId: '10',
    } as any);

    expect(component.selectedInstructorFilter()).toBe('mem1');
    expect(component.selectedInstructorSearchTerm()).toBe('Jane Doe [10]');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].memberName).toBe('Jane Doe');

    component.clearInstructorFilter();
    expect(component.selectedInstructorFilter()).toBe('');
    expect(component.selectedInstructorSearchTerm()).toBe('');
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should filter by event using autocomplete selection and clear', async () => {
    await component.loadAllMaterials();
    component.onEventFilterSelected({
      docId: 'ev1',
      title: 'NYC Spring Workshop',
      start: '2026-05-10T10:00:00Z',
      location: 'New York',
    } as any);

    expect(component.selectedEventFilter()).toBe('ev1');
    expect(component.selectedEventFilterSearchTerm()).toBe('NYC Spring Workshop');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].eventTitle).toBe('NYC Spring Workshop');

    component.clearEventFilter();
    expect(component.selectedEventFilter()).toBe('');
    expect(component.selectedEventFilterSearchTerm()).toBe('');
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should filter by search text', async () => {
    await component.loadAllMaterials();
    component.setSearchQuery('Warsaw');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].location).toBe('Warsaw');
  });

  it('should filter by date prefix', async () => {
    await component.loadAllMaterials();
    component.setDateFilter('2026-05');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].date).toBe('2026-05-10');

    component.setDateFilter('2027');
    expect(component.filteredMaterials().length).toBe(0);

    component.setDateFilter('');
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should filter by tag and add/remove tags in edit modal', async () => {
    await component.loadAllMaterials();
    const item = component.materials()[0];

    // Open edit modal and add tags
    component.openEditModal(item);
    component.addEditTag('spinning');
    component.addEditTag('technique');
    expect(component.editTags()).toEqual(['spinning', 'technique']);

    component.removeEditTag('spinning');
    expect(component.editTags()).toEqual(['technique']);

    await component.saveEdit();

    expect(mockDataManagerService.updateUploadMetadata).toHaveBeenCalledWith(
      'mem1',
      'upload1',
      expect.objectContaining({
        tags: ['technique'],
      }),
    );

    // Filter by tag
    component.filterByTag('technique');
    expect(component.selectedTagFilter()).toBe('technique');
    expect(component.filteredMaterials().length).toBe(1);
  });

  it('should update metadata via admin modal', async () => {
    await component.loadAllMaterials();
    const item = component.materials()[0];

    component.openEditModal(item);
    component.editLocation.set('New York, Manhattan');
    await component.saveEdit();

    expect(mockDataManagerService.updateUploadMetadata).toHaveBeenCalledWith(
      'mem1',
      'upload1',
      expect.objectContaining({
        location: 'New York, Manhattan',
      }),
    );
  });

  it('should correctly select and link an event via autocomplete in edit modal', async () => {
    await component.loadEvents();
    await component.loadAllMaterials();
    const item = component.materials()[1]; // unlinked item

    component.openEditModal(item);
    expect(component.editEventDocId()).toBe('');

    component.onEditEventSelected({
      docId: 'ev2',
      title: 'Paris Summer Retreat',
      start: '2026-07-15T09:00:00Z',
      location: 'Paris, France',
    } as any);

    expect(component.editEventDocId()).toBe('ev2');
    expect(component.editEventTitle()).toBe('Paris Summer Retreat');
    expect(component.editLocation()).toBe('Warsaw');

    await component.saveEdit();

    expect(mockDataManagerService.updateUploadMetadata).toHaveBeenCalledWith(
      'mem2',
      'upload2',
      expect.objectContaining({
        eventDocId: 'ev2',
        eventTitle: 'Paris Summer Retreat',
      }),
    );
  });

  it('should format instructor name as "name [instructorId]" and generate correct hrefs', () => {
    const item = mockUploads[0];
    expect(component.getInstructorDisplay(item)).toBe('Jane Doe [10]');
    expect(component.getInstructorHref(item)).toBe('/instructors/10');
    expect(component.getEventHref(item)).toBe('/events/ev1');
    expect(component.getDateHref(item.date)).toBe('/events?q=2026-05-10');
    expect(component.getLocationHref(item.location)).toBe('/find-school?q=New+York');
  });

  it('should filter materials when clicking instructor, event, date, or location text', async () => {
    await component.loadAllMaterials();
    const item1 = component.materials()[0];
    const item2 = component.materials()[1];

    component.filterByInstructor(item1);
    expect(component.selectedInstructorFilter()).toBe('mem1');
    expect(component.filteredMaterials().length).toBe(1);

    component.clearInstructorFilter();
    component.filterByEvent(item1);
    expect(component.selectedEventFilter()).toBe('ev1');
    expect(component.filteredMaterials().length).toBe(1);

    component.clearEventFilter();
    component.filterByLocation(item2.location);
    expect(component.searchQuery()).toBe('Warsaw');
    expect(component.filteredMaterials().length).toBe(1);

    component.filterByDate(item1.date);
    expect(component.selectedDateFilter()).toBe('2026-05-10');
  });

  it('should filter by startDate and endDate range and clearDateRange', async () => {
    await component.loadAllMaterials();

    component.setDateRange('2026-01-01', '2026-12-31');
    expect(component.selectedStartDate()).toBe('2026-01-01');
    expect(component.selectedEndDate()).toBe('2026-12-31');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].docId).toBe('upload1');

    component.setDateRange('2025-01-01', '2025-12-31');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].docId).toBe('upload2');

    component.clearDateRange();
    expect(component.selectedStartDate()).toBe('');
    expect(component.selectedEndDate()).toBe('');
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should return correct VOD status label and URLs', () => {
    const itemReady: UploadItem = {
      ...initUploadItem(),
      docId: 'up1',
      vodStatus: VodStatus.Ready,
      vodVideoId: 'up1',
    };
    expect(component.getVodStatusLabel(itemReady)).toBe('In VOD');
    expect(component.getVodViewHref(itemReady)).toContain('/videos/up1');

    const itemTranscoding: UploadItem = {
      ...initUploadItem(),
      docId: 'up2',
      vodStatus: VodStatus.Transcoding,
    };
    expect(component.getVodStatusLabel(itemTranscoding)).toBe('Transcoding...');
    expect(component.getManageVodHref(itemTranscoding)).toContain('/manage-vod');
  });

  it('should open publish modal and submit VOD transcoding', async () => {
    await component.loadAllMaterials();
    const item = component.materials()[0];

    component.openPublishVodModal(item);
    expect(component.vodPublishItem()?.docId).toBe('upload1');
    expect(component.vodTitle()).toBe(item.name);

    await component.submitPublishVod();
    expect(mockDataManagerService.transcodeVideoForVod).toHaveBeenCalled();
    expect(component.vodPublishItem()).toBeNull();
    expect(component.materials()[0].vodStatus).toBe(VodStatus.Ready);
  });
});
