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
});
