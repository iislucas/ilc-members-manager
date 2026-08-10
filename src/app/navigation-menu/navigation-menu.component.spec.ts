import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NavigationMenuComponent } from './navigation-menu.component';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { ROUTING_CONFIG, initPathPatterns, Views } from '../app.config';
import { FindInstructorsService } from '../find-instructors.service';
import { signal } from '@angular/core';

describe('NavigationMenuComponent', () => {
  let component: NavigationMenuComponent;
  let fixture: ComponentFixture<NavigationMenuComponent>;
  let firebaseService: FirebaseStateService;

  beforeEach(async () => {
    firebaseService = createFirebaseStateServiceMock();
    (firebaseService.user as any).set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Test Member',
        membershipType: 'Life',
        instructorId: 'I-100',
        currentMembershipExpires: '2099-12-31',
        instructorLicenseExpires: '2099-12-31',
      },
      firebaseUser: { email: 'test@example.com' },
    });

    await TestBed.configureTestingModule({
      imports: [NavigationMenuComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        { provide: FirebaseStateService, useValue: firebaseService },
        {
          provide: FindInstructorsService,
          useValue: {
            instructors: {
              get: () => undefined,
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavigationMenuComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('computes currentArea correctly for different views', () => {
    component.routingService.matchedPatternId.set(Views.MembersArea);
    expect(component.currentArea()).toBe('learn');

    component.routingService.matchedPatternId.set(Views.EventsCalendar);
    expect(component.currentArea()).toBe('practice');

    component.routingService.matchedPatternId.set(Views.MyProfile);
    expect(component.currentArea()).toBe('me');

    component.routingService.matchedPatternId.set(Views.ManageMembers);
    expect(component.currentArea()).toBe('admin');
  });

  it('computes currentArea from Home tab parameter', () => {
    component.routingService.matchedPatternId.set(Views.Home);

    component.routingService.signals[Views.Home].urlParams.tab.set('');
    expect(component.currentArea()).toBe('learn');

    component.routingService.signals[Views.Home].urlParams.tab.set('practice');
    expect(component.currentArea()).toBe('practice');

    component.routingService.signals[Views.Home].urlParams.tab.set('me');
    expect(component.currentArea()).toBe('me');

    component.routingService.signals[Views.Home].urlParams.tab.set('admin');
    expect(component.currentArea()).toBe('admin');
  });
});
