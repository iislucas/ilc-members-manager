/* header.component.spec.ts
 *
 * Unit tests for HeaderComponent, verifying:
 * - Hamburger navigation menu is shown at the root page (Home) when logged in.
 * - Back arrow button is shown when on non-root pages (with correct href and tooltip).
 * - Breadcrumbs render without the main site root, using Members Portal as the root chip.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { HeaderComponent, Breadcrumb } from './header.component';
import { NavigationTreeService, NavNode } from '../navigation-tree';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { FindInstructorsService } from '../find-instructors.service';

describe('HeaderComponent', () => {
  let isHomeSig: ReturnType<typeof signal<boolean>>;
  let upNodeSig: ReturnType<typeof signal<NavNode | null>>;

  beforeEach(async () => {
    isHomeSig = signal(true);
    upNodeSig = signal(null);

    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        {
          provide: NavigationTreeService,
          useValue: {
            isHome: isHomeSig,
            upNode: upNodeSig,
          },
        },
        {
          provide: FirebaseStateService,
          useValue: {
            user: signal(null),
            loginStatus: signal(0),
            logout: vi.fn(),
          },
        },
        {
          provide: FindInstructorsService,
          useValue: {
            instructors: { entries: signal([]), get: () => undefined },
          },
        },
      ],
    }).compileComponents();
  });

  it('renders hamburger menu on Home when logged in', async () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.componentRef.setInput('isLoggedIn', true);
    fixture.componentRef.setInput('isPublicPage', false);
    fixture.componentRef.setInput('breadcrumbs', [{ label: 'Members Portal', url: '/' }]);
    isHomeSig.set(true);
    upNodeSig.set(null);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.menu-anchor button')).toBeTruthy();
    expect(compiled.querySelector('.header-back-btn')).toBeNull();
  });

  it('renders back arrow button on non-root page linking to parent', async () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.componentRef.setInput('isLoggedIn', true);
    fixture.componentRef.setInput('isPublicPage', false);
    const crumbs: Breadcrumb[] = [
      { label: 'Members Portal', url: '/' },
      { label: 'Events & Workshops', url: '/events' },
      { label: 'Summer Camp' },
    ];
    fixture.componentRef.setInput('breadcrumbs', crumbs);
    isHomeSig.set(false);
    upNodeSig.set({ label: 'Events & Workshops', url: '/events' });

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.menu-anchor button')).toBeNull();

    const backBtn = compiled.querySelector('.header-back-btn') as HTMLAnchorElement;
    expect(backBtn).toBeTruthy();
    expect(backBtn.getAttribute('href')).toBe('/events');
    expect(backBtn.getAttribute('title')).toBe('Back to Events & Workshops');

    // Breadcrumb parent chips should show Members Portal and Events & Workshops
    const crumbLinks = compiled.querySelectorAll('.crumb-link');
    expect(crumbLinks.length).toBe(2);
    expect(crumbLinks[0].textContent?.trim()).toBe('Members Portal');
    expect(crumbLinks[1].textContent?.trim()).toBe('Events & Workshops');

    // Title should show Summer Camp
    expect(compiled.querySelector('.current-page-title')?.textContent?.trim()).toBe('Summer Camp');
  });

  it('renders back arrow on public page when logged out', async () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.componentRef.setInput('isLoggedIn', false);
    fixture.componentRef.setInput('isPublicPage', true);
    const crumbs: Breadcrumb[] = [
      { label: 'Members Portal', url: '/' },
      { label: 'Find an Instructor' },
    ];
    fixture.componentRef.setInput('breadcrumbs', crumbs);
    isHomeSig.set(false);
    upNodeSig.set({ label: 'Members Portal', url: '/' });

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const backBtn = compiled.querySelector('.header-back-btn') as HTMLAnchorElement;
    expect(backBtn).toBeTruthy();
    expect(backBtn.getAttribute('href')).toBe('/');
    expect(backBtn.getAttribute('title')).toBe('Back to Members Portal');
  });
});
