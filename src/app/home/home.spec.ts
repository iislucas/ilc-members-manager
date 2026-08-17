import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HomeComponent } from './home';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { ROUTING_CONFIG, initPathPatterns, Views } from '../app.config';
import { NotificationService } from '../notification.service';
import { signal } from '@angular/core';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let firebaseService: FirebaseStateService;

  beforeEach(async () => {
    firebaseService = createFirebaseStateServiceMock();
    (firebaseService.user as any).set({
      isAdmin: false,
      schoolsManaged: ['PARIS'],
      memberProfiles: [],
      member: {
        name: 'Test Member',
        membershipType: 'Life',
        instructorId: 'I-100',
        currentMembershipExpires: '2099-12-31',
        instructorLicenseExpires: '2099-12-31',
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2099-12-31',
      },
      firebaseUser: { email: 'test@example.com' },
    });

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        { provide: FirebaseStateService, useValue: firebaseService },
        {
          provide: NotificationService,
          useValue: {
            notifications: signal([]),
            activeAlerts: signal([]),
            syncError: signal(null),
            dismissSyncError: vi.fn(),
            markAlertAsDismissed: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to learn tab', () => {
    expect(component.activeTab()).toBe('learn');
  });

  it('switches tabs and updates url params', () => {
    component.setActiveTab('practice');
    expect(component.activeTab()).toBe('practice');

    component.setActiveTab('me');
    expect(component.activeTab()).toBe('me');

    component.setActiveTab('learn');
    expect(component.activeTab()).toBe('learn');
  });

  it('handles horizontal swipe gestures', () => {
    // Initial tab: learn
    expect(component.activeTab()).toBe('learn');

    // Swipe left (next tab -> practice)
    component.onTouchStart({
      touches: [{ clientX: 200, clientY: 100 }],
    } as unknown as TouchEvent);
    component.onTouchEnd({
      changedTouches: [{ clientX: 100, clientY: 105 }],
    } as unknown as TouchEvent);
    expect(component.activeTab()).toBe('practice');

    // Swipe left (next tab -> me)
    component.onTouchStart({
      touches: [{ clientX: 200, clientY: 100 }],
    } as unknown as TouchEvent);
    component.onTouchEnd({
      changedTouches: [{ clientX: 100, clientY: 100 }],
    } as unknown as TouchEvent);
    expect(component.activeTab()).toBe('me');

    // Swipe right (prev tab -> practice)
    component.onTouchStart({
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as TouchEvent);
    component.onTouchEnd({
      changedTouches: [{ clientX: 200, clientY: 100 }],
    } as unknown as TouchEvent);
    expect(component.activeTab()).toBe('practice');
  });

  it('supports admin tab for admin users in swipe and tab selection', () => {
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

    component.setActiveTab('admin');
    expect(component.activeTab()).toBe('admin');

    // Swipe right from admin -> me
    component.onTouchStart({
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as TouchEvent);
    component.onTouchEnd({
      changedTouches: [{ clientX: 200, clientY: 100 }],
    } as unknown as TouchEvent);
    expect(component.activeTab()).toBe('me');

    // Swipe left from me -> admin
    component.onTouchStart({
      touches: [{ clientX: 200, clientY: 100 }],
    } as unknown as TouchEvent);
    component.onTouchEnd({
      changedTouches: [{ clientX: 100, clientY: 100 }],
    } as unknown as TouchEvent);
    expect(component.activeTab()).toBe('admin');
  });

  it('renders Class Video Library card when user has active subscription', async () => {
    component.setActiveTab('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Class Video Library');
    expect(element.textContent).not.toContain('Requires subscription');
    expect(element.textContent).not.toContain('Expired:');
  });

  it('does not display "Requires subscription" grey box when user has no subscription', async () => {
    (firebaseService.user as any).set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Test Member',
        membershipType: 'Life',
        currentMembershipExpires: '2099-12-31',
        classVideoLibrarySubscription: false,
        classVideoLibraryExpirationDate: '',
      },
      firebaseUser: { email: 'test@example.com' },
    });

    component.setActiveTab('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Subscribe to Class Video Library');
    expect(element.textContent).not.toContain('Requires subscription');
  });

  it('displays expiration date when subscription is expired', async () => {
    (firebaseService.user as any).set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: {
        name: 'Test Member',
        membershipType: 'Life',
        currentMembershipExpires: '2099-12-31',
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2020-01-01',
      },
      firebaseUser: { email: 'test@example.com' },
    });

    component.setActiveTab('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Subscribe to Class Video Library');
    expect(element.textContent).toContain('Expired: 2020-01-01');
    expect(element.textContent).not.toContain('Requires subscription');
  });

  it('renders Orders card in the Me tab', async () => {
    component.setActiveTab('me');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Orders');
    expect(element.textContent).toContain('Manage purchases, receipts, and renewals');

    const links = element.querySelectorAll<HTMLAnchorElement>('a.card');
    const orderLink = Array.from(links).find((a) => a.getAttribute('href')?.includes('my-orders'));
    expect(orderLink).toBeTruthy();
  });

  it('shows Video on Demand card on Learn tab for members', async () => {
    component.setActiveTab('learn');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Video on Demand');
  });

  it('shows Manage VOD card with In Testing tag on Admin tab for admin users', async () => {
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

    component.setActiveTab('admin');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Manage VOD');
    expect(element.textContent).toContain('In Testing');
  });
});

