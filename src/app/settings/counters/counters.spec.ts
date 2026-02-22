import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Counters } from './counters';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

describe('Counters', () => {
  let component: Counters;
  let fixture: ComponentFixture<Counters>;

  beforeEach(async () => {
    const mockDataManager = {
      counters: signal(null),
      saveCountersRaw: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [Counters],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Counters);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
