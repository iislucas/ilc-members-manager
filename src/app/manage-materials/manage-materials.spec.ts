import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageMaterialsComponent } from './manage-materials';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { UploadItem, initUploadItem, InstructorPublicData } from '../../../functions/src/data-model';
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
    instructors: {
      entries: signal<InstructorPublicData[]>([
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
      ]),
    },
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

  it('should filter by instructor', async () => {
    await component.loadAllMaterials();
    component.selectedInstructorFilter.set('mem1');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].memberName).toBe('Jane Doe');
  });

  it('should filter by search text', async () => {
    await component.loadAllMaterials();
    component.searchQuery.set('Warsaw');
    expect(component.filteredMaterials().length).toBe(1);
    expect(component.filteredMaterials()[0].location).toBe('Warsaw');
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
});
