import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FindAnInstructorComponent } from './find-an-instructor';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { FindInstructorsService } from '../find-instructors.service';

describe('FindAnInstructorComponent', () => {
  let component: FindAnInstructorComponent;
  let fixture: ComponentFixture<FindAnInstructorComponent>;
  let findInstructorsServiceMock: Partial<FindInstructorsService>;

  beforeEach(async () => {
    findInstructorsServiceMock = {
      instructors: {
        loading: signal(false),
        entries: signal([]),
        error: signal(null),
        search: () => [],
      } as any,
    };

    await TestBed.configureTestingModule({
      imports: [FindAnInstructorComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: FindInstructorsService,
          useValue: findInstructorsServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FindAnInstructorComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
