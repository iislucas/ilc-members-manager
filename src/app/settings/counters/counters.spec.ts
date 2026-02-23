import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CountersComponent } from './counters';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

describe('Counters', () => {
  let component: CountersComponent;
  let fixture: ComponentFixture<CountersComponent>;

  beforeEach(async () => {
    const mockDataManager = {
      counters: signal(null),
      saveCountersRaw: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CountersComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CountersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
