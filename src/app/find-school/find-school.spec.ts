import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FindSchoolComponent } from './find-school';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';

describe('FindSchoolComponent', () => {
  let component: FindSchoolComponent;
  let fixture: ComponentFixture<FindSchoolComponent>;
  let mockDataManagerService: any;

  beforeEach(async () => {
    mockDataManagerService = {
      schools: {
        loading: signal(false),
        search: vi.fn().mockReturnValue([]),
      },
      instructors: {
        entriesMap: () => new Map(),
      }
    };

    await TestBed.configureTestingModule({
      imports: [FindSchoolComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FindSchoolComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should search for schools', () => {
    component.searchTerm.set('Test');
    fixture.detectChanges();
    expect(mockDataManagerService.schools.search).toHaveBeenCalledWith('Test');
  });
});
