import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InstructorSelectorComponent } from './instructor-selector';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';

describe('InstructorSelectorComponent', () => {
  let component: InstructorSelectorComponent;
  let fixture: ComponentFixture<InstructorSelectorComponent>;
  let mockDataManagerService: DataManagerService;

  beforeEach(async () => {
    mockDataManagerService = {
      instructors: new SearchableSet(['name'], 'instructorId'),
    } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [InstructorSelectorComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InstructorSelectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('value', 'AT3');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
