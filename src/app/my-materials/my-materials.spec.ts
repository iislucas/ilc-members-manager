import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyMaterialsComponent } from './my-materials';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { UploadItem, initUploadItem } from '../../../functions/src/data-model';
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

describe('MyMaterialsComponent', () => {
  let component: MyMaterialsComponent;
  let fixture: ComponentFixture<MyMaterialsComponent>;

  const mockUploads: UploadItem[] = [
    {
      ...initUploadItem(),
      docId: 'upload1',
      memberDocId: 'mem1',
      name: 'Workshop 2026 Part 1.mp4',
      contentType: 'video/mp4',
      size: 104857600,
      url: 'https://storage/vid1.mp4',
      previewUrl: 'https://storage/vid1.jpg',
      date: '2026-05-10',
      location: 'New York',
      eventDocId: 'ev1',
      eventTitle: 'NYC Spring Workshop',
      notes: 'Focus on spinning hands and section 1',
      createdAt: '2026-05-10T12:00:00.000Z',
    },
    {
      ...initUploadItem(),
      docId: 'upload2',
      memberDocId: 'mem1',
      name: 'Group Photo.jpg',
      contentType: 'image/jpeg',
      size: 2048000,
      url: 'https://storage/photo.jpg',
      previewUrl: 'https://storage/photo_thumb.jpg',
      date: '2025-11-20',
      location: 'Boulder, CO',
      eventDocId: '',
      eventTitle: '',
      notes: 'Group photo at the retreat',
      createdAt: '2025-11-20T10:00:00.000Z',
    },
  ];

  const mockDataManagerService = {
    getMemberUploads: vi.fn().mockResolvedValue([...mockUploads]),
    createUploadItem: vi.fn().mockResolvedValue('new-doc-id'),
    updateUploadMetadata: vi.fn().mockResolvedValue(undefined),
    deleteUploadItem: vi.fn().mockResolvedValue(undefined),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    searchEvents: vi.fn().mockResolvedValue([
      { docId: 'ev1', title: 'NYC Spring Workshop', start: '2026-05-10T10:00:00Z', location: 'New York' },
    ]),
  };

  const mockFirebaseStateService = {
    user: signal({
      member: {
        docId: 'mem1',
        name: 'Instructor Jane',
        memberId: 'US402',
        instructorId: '10',
      },
      isAdmin: false,
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyMaterialsComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        RoutingService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyMaterialsComponent);
    component = fixture.componentInstance;
  });

  it('should create and load member uploads on init', async () => {
    expect(component).toBeTruthy();
    await component.loadMaterials();
    expect(component.materials().length).toBe(2);
  });

  it('should filter materials by search query', async () => {
    await component.loadMaterials();
    component.setSearchQuery('Spinning');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].name).toContain('Workshop');

    component.setSearchQuery('Boulder');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].name).toContain('Group Photo');
  });

  it('should filter materials by media type', async () => {
    await component.loadMaterials();
    component.setMediaType('video');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].contentType).toBe('video/mp4');

    component.setMediaType('image');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].contentType).toBe('image/jpeg');
  });

  it('should filter materials by date prefix', async () => {
    await component.loadMaterials();
    component.setDateFilter('2026-05');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].date).toBe('2026-05-10');

    component.setDateFilter('2025');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].date).toBe('2025-11-20');

    component.setDateFilter('2024');
    expect(component.filteredMaterials().length).toBe(0);

    component.setDateFilter('');
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should support tags for uploads, editing, and filtering', async () => {
    await component.loadMaterials();

    // Default upload tags
    component.addUploadTag('camp');
    component.addUploadTag('highlights');
    expect(component.defaultUploadTags()).toEqual(['camp', 'highlights']);
    component.removeUploadTag('camp');
    expect(component.defaultUploadTags()).toEqual(['highlights']);

    // Edit modal tags
    const item = component.materials()[0];
    component.openEditModal(item);
    component.addEditTag('workshop');
    component.addEditTag('2026');
    expect(component.editTags()).toEqual(['workshop', '2026']);
    component.removeEditTag('2026');
    expect(component.editTags()).toEqual(['workshop']);
    await component.saveEdit();

    expect(mockDataManagerService.updateUploadMetadata).toHaveBeenCalledWith(
      'mem1',
      'upload1',
      expect.objectContaining({
        tags: ['workshop'],
      }),
    );

    // Tag filtering
    component.filterByTag('workshop');
    expect(component.selectedTagFilter()).toBe('workshop');
    expect(component.filteredMaterials().length).toBe(1);
  });

  it('should open and save edit metadata modal', async () => {
    await component.loadMaterials();
    const item = component.materials()[0];

    component.openEditModal(item);
    expect(component.editingUpload()).toBe(item);
    expect(component.editName()).toBe(item.name);

    component.editName.set('Updated Workshop Name');
    component.editLocation.set('Boston, MA');
    await component.saveEdit();

    expect(mockDataManagerService.updateUploadMetadata).toHaveBeenCalledWith(
      'mem1',
      'upload1',
      expect.objectContaining({
        name: 'Updated Workshop Name',
        location: 'Boston, MA',
      }),
    );
    expect(component.editingUpload()).toBeNull();
  });

  it('should filter by event using autocomplete and clear', async () => {
    await component.loadMaterials();
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
    expect(component.filteredMaterials().length).toBe(2);
  });

  it('should filter by date and location via helper methods', async () => {
    await component.loadMaterials();

    component.filterByDate('2026-05-10');
    expect(component.selectedDateFilter()).toBe('2026-05-10');

    component.setDateFilter('');
    component.filterByLocation('Boulder, CO');
    expect(component.searchQuery()).toBe('Boulder, CO');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].location).toBe('Boulder, CO');
  });

  it('should generate correct hrefs for event, date, and location', () => {
    const item = mockUploads[0];
    expect(component.getEventHref(item)).toBe('/events/ev1');
    expect(component.getDateHref(item.date)).toBe('/events?q=2026-05-10');
    expect(component.getLocationHref(item.location)).toBe('/find-school?q=New+York');
  });
});
