import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportExportComponent } from './import-export';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';

describe('ImportExportComponent', () => {
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
            members: {
              entriesMap: signal(new Map()),
            },
            schools: {
              entries: signal([]),
              entriesMap: signal(new Map()),
            },
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

  it('should have activeTab signal', () => {
    expect(component.activeTab()).toBe('members');
  });

  it('should switch tabs', () => {
    component.setActiveTab('schools');
    expect(component.activeTab()).toBe('schools');
    component.setActiveTab('members');
    expect(component.activeTab()).toBe('members');
  });
});
