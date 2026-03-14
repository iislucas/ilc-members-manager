import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FindSchoolComponent } from './find-school';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';

describe('FindSchoolComponent', () => {
  let component: FindSchoolComponent;
  let fixture: ComponentFixture<FindSchoolComponent>;
  let mockDataManagerService: DataManagerService;

  beforeEach(async () => {
    mockDataManagerService = {
      schools: {
        loading: signal(false),
        search: vi.fn().mockReturnValue([]),
      },
      instructors: {
        entriesMap: () => new Map(),
      }
    } as never as DataManagerService;

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

  describe('ensureHttps', () => {
    it('should prefix URL with https:// when no protocol is present', () => {
      expect(component.ensureHttps('www.example.com')).toBe('https://www.example.com');
    });

    it('should not modify URL that already starts with https://', () => {
      expect(component.ensureHttps('https://www.example.com')).toBe('https://www.example.com');
    });

    it('should not modify URL that starts with http://', () => {
      expect(component.ensureHttps('http://www.example.com')).toBe('http://www.example.com');
    });
  });
});
