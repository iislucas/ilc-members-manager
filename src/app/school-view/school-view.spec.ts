import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi } from 'vitest';
import { SchoolViewComponent } from './school-view';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns } from '../app.config';
import { SearchableSet } from '../searchable-set';
import {
  School,
  initSchool,
  InstructorPublicData,
  initInstructor,
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

describe('SchoolViewComponent', () => {
  let component: SchoolViewComponent;
  let fixture: ComponentFixture<SchoolViewComponent>;

  const owner: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-1',
    instructorId: 'I-101',
    name: 'Owner Person',
  };
  const manager: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-2',
    instructorId: 'I-202',
    name: 'Manager Person',
  };
  const school: School = {
    ...initSchool(),
    docId: 's-1',
    schoolId: 'SCH-1',
    schoolName: 'Test School',
    schoolCity: 'Kuala Lumpur',
    schoolCountry: 'Malaysia',
    ownerInstructorId: 'I-101',
    managerInstructorIds: ['I-202'],
    publicBioMarkdown: 'A great school.',
  };

  beforeEach(async () => {
    const mockDataManagerService: Partial<DataManagerService> = {
      schools: new SearchableSet(['schoolId'], 'schoolId', [school]),
      instructors: new SearchableSet(['instructorId'], 'instructorId', [owner, manager]),
    };

    await TestBed.configureTestingModule({
      imports: [SchoolViewComponent],
      providers: [
        provideZonelessChangeDetection(),
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

    fixture = TestBed.createComponent(SchoolViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('schoolId', 'SCH-1');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the school and emit the title', async () => {
    const titleSpy = vi.spyOn(component.titleLoaded, 'emit');
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.school()?.schoolName).toBe('Test School');
    expect(titleSpy).toHaveBeenCalledWith('Test School');
  });

  it('should build a location line from the school location fields', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.locationLine()).toBe('Kuala Lumpur, Malaysia');
  });

  it('should resolve the owner to their public instructor data', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.owner()?.name).toBe('Owner Person');
  });

  it('should resolve managers, excluding the owner', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    const managers = component.managers();
    expect(managers.length).toBe(1);
    expect(managers[0].instructor?.name).toBe('Manager Person');
  });
});
