import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CountryCodes } from './country-codes';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

describe('CountryCodes', () => {
  let component: CountryCodes;
  let fixture: ComponentFixture<CountryCodes>;

  beforeEach(async () => {
    const mockDataManager = {
      countries: signal(null),
      saveCountriesRaw: vi.fn(),
      getStaticDocs: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [CountryCodes],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CountryCodes);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
