import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LocalCacheSettingsComponent } from './local-cache';
import { IncrementalSyncService } from '../../incremental-sync.service';
import { DataManagerService } from '../../data-manager.service';
import { FindInstructorsService } from '../../find-instructors.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { FIREBASE_APP } from '../../app.config';
import { initializeApp, getApps } from 'firebase/app';
import { provideZonelessChangeDetection, signal } from '@angular/core';

describe('LocalCacheSettingsComponent', () => {
  let component: LocalCacheSettingsComponent;
  let fixture: ComponentFixture<LocalCacheSettingsComponent>;

  let mockSyncService: {
    getAllCachedCollectionSummaries: ReturnType<typeof vi.fn>;
    getCachedBundle: ReturnType<typeof vi.fn>;
    clearCache: ReturnType<typeof vi.fn>;
    clearAllCaches: ReturnType<typeof vi.fn>;
  };

  let mockDataManager: {
    updateSchoolsSync: ReturnType<typeof vi.fn>;
    updateMembersSync: ReturnType<typeof vi.fn>;
    updateMyStudentsSync: ReturnType<typeof vi.fn>;
    forceRefreshAllData: ReturnType<typeof vi.fn>;
    clearAllLocalCaches: ReturnType<typeof vi.fn>;
  };

  let mockFindInstructors: {
    updateInstructorsSync: ReturnType<typeof vi.fn>;
  };

  let mockFirebaseState: {
    user: ReturnType<typeof signal>;
  };

  beforeEach(async () => {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({
      apiKey: 'fake',
      projectId: 'fake',
      appId: 'fake',
    });

    mockSyncService = {
      getAllCachedCollectionSummaries: vi.fn().mockResolvedValue([
        {
          cacheKey: 'public_instructors',
          count: 15,
          lastSyncTimestamp: '2026-08-14T20:00:00.000Z',
          approximateSizeBytes: 4096,
        },
        {
          cacheKey: 'schools',
          count: 5,
          lastSyncTimestamp: '2026-08-14T20:05:00.000Z',
          approximateSizeBytes: 2048,
        },
      ]),
      getCachedBundle: vi.fn().mockResolvedValue({
        entries: [
          { instructorId: '101', name: 'Master Sam Chin' },
          { instructorId: '102', name: 'Alex Doe' },
        ],
        lastSyncTimestamp: '2026-08-14T20:00:00.000Z',
      }),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCaches: vi.fn().mockResolvedValue(undefined),
    };

    mockDataManager = {
      updateSchoolsSync: vi.fn().mockResolvedValue(undefined),
      updateMembersSync: vi.fn().mockResolvedValue(undefined),
      updateMyStudentsSync: vi.fn().mockResolvedValue(undefined),
      forceRefreshAllData: vi.fn().mockResolvedValue(undefined),
      clearAllLocalCaches: vi.fn().mockResolvedValue(undefined),
    };

    mockFindInstructors = {
      updateInstructorsSync: vi.fn().mockResolvedValue(undefined),
    };

    mockFirebaseState = {
      user: signal({
        uid: 'user_123',
        email: 'test@example.com',
        memberDocId: 'mem_123',
        isAdmin: true,
        member: { docId: 'mem_123', name: 'Test User' },
      } as any),
    };

    await TestBed.configureTestingModule({
      imports: [LocalCacheSettingsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FIREBASE_APP, useValue: app },
        { provide: IncrementalSyncService, useValue: mockSyncService },
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FindInstructorsService, useValue: mockFindInstructors },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LocalCacheSettingsComponent);
    component = fixture.componentInstance;
  });

  it('should create and load collection summaries on init', async () => {
    expect(component).toBeTruthy();
    await fixture.whenStable();

    expect(mockSyncService.getAllCachedCollectionSummaries).toHaveBeenCalled();
    expect(component.collections().length).toBe(2);
    expect(component.totalCachedRecords()).toBe(20);
    expect(component.totalSizeBytes()).toBe(6144);
  });

  it('should toggle raw inspector for a collection and filter records', async () => {
    await fixture.whenStable();

    await component.toggleInspectRaw('public_instructors');
    expect(component.expandedKey()).toBe('public_instructors');
    expect(mockSyncService.getCachedBundle).toHaveBeenCalledWith('public_instructors');
    expect(component.rawRecords().length).toBe(2);

    // Search filter
    component.rawSearchQuery.set('Master Sam');
    expect(component.filteredRawRecords().length).toBe(1);

    component.rawSearchQuery.set('nonexistent');
    expect(component.filteredRawRecords().length).toBe(0);

    // Toggle close
    await component.toggleInspectRaw('public_instructors');
    expect(component.expandedKey()).toBeNull();
    expect(component.rawRecords().length).toBe(0);
  });

  it('should sync single collection', async () => {
    await fixture.whenStable();

    await component.syncSingleCollection('public_instructors');
    expect(mockFindInstructors.updateInstructorsSync).toHaveBeenCalled();
    expect(component.statusMessage()).toContain('public_instructors');

    await component.syncSingleCollection('schools');
    expect(mockDataManager.updateSchoolsSync).toHaveBeenCalled();
  });

  it('should clear single collection after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fixture.whenStable();

    await component.clearSingleCollection('public_instructors');
    expect(mockSyncService.clearCache).toHaveBeenCalledWith('public_instructors');
    expect(component.statusMessage()).toContain('Cleared cache');
  });

  it('should not clear single collection if cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await fixture.whenStable();

    await component.clearSingleCollection('public_instructors');
    expect(mockSyncService.clearCache).not.toHaveBeenCalled();
  });

  it('should force refresh all data', async () => {
    await fixture.whenStable();

    await component.forceRefreshAll();
    expect(mockFindInstructors.updateInstructorsSync).toHaveBeenCalled();
    expect(mockDataManager.forceRefreshAllData).toHaveBeenCalled();
    expect(component.statusMessage()).toContain('refreshed');
  });

  it('should clear all caches after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fixture.whenStable();

    await component.clearAll();
    expect(mockDataManager.clearAllLocalCaches).toHaveBeenCalled();
    expect(component.statusMessage()).toContain('cleared');
  });
});
