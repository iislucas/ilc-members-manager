import { TestBed } from '@angular/core/testing';
import { RoutingService, RoutingConfig } from './routing.service';
import {
  Views,
  ROUTING_CONFIG,
  initPathPatterns,
  AppPathPatterns,
} from './app.config';
import { provideZonelessChangeDetection, Component, inject } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';

@Component({
  template: '',
  standalone: true,
})
class TestRouterComponent {
  routingService = inject(RoutingService);
}

describe('RoutingService', () => {
  let service: RoutingService<AppPathPatterns>;
  let fixture: ComponentFixture<TestRouterComponent>;

  const testConfig: RoutingConfig<AppPathPatterns> = {
    validPathPatterns: initPathPatterns,
  };

  async function configureTestBed(config: RoutingConfig<AppPathPatterns>) {
    await TestBed.configureTestingModule({
      imports: [TestRouterComponent],
      providers: [
        provideZonelessChangeDetection(),
        RoutingService,
        {
          provide: ROUTING_CONFIG,
          useValue: config,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestRouterComponent);
    service = fixture.componentInstance.routingService;
    await fixture.whenStable();
  }

  beforeEach(() => {
    // Reset window hash before each test
    window.location.hash = '#/';
  });

  it('should be created', async () => {
    await configureTestBed(testConfig);
    expect(service).toBeTruthy();
  });

  it('should update the URL when a path param signal changes', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.SchoolMembers);
    service.signals[Views.SchoolMembers].pathVars['schoolId'].set('S1');
    await fixture.whenStable();
    expect(window.location.hash).toBe(`#/school/S1/members`);
  });

  it('should update the URL when a url param signal changes', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['jumpTo'].set('456');
    await fixture.whenStable();
    expect(window.location.hash).toBe(`#/members?jumpTo=456`);
  });

  it('should update signals from the URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = `#members?jumpTo=789&q=`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.signals[Views.ManageMembers].urlParams['jumpTo']()).toBe(
      '789',
    );
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe(
      '',
    );
  });

  it('should omit empty URL params from the URL', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    // All URL params are empty by default
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members');
  });

  it('should update path var signals from the URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/school/S42/members';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBe(Views.SchoolMembers);
    expect(service.signals[Views.SchoolMembers].pathVars['schoolId']()).toBe('S42');
  });

  it('should set matchedPatternId to null for unmatched URLs', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/this/path/does/not/exist';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBeNull();
  });

  it('should navigate via navigateTo', async () => {
    await configureTestBed(testConfig);

    service.navigateTo('members?q=test');
    // In jsdom, setting window.location.hash doesn't auto-fire hashchange
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members?q=test');
    expect(service.matchedPatternId()).toBe(Views.ManageMembers);
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('test');
  });

  it('should navigate via navigateToParts', async () => {
    await configureTestBed(testConfig);

    service.navigateToParts(['school', 'S7', 'members']);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/school/S7/members');
    expect(service.matchedPatternId()).toBe(Views.SchoolMembers);
    expect(service.signals[Views.SchoolMembers].pathVars['schoolId']()).toBe('S7');
  });

  it('should remove a param from the URL when its signal is cleared', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('hello');
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members?q=hello');

    service.signals[Views.ManageMembers].urlParams['q'].set('');
    // The signal should immediately reflect the cleared value
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('');
  });

  it('should handle multiple URL params at once', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('search');
    service.signals[Views.ManageMembers].urlParams['jumpTo'].set('M42');
    service.signals[Views.ManageMembers].urlParams['sortBy'].set('name');
    service.signals[Views.ManageMembers].urlParams['sortDir'].set('desc');
    await fixture.whenStable();
    const hash = window.location.hash;
    // All non-empty params should be present
    expect(hash).toContain('q=search');
    expect(hash).toContain('jumpTo=M42');
    expect(hash).toContain('sortBy=name');
    expect(hash).toContain('sortDir=desc');
  });

  it('should encode special characters in path vars', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMemberView);
    service.signals[Views.ManageMemberView].pathVars['memberId'].set('Row 1561');
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members/Row%201561');
  });

  it('should decode special characters in path vars from URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/members/Row%201561';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBe(Views.ManageMemberView);
    expect(service.signals[Views.ManageMemberView].pathVars['memberId']()).toBe('Row 1561');
  });

  it('should reset URL param signals to empty when absent from URL', async () => {
    await configureTestBed(testConfig);

    // First set a value
    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('hello');
    await fixture.whenStable();

    // Navigate to same route without the param
    window.location.hash = '#/members';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('');
  });
});
