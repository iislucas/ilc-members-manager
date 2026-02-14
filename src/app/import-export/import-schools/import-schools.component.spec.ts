import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportSchoolsComponent } from './import-schools.component';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';

describe('ImportSchoolsComponent', () => {
  let component: ImportSchoolsComponent;
  let fixture: ComponentFixture<ImportSchoolsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportSchoolsComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: FirebaseStateService,
          useValue: createFirebaseStateServiceMock(),
        },
        {
          provide: DataManagerService,
          useValue: {
            countries: { entries: signal([]) },
            members: {
              entriesMap: signal(new Map()),
            },
            schools: {
              entries: signal([]),
              entriesMap: signal(new Map()),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportSchoolsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should lowercase school emails during parsing', () => {
    const row = {
      ownerEmail: 'Owner@Test.com',
      managerEmails: 'Manager1@Test.com, MANAGER2@test.com',
    };
    const mapping = {
      ownerEmail: 'ownerEmail',
      managerEmails: 'managerEmails',
    };
    const school = (component as any).mapRowToSchool(row, mapping);
    expect(school.ownerEmail).toBe('owner@test.com');
    expect(school.managerEmails).toEqual([
      'manager1@test.com',
      'manager2@test.com',
    ]);
  });

  it('should flag duplicate schoolIds in the same import file', async () => {
    component.parsedData.set([
      { schoolName: 'School 1', schoolId: 'S1' },
      { schoolName: 'School 2', schoolId: 'S1' }, // Duplicate
    ]);
    component.mapping.set({ schoolName: 'schoolName', schoolId: 'schoolId' });

    await component.analyzeData();

    const delta = component.proposedChanges() as any;
    // First one is NEW, second one is ISSUE in school logic
    expect(delta.new.size).toBe(1);
    expect(delta.issues.length).toBe(1);
    expect(delta.issues[0].status).toBe('ISSUE');
    expect(delta.issues[0].issues).toContain('Duplicate ID in import file');
  });
});
