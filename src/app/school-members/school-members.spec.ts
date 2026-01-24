import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SchoolMembersComponent } from './school-members';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { signal, provideZonelessChangeDetection } from '@angular/core';

describe('SchoolMembers', () => {
  let component: SchoolMembersComponent;
  let fixture: ComponentFixture<SchoolMembersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchoolMembersComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: DataManagerService,
          useValue: {
            schools: { entries: signal([]), loading: signal(false) },
            members: { entries: signal([]), loading: signal(false) },
            loadingState: signal('Loaded'),
          },
        },
        {
          provide: RoutingService,
          useValue: {
            signals: {
              schoolMembers: {
                pathVars: { schoolId: signal('S1') },
                urlParams: { memberId: signal('') },
              },
            },
            matchedPatternId: signal('schoolMembers'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolMembersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
