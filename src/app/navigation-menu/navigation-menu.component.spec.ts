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

  it('switches expanded area on first click, and navigates to home tab on second click', () => {
    component.routingService.matchedPatternId.set(Views.ManageMembers);
    expect(component.currentArea()).toBe('admin');
    expect(component.selectedArea()).toBe('admin');

    const navigateSpy = vi.spyOn(component.routingService, 'navigateTo');
    const closeSpy = vi.fn();
    component.closeMenu.subscribe(closeSpy);

    // 1. First click on 'learn' switches selectedArea without navigating
    component.onSelectArea('learn');
    expect(component.selectedArea()).toBe('learn');
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // 2. Second click on 'learn' navigates and closes menu
    component.onSelectArea('learn');
    expect(navigateSpy).toHaveBeenCalledWith('');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('navigates to specific subpage on select', () => {
    const closeSpy = vi.fn();
    component.closeMenu.subscribe(closeSpy);

    component.onSelect(Views.MembersArea);
    expect(component.currentView()).toBe(Views.MembersArea);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('handles DOM interaction: clicking collapsed area expands it, clicking header navigates', async () => {
    (firebaseService.user as any).set({
      isAdmin: true,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Admin Member',
        membershipType: 'Life',
      },
      firebaseUser: { email: 'admin@example.com' },
    });

    component.routingService.matchedPatternId.set(Views.ManageMembers);
    fixture.detectChanges();
    await fixture.whenStable();

    const navigateSpy = vi.spyOn(component.routingService, 'navigateTo');
    const closeSpy = vi.fn();
    component.closeMenu.subscribe(closeSpy);

    const compiled = fixture.nativeElement as HTMLElement;

    // Admin should be currently expanded, Learn should be collapsed
    const topNavs = Array.from(compiled.querySelectorAll<HTMLElement>('.top-level-nav'));
    const learnTopNav = topNavs.find((el) => el.textContent?.includes('Learn'));
    expect(learnTopNav).toBeTruthy();

    const accordions = compiled.querySelectorAll<HTMLElement>('.submenu-accordion');
    const learnAccordion = accordions[0];
    expect(learnAccordion.classList.contains('open')).toBe(false);

    // Click Learn section header -> expands Learn accordion
    learnTopNav!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.selectedArea()).toBe('learn');
    expect(learnAccordion.classList.contains('open')).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // Click Learn header again -> navigates and closes
    learnTopNav!.click();
    expect(navigateSpy).toHaveBeenCalledWith('');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('hides Video on Demand menu item for non-admin users', async () => {
    (firebaseService.user as any).set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Test Member',
        membershipType: 'Life',
      },
      firebaseUser: { email: 'user@example.com' },
    });

    component.selectedArea.set('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).not.toContain('Video on Demand');
  });

  it('shows Video on Demand menu item with In Testing tag for admin users', async () => {
    (firebaseService.user as any).set({
      isAdmin: true,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Admin Member',
        membershipType: 'Life',
      },
      firebaseUser: { email: 'admin@example.com' },
    });

    component.selectedArea.set('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Video on Demand');
    expect(compiled.textContent).toContain('In Testing');
  });
});
