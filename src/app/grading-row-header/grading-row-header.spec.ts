import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { vi } from 'vitest';
import { GradingRowHeaderComponent } from './grading-row-header';
import { initGrading } from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';

describe('GradingRowHeaderComponent', () => {
  let component: GradingRowHeaderComponent;
  let fixture: ComponentFixture<GradingRowHeaderComponent>;
  let componentRef: ComponentRef<GradingRowHeaderComponent>;
  let mockDataManagerService: any;

  beforeEach(async () => {
    mockDataManagerService = {
      members: { entries: () => [], get: () => undefined },
      instructors: { entries: () => [], get: () => undefined },
      memberDisplayName: () => '',
      instructorDisplayName: () => '',
      getMemberByDocId: () => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [GradingRowHeaderComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: { hrefForView: vi.fn().mockReturnValue('') } },
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(GradingRowHeaderComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('grading', initGrading());
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not render event-date or event-name spans when fields are empty', async () => {
    componentRef.setInput('grading', { ...initGrading(), gradingEventDate: '', gradingEvent: '' });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.event-date')).toBeNull();
    expect(el.querySelector('.event-name')).toBeNull();
  });

  it('should render event-date when gradingEventDate is set', async () => {
    componentRef.setInput('grading', { ...initGrading(), gradingEventDate: '2026-06-01' });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.event-date')?.textContent?.trim()).toBe('2026-06-01');
  });

  it('should render event-name when gradingEvent is set', async () => {
    componentRef.setInput('grading', { ...initGrading(), gradingEvent: 'ILC Summer Camp' });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.event-name')?.textContent?.trim()).toBe('ILC Summer Camp');
  });

  it('should suppress the event-name when hideEvent is set', async () => {
    componentRef.setInput('grading', { ...initGrading(), gradingEvent: 'ILC Summer Camp' });
    componentRef.setInput('hideEvent', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.event-name')).toBeNull();
  });

  it('shows the preceding progression level as the level before the grading', async () => {
    componentRef.setInput('grading', { ...initGrading(), level: 'Student 6' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.previousLevel()).toBe('Student 5');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.previous-level')?.textContent?.trim()).toBe('Student 5');
    expect(el.querySelector('.level-chip')?.textContent?.trim()).toBe('Student 6');
  });

  it('uses the interleaved progression across tracks (Application 3 → Student 6)', async () => {
    componentRef.setInput('grading', { ...initGrading(), level: 'Application 3' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.previousLevel()).toBe('Student 6');
  });

  it('maps Student 1 back to Student Entry', async () => {
    componentRef.setInput('grading', { ...initGrading(), level: 'Student 1' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.previousLevel()).toBe('Student Entry');
  });

  it('omits the level before when the grading is the first progression entry', async () => {
    componentRef.setInput('grading', { ...initGrading(), level: 'Student Entry' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.previousLevel()).toBe('');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.previous-level')).toBeNull();
    expect(el.querySelector('.level-chip')?.textContent?.trim()).toBe('Student Entry');
  });
});
