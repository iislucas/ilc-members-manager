import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { InstructorViewComponent } from './instructor-view';
import { FindInstructorsService } from '../find-instructors.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns } from '../app.config';
import { SearchableSet } from '../searchable-set';
import {
  InstructorPublicData,
  initInstructor,
  IlcEvent,
  initEvent,
  EventStatus,
} from '../../../functions/src/data-model';

// Mock firebase/firestore so the direct-fetch fallback and getFirestore are inert.
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true }),
}));

describe('InstructorViewComponent', () => {
  let component: InstructorViewComponent;
  let fixture: ComponentFixture<InstructorViewComponent>;
  let mockFindInstructorsService: { instructors: SearchableSet<'instructorId', InstructorPublicData> };
  let mockDataManagerService: Partial<DataManagerService>;

  const instructor: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-1',
    instructorId: 'I-101',
    name: 'Test Instructor',
    publicBioMarkdown: 'I train for **health**.',
    country: 'Malaysia',
  };

  beforeEach(async () => {
    mockFindInstructorsService = {
      instructors: new SearchableSet(['instructorId'], 'instructorId', [instructor]),
    };

    mockDataManagerService = {
      getUpcomingEventsForInstructor: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [InstructorViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FindInstructorsService, useValue: mockFindInstructorsService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FIREBASE_APP, useValue: {} },
        {
          provide: RoutingService,
          useValue: {
            hrefForView: vi.fn().mockReturnValue('#'),
          } as unknown as RoutingService<AppPathPatterns>,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InstructorViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('instructorId', 'I-101');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the instructor from the find service and emit the title', async () => {
    const titleSpy = vi.spyOn(component.titleLoaded, 'emit');
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.instructor()?.name).toBe('Test Instructor');
    expect(titleSpy).toHaveBeenCalledWith('Test Instructor');
    expect(mockDataManagerService.getUpcomingEventsForInstructor).toHaveBeenCalledWith('I-101', 'member-doc-1');
  });

  it('should build a location line from public location fields', async () => {
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.locationLine()).toBe('Malaysia');
  });

  it('should surface upcoming events returned by the data service', async () => {
    const event: IlcEvent = { ...initEvent(), docId: 'ev-1', title: 'Workshop', status: EventStatus.Listed };
    (mockDataManagerService.getUpcomingEventsForInstructor as ReturnType<typeof vi.fn>).mockResolvedValue([event]);
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.upcomingEvents().length).toBe(1);
    expect(component.upcomingEvents()[0].title).toBe('Workshop');
  });
});
