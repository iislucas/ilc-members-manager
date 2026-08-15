import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FindInstructorsService, sortInstructors } from './find-instructors.service';
import { IncrementalSyncService } from './incremental-sync.service';
import { ApplicationLevel, initInstructor, InstructorPublicData, StudentLevel } from '../../functions/src/data-model';

describe('FindInstructorsService', () => {
  let service: FindInstructorsService;
  let mockSyncService: {
    loadCachedData: ReturnType<typeof vi.fn>;
    syncCollection: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSyncService = {
      loadCachedData: vi.fn().mockResolvedValue(true),
      syncCollection: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        FindInstructorsService,
        { provide: IncrementalSyncService, useValue: mockSyncService },
      ],
    });

    service = TestBed.inject(FindInstructorsService);
  });

  it('initializes and attempts to load cached data', () => {
    expect(mockSyncService.loadCachedData).toHaveBeenCalledWith(
      'public_instructors',
      service.instructors,
      sortInstructors,
    );
  });

  it('sorts instructors correctly by country, application level, student level', () => {
    const inst1: InstructorPublicData = {
      ...initInstructor(),
      docId: '1',
      instructorId: '1',
      name: 'Alpha',
      country: 'France',
      applicationLevel: ApplicationLevel.Level1,
      studentLevel: StudentLevel.Level1,
    };
    const inst2: InstructorPublicData = {
      ...initInstructor(),
      docId: '2',
      instructorId: '2',
      name: 'Beta',
      country: 'France',
      applicationLevel: ApplicationLevel.Level2,
      studentLevel: StudentLevel.Level2,
    };
    const inst3: InstructorPublicData = {
      ...initInstructor(),
      docId: '3',
      instructorId: '3',
      name: 'Gamma',
      country: 'Australia',
      applicationLevel: ApplicationLevel.Level1,
      studentLevel: StudentLevel.Level1,
    };

    const list = [inst1, inst2, inst3].sort(sortInstructors);
    expect(list[0].country).toBe('Australia');
    expect(list[1].name).toBe('Beta'); // Higher applicationLevel in France
    expect(list[2].name).toBe('Alpha');
  });
});
