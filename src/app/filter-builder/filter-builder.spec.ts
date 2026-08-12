import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterBuilderComponent, FilterConfigItem } from './filter-builder';

describe('FilterBuilderComponent', () => {
  let component: FilterBuilderComponent;
  let fixture: ComponentFixture<FilterBuilderComponent>;

  const testConfig: FilterConfigItem[] = [
    { id: 'q', label: 'Search', type: 'text' },
    { id: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }] },
    { id: 'dateRange', label: 'Date Range', type: 'date-range', fromDateKey: 'startDate', toDateKey: 'endDate' },
    { id: 'unpaid', label: 'Payment', type: 'checkbox', checkboxLabel: 'Unpaid only' },
    { id: 'customField', label: 'Custom', type: 'custom' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterBuilderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FilterBuilderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('config', testConfig);
    fixture.componentRef.setInput('values', {});
    fixture.detectChanges();
  });

  it('creates component', () => {
    expect(component).toBeTruthy();
  });

  it('initializes activeFilterIds based on values provided', () => {
    fixture.componentRef.setInput('values', { q: 'hello', unpaid: true });
    fixture.detectChanges();

    expect(component.activeFilterIds()).toContain('q');
    expect(component.activeFilterIds()).toContain('unpaid');
    expect(component.activeFilterIds()).not.toContain('status');
  });

  it('initializes date-range filter if start or end date is set', () => {
    fixture.componentRef.setInput('values', { startDate: '2026-01-01' });
    fixture.detectChanges();

    expect(component.activeFilterIds()).toContain('dateRange');
  });

  it('starts and cancels adding a filter', () => {
    // Initialized as pending when empty
    expect(component.pendingNewFilter()).toBe(true);

    component.cancelAddFilter();
    expect(component.pendingNewFilter()).toBe(false);

    component.startAddFilter();
    expect(component.pendingNewFilter()).toBe(true);
  });

  it('adds a new filter when selected from pending dropdown', () => {
    let emittedId = '';
    component.filterAdd.subscribe(id => (emittedId = id));

    component.startAddFilter();
    component.onSelectNewFilter({ target: { value: 'status' } } as unknown as Event);

    expect(component.activeFilterIds()).toContain('status');
    expect(emittedId).toBe('status');
    expect(component.pendingNewFilter()).toBe(false);
  });

  it('removes a filter, clears its value, and emits filterRemove and filterChange', () => {
    fixture.componentRef.setInput('values', { status: 'active' });
    fixture.detectChanges();

    expect(component.activeFilterIds()).toContain('status');

    let removedId = '';
    const changes: { id: string; value: any }[] = [];
    component.filterRemove.subscribe(id => (removedId = id));
    component.filterChange.subscribe(evt => changes.push(evt));

    component.removeFilter('status');

    expect(component.activeFilterIds()).not.toContain('status');
    expect(removedId).toBe('status');
    expect(changes).toEqual([{ id: 'status', value: '' }]);
  });

  it('removes date-range filter clearing both from and to keys', () => {
    fixture.componentRef.setInput('values', { startDate: '2026-01-01', endDate: '2026-01-31' });
    fixture.detectChanges();

    expect(component.activeFilterIds()).toContain('dateRange');

    const changes: { id: string; value: any }[] = [];
    component.filterChange.subscribe(evt => changes.push(evt));

    component.removeFilter('dateRange');

    expect(component.activeFilterIds()).not.toContain('dateRange');
    expect(changes).toEqual([
      { id: 'startDate', value: '' },
      { id: 'endDate', value: '' },
    ]);
  });

  it('renders add (+) button only on the last active filter row', () => {
    fixture.componentRef.setInput('values', { q: 'alice', status: 'active' });
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = compiled.querySelectorAll('.filter-row');
    expect(rows.length).toBe(2);

    const firstRowAddBtn = rows[0].querySelector('.add-filter-btn');
    const secondRowAddBtn = rows[1].querySelector('.add-filter-btn');

    expect(firstRowAddBtn).toBeNull();
    expect(secondRowAddBtn).toBeTruthy();
  });

  it('emits allCleared when canceling pending filter on an empty set', () => {
    let clearedCalled = false;
    component.allCleared.subscribe(() => (clearedCalled = true));

    component.cancelAddFilter();
    expect(clearedCalled).toBe(true);
  });

  it('emits allCleared when removing the last active filter', () => {
    fixture.componentRef.setInput('values', { status: 'active' });
    fixture.detectChanges();

    let clearedCalled = false;
    component.allCleared.subscribe(() => (clearedCalled = true));

    component.removeFilter('status');
    expect(clearedCalled).toBe(true);
  });
});
