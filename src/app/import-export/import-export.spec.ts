import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportExportComponent } from './import-export';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';

describe('MemberImportExportComponent', () => {
  let component: ImportExportComponent;
  let fixture: ComponentFixture<ImportExportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportExportComponent],
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
            members: { entriesMap: () => new Map() },
            schools: { entriesMap: () => new Map() },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportExportComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter proposed changes by status', async () => {
    // Mock proposed changes
    const mockChanges: any[] = [
      { status: 'NEW', key: 'new@test.com' },
      { status: 'UPDATE', key: 'update@test.com' },
      { status: 'ISSUE', key: 'issue@test.com' },
    ];
    component.proposedChanges.set(mockChanges);
    await fixture.whenStable();

    // Initial state: no filter (Total)
    expect(component.filteredProposedChanges().length).toBe(3);

    // Filter by NEW
    component.setFilter('NEW');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('NEW');

    // Filter by UPDATE
    component.setFilter('UPDATE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('UPDATE');

    // Reset filter by clicking same filter again
    component.setFilter('UPDATE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(3);

    // Set filter and then reset by passing null
    component.setFilter('ISSUE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    component.setFilter(null);
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(3);
  });

  describe('CSV Mapping and Parsing', () => {
    it('should map "email" header to "emails" field', () => {
      const headers = ['name', 'email', 'memberId'];
      component.importType.set('member');
      const mapping = component.getDefaultMapping(headers);
      expect(mapping['emails']).toBe('email');
    });

    it('should split emails by commas, spaces, and newlines', () => {
      const row = {
        emails:
          'test1@test.com, test2@test.com  test3@test.com\ntest4@test.com',
      };
      const mapping = { emails: 'emails' };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.emails).toEqual([
        'test1@test.com',
        'test2@test.com',
        'test3@test.com',
        'test4@test.com',
      ]);
    });

    it('should mark ISSUE if memberId is missing', async () => {
      component.importType.set('member');
      component.parsedData.set([{ name: 'No ID', emails: 'test@test.com' }]);
      component.mapping.set({ name: 'name', emails: 'emails' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].status).toBe('ISSUE');
      expect(changes[0].issues).toContain('Member ID is required');
    });

    it('should trim string fields', () => {
      const row = {
        name: '  John Doe  ',
        memberId: '  M123  ',
      };
      const mapping = { name: 'name', memberId: 'memberId' };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.name).toBe('John Doe');
      expect(member.memberId).toBe('M123');
    });

    it('should skip rows that contain only empty strings or whitespace', async () => {
      component.importType.set('member');
      component.parsedData.set([
        { name: '  ', memberId: '' },
        { name: 'John', memberId: 'M1' },
      ]);
      component.mapping.set({ name: 'name', memberId: 'memberId' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].key).toBe('M1');
    });
  });
});
