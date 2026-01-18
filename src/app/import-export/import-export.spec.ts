import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportExportComponent } from './import-export';

describe('MemberImportExportComponent', () => {
  let component: ImportExportComponent;
  let fixture: ComponentFixture<ImportExportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportExportComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter proposed changes by status', () => {
    // Mock proposed changes
    const mockChanges: any[] = [
      { status: 'NEW', key: 'new@test.com' },
      { status: 'UPDATE', key: 'update@test.com' },
      { status: 'ISSUE', key: 'issue@test.com' },
    ];
    component.proposedChanges.set(mockChanges);

    // Initial state: no filter (Total)
    expect(component.filteredProposedChanges().length).toBe(3);

    // Filter by NEW
    component.setFilter('NEW');
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('NEW');

    // Filter by UPDATE
    component.setFilter('UPDATE');
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('UPDATE');

    // Reset filter by clicking same filter again
    component.setFilter('UPDATE');
    expect(component.filteredProposedChanges().length).toBe(3);

    // Set filter and then reset by passing null
    component.setFilter('ISSUE');
    expect(component.filteredProposedChanges().length).toBe(1);
    component.setFilter(null);
    expect(component.filteredProposedChanges().length).toBe(3);
  });
});
