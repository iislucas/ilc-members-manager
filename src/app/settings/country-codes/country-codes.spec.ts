import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CountryCodesComponent } from './country-codes';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

describe('CountryCodes', () => {
  let component: CountryCodesComponent;
  let fixture: ComponentFixture<CountryCodesComponent>;

  beforeEach(async () => {
    const mockDataManager = {
      countries: { entries: vi.fn().mockReturnValue([]), loaded: signal(true), loading: signal(false), error: signal(null) },
      saveCountriesRaw: vi.fn(),
      getStaticDocs: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [CountryCodesComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CountryCodesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
