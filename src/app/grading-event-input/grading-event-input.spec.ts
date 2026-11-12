/* grading-event-input.spec.ts
 *
 * Unit tests for GradingEventInputComponent:
 * - Default 3-months-ago start date with no upper limit on future events
 * - Date range selector hidden by default and revealed via 3-dots menu ("Show events on other dates")
 * - Linked events older than 3 months resolved cleanly via getEventById
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GradingEventInputComponent,
  defaultEventSearchStartDate,
} from './grading-event-input';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { IlcEvent, initEvent } from '../../../functions/src/data-model/events';

describe('GradingEventInputComponent', () => {
  let fixture: ComponentFixture<GradingEventInputComponent>;
  let component: GradingEventInputComponent;
  let mockDataService: {
    searchEvents: ReturnType<typeof vi.fn>;
    getEventById: ReturnType<typeof vi.fn>;
  };

  const recentEvent: IlcEvent = {
    ...initEvent(),
    docId: 'ev_recent',
    title: 'Autumn Workshop',
    location: 'Warsaw',
    start: '2026-10-15',
  };

  const oldEvent: IlcEvent = {
    ...initEvent(),
    docId: 'ev_old',
    title: 'Spring Workshop',
    location: 'New York',
    start: '2025-04-10',
  };

  beforeEach(async () => {
    mockDataService = {
      searchEvents: vi.fn().mockResolvedValue([recentEvent]),
      getEventById: vi.fn().mockImplementation(async (id: string) =>
        id === 'ev_old' ? oldEvent : undefined,
      ),
    };

    await TestBed.configureTestingModule({
      imports: [GradingEventInputComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: mockDataService },
        {
          provide: RoutingService,
          useValue: {
            hrefForView: vi.fn().mockReturnValue('#/events/ev_recent'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GradingEventInputComponent);
    component = fixture.componentInstance;
  });

  it('computes defaultEventSearchStartDate 3 months in the past with month-end clamping', () => {
    expect(defaultEventSearchStartDate(new Date(2026, 10, 11))).toBe('2026-08-11');
    // May 31 -> Feb 28 in non-leap year
    expect(defaultEventSearchStartDate(new Date(2026, 4, 31))).toBe('2026-02-28');
    // Feb 15 -> Nov 15 previous year
    expect(defaultEventSearchStartDate(new Date(2026, 1, 15))).toBe('2025-11-15');
  });

  it('queries events from 3 months ago with no future limit by default and hides date range inputs', async () => {
    component.setAtListedEvent(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const expectedStart = defaultEventSearchStartDate();
    expect(component.eventRangeFrom()).toBe(expectedStart);
    expect(component.eventRangeTo()).toBe('');
    expect(mockDataService.searchEvents).toHaveBeenCalledWith({
      kind: 'date',
      startDate: expectedStart,
      endDate: undefined,
      statusFilter: 'listed',
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.event-range-hint')).toBeNull();
    expect(el.querySelector('.event-menu-trigger')).not.toBeNull();
  });

  it('opens the 3-dots menu and reveals the date range selector when clicking "Show events on other dates"', async () => {
    component.setAtListedEvent(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector<HTMLButtonElement>('.event-menu-trigger')!;
    trigger.click();
    fixture.detectChanges();

    const menuItem = el.querySelector<HTMLButtonElement>('.event-options-menu .menu-item');
    expect(menuItem).not.toBeNull();
    expect(menuItem!.textContent).toContain('Show events on other dates');

    menuItem!.click();
    fixture.detectChanges();

    expect(component.menuOpen()).toBe(false);
    expect(component.showDateRange()).toBe(true);

    const dateInputs = el.querySelectorAll<HTMLInputElement>('.event-range-hint input[type="date"]');
    expect(dateInputs.length).toBe(2);
    expect(dateInputs[0].value).toBe(defaultEventSearchStartDate());
    expect(dateInputs[1].value).toBe('');
  });

  it('resolves a linked event older than 3 months via getEventById without showing out-of-range warning while date filter is closed', async () => {
    fixture.componentRef.setInput('gradingEventDocId', 'ev_old');
    fixture.componentRef.setInput('gradingEvent', 'Spring Workshop — New York');
    fixture.componentRef.setInput('gradingEventDate', '2025-04-10');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDataService.getEventById).toHaveBeenCalledWith('ev_old');
    expect(component.linkedEventName()).toBe('2025-04-10 — Spring Workshop');
    expect(component.linkedEventOutOfRange()).toBe(false);
  });
});
