/* school-list.spec.ts
 *
 * Tests for the SchoolListComponent which displays a searchable list
 * of schools with links to dedicated edit pages.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SchoolListComponent } from './school-list';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { School, initSchool } from '../../../functions/src/data-model/schools';
import {
  InstructorPublicData,
  Member,
  initInstructor,
  initMember,
} from '../../../functions/src/data-model/members';
import { signal, WritableSignal } from '@angular/core';

describe('SchoolListComponent', () => {
  let component: SchoolListComponent;
  let fixture: ComponentFixture<SchoolListComponent>;
  let mockFirebaseStateService: FirebaseStateService;
  let mockDataManagerService: DataManagerService;
  let qSignal: WritableSignal<string>;
  let instructorIdSignal: WritableSignal<string>;
  let memberDocIdSignal: WritableSignal<string>;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [] }),
    } as never as FirebaseStateService;

    // Create a set of 60 schools
    const schools: School[] = [];
    for (let i = 0; i < 60; i++) {
      const s = initSchool();
      s.docId = `school-${i}`;
      s.schoolName = `School ${i}`;
      s.schoolId = `SCH-${i}`;
      if (i === 1) s.ownerInstructorId = '101';
      if (i === 2) s.managerInstructorIds = ['101'];
      if (i === 3) s.ownerMemberDocId = 'buyer-doc-1';
      schools.push(s);
    }
    const schoolSet = new SearchableSet<'docId', School>(
      ['schoolName'],
      'docId',
      schools,
    );

    const instructor: InstructorPublicData = {
      ...initInstructor(),
      docId: 'inst-doc-101',
      instructorId: '101',
      name: 'Jane Sifu',
    };
    const buyer: Member = {
      ...initMember(),
      docId: 'buyer-doc-1',
      memberId: 'US200',
      name: 'Buyer Owner',
    };

    mockDataManagerService = {
      schools: schoolSet,
      instructors: new SearchableSet<'instructorId', InstructorPublicData>(
        ['name'],
        'instructorId',
        [instructor],
      ),
      members: new SearchableSet<'docId', Member>(
        ['name'],
        'docId',
        [buyer],
      ),
    } as never as DataManagerService;

    qSignal = signal('');
    instructorIdSignal = signal('');
    memberDocIdSignal = signal('');

    await TestBed.configureTestingModule({
      imports: [SchoolListComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        {
          provide: RoutingService,
          useValue: {
            matchedPatternId: signal('schools'),
            signals: {
              schools: {
                urlParams: {
                  q: qSignal,
                  instructorId: instructorIdSignal,
                  memberDocId: memberDocIdSignal,
                },
              },
              mySchools: {
                urlParams: {
                  q: signal(''),
                },
              },
            },
            hrefForView: vi.fn(),
            navigateTo: vi.fn(),
          }
        }
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(SchoolListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should limit schools to 50 initially', () => {
    expect(component.limit()).toBe(50);
    expect(component.schools().length).toBe(50);
    expect(component.totalSchools()).toBe(60);
  });

  it('should show all schools when showAll is called', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);
    expect(component.schools().length).toBe(60);
  });

  it('should reset limit to 50 when search is performed', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);

    const input = document.createElement('input');
    input.value = 'School';
    const event = { target: input } as never as Event;
    component.onSearch(event);

    expect(component.limit()).toBe(50);
  });

  it('should generate correct edit link', () => {
    const school = initSchool();
    school.docId = 'test-doc-id';
    school.schoolId = 'SCH-123';
    const link = component.editLink(school);
    expect(link).toBe('/schools/test-doc-id/edit');
  });

  it('should filter schools owned or managed by instructorId and clear filter on chip click', () => {
    instructorIdSignal.set('101');
    fixture.detectChanges();

    expect(component.schools().map((s) => s.schoolId)).toEqual(['SCH-1', 'SCH-2']);
    expect(component.managerFilterLabel()).toBe('Managed by Jane Sifu [101]');

    const chip = fixture.nativeElement.querySelector('.active-tag-chip');
    expect(chip?.textContent).toContain('Managed by Jane Sifu [101]');

    const clearBtn: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('.tag-clear-btn');
    expect(clearBtn).toBeTruthy();
    clearBtn!.click();
    fixture.detectChanges();

    expect(instructorIdSignal()).toBe('');
    expect(component.totalSchools()).toBe(60);
  });

  it('should filter schools owned via memberDocId for non-instructor school owners', () => {
    memberDocIdSignal.set('buyer-doc-1');
    fixture.detectChanges();

    expect(component.schools().map((s) => s.schoolId)).toEqual(['SCH-3']);
    expect(component.managerFilterLabel()).toBe('Managed by (US200) Buyer Owner');
  });
});
